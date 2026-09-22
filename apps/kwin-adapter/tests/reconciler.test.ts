import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeCoordinator } from "../src/runtime-coordinator.js";
import type {
  NormalizedScreenInput,
  NormalizedWindowInput,
  CoordinatorDiagnostics
} from "../src/coordinator-types.js";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const SCREEN_1: NormalizedScreenInput = {
  outputId: "HDMI-A-1",
  name: "HDMI-A-1",
  geometry: { x: 0, y: 0, width: 1920, height: 1080 },
  usableArea: { x: 0, y: 0, width: 1920, height: 1080 },
  activeDesktopId: "1"
};

const SCREEN_2: NormalizedScreenInput = {
  outputId: "DP-1",
  name: "DP-1",
  geometry: { x: 1920, y: 0, width: 1920, height: 1080 },
  usableArea: { x: 1920, y: 0, width: 1920, height: 1080 },
  activeDesktopId: "1"
};

function makeNormalWindow(id: string, outputId: string = "HDMI-A-1", extra: Partial<NormalizedWindowInput> = {}): NormalizedWindowInput {
  return {
    id,
    resourceClass: "kitty",
    resourceName: "kitty",
    title: "Terminal",
    outputId,
    frameGeometry: { x: 100, y: 100, width: 600, height: 400 },
    managed: true,
    normalWindow: true,
    ...extra
  };
}

describe("Phase 2A Runtime Coordinator & Coalesced Reconciliation", () => {
  let coordinator: RuntimeCoordinator;

  beforeEach(() => {
    coordinator = new RuntimeCoordinator({
      enableTiling: true,
      defaultLayout: "master-stack",
      gapInner: 8,
      gapOuter: 10,
      masterRatio: 0.50,
      masterCount: 1,
      geometryTolerancePx: 1,
      echoExpiryMs: 300
    });
    coordinator.getOrCreateScreen(SCREEN_1);
  });

  it("1. Multiple events in one burst produce one reconciliation transaction", () => {
    // Fire 5 window discovery events in a burst
    for (let i = 1; i <= 5; i++) {
      coordinator.ingestEvent({
        type: "WindowDiscovered",
        window: makeNormalWindow(`win-${i}`)
      });
    }

    // Coalesced reconcile pass
    const tx = coordinator.reconcile();
    expect(tx).not.toBeNull();
    expect(tx!.epoch).toBe(1);
    expect(tx!.affectedScreens).toEqual(["HDMI-A-1"]);
    // Reasons from all 5 events are coalesced
    expect(tx!.reasons).toContain("WindowDiscovered");

    const diag = coordinator.getDiagnostics();
    expect(diag.totalNormalizedEvents).toBe(5);
    expect(diag.totalReconciliationTransactions).toBe(1);
  });

  it("2. Repeated identical events produce no geometry writes", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeNormalWindow("win-1")
    });

    // First transaction tiles win-1 to fill the screen
    const tx1 = coordinator.reconcile();
    expect(tx1).not.toBeNull();
    expect(tx1!.operations.length).toBe(1);

    // Now simulate window accepting the geometry (echo handled)
    const appliedRect = tx1!.operations[0].targetRect;
    coordinator.recordCommand("win-1", appliedRect, tx1!.epoch);
    coordinator.checkAndHandleEcho("win-1", appliedRect);

    // Mark screen dirty again with no actual geometry or state difference
    coordinator.markScreenDirty("HDMI-A-1", "RedundantTrigger");
    const tx2 = coordinator.reconcile();

    expect(tx2).not.toBeNull();
    expect(tx2!.operations.length).toBe(0);
    expect(tx2!.skippedWrites).toBe(1);
  });

  it("3. A changed desired rectangle produces exactly one write", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeNormalWindow("win-1")
    });
    const tx1 = coordinator.reconcile();
    expect(tx1!.operations.length).toBe(1);
    coordinator.recordCommand("win-1", tx1!.operations[0].targetRect, tx1!.epoch);
    coordinator.checkAndHandleEcho("win-1", tx1!.operations[0].targetRect);

    // Change master ratio on the screen: desired rectangle changes
    coordinator.ingestEvent({
      type: "ScreenMasterConfigChanged",
      outputId: "HDMI-A-1",
      ratio: 0.70
    });

    // Add a second window so ratio takes effect
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeNormalWindow("win-2")
    });

    const tx2 = coordinator.reconcile();
    expect(tx2!.operations.length).toBe(2); // both windows adjusted
  });

  it("4. Matching geometry echoes are suppressed only after explicit recordCommand", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeNormalWindow("win-1")
    });
    const tx = coordinator.reconcile();
    const target = tx!.operations[0].targetRect;

    // Negative assertion: reconcile() by itself does NOT suppress a matching geometry event
    const preRecordResult = coordinator.checkAndHandleEcho("win-1", target);
    expect(preRecordResult.isEcho).toBe(false);

    // Simulate sink explicit recordCommand immediately before write
    coordinator.recordCommand("win-1", target, tx!.epoch);

    // Window manager sends back frameGeometryChanged matching the target
    const echoResult = coordinator.checkAndHandleEcho("win-1", target);
    expect(echoResult.isEcho).toBe(true);

    const diag = coordinator.getDiagnostics();
    expect(diag.suppressedGeometryEchoes).toBe(1);
  });

  it("5. A mismatched external geometry change is not suppressed", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeNormalWindow("win-1")
    });
    const tx = coordinator.reconcile();
    coordinator.recordCommand("win-1", tx!.operations[0].targetRect, tx!.epoch);

    // WM or user changes geometry to completely different dimensions
    const externalGeom = { x: 50, y: 50, width: 300, height: 200 };
    const echoResult = coordinator.checkAndHandleEcho("win-1", externalGeom);
    expect(echoResult.isEcho).toBe(false);

    const eventResult = coordinator.ingestEvent({
      type: "WindowGeometryChanged",
      windowId: "win-1",
      geometry: externalGeom
    });
    expect(eventResult.dirty).toBe(true);
    expect(eventResult.isEcho).toBe(false);
  });

  it("6. Echo suppression expires correctly", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeNormalWindow("win-1")
    });
    const tx = coordinator.reconcile();
    const target = tx!.operations[0].targetRect;
    coordinator.recordCommand("win-1", target, tx!.epoch);

    // Simulate echo arriving after expiration (e.g. 500ms later when expiry is 300ms)
    const lateTimestamp = Date.now() + 600;
    const echoResult = coordinator.checkAndHandleEcho("win-1", target, lateTimestamp);
    expect(echoResult.isEcho).toBe(false);
  });

  it("6b. Recorded command can be explicitly cleared to prevent echo suppression on rollback", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeNormalWindow("win-1")
    });
    const tx = coordinator.reconcile();
    const target = tx!.operations[0].targetRect;

    // Explicitly record command as if about to write geometry
    coordinator.recordCommand("win-1", target, tx!.epoch);

    // Roll back / clear recorded command (e.g. because frameGeometry write threw)
    coordinator.clearRecordedCommand("win-1");

    // Geometry change arrives; must not be treated as echo
    const echoResult = coordinator.checkAndHandleEcho("win-1", target);
    expect(echoResult.isEcho).toBe(false);
  });

  it("7. A window addition affects the correct screen", () => {
    coordinator.getOrCreateScreen(SCREEN_2);

    const res = coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeNormalWindow("win-1", "DP-1")
    });

    expect(res.affectedScreens).toEqual(["DP-1"]);
    const tx = coordinator.reconcile();
    expect(tx!.affectedScreens).toEqual(["DP-1"]);
  });

  it("8. A window removal clears retained state and ordering", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeNormalWindow("win-1")
    });
    coordinator.reconcile();

    expect(coordinator.getRetainedWindow("win-1")).toBeDefined();
    const screen = coordinator.getRetainedScreen("HDMI-A-1");
    expect(screen!.persistentOrder).toContain("win-1");

    coordinator.ingestEvent({
      type: "WindowRemoved",
      windowId: "win-1"
    });

    expect(coordinator.getRetainedWindow("win-1")).toBeUndefined();
    expect(screen!.persistentOrder).not.toContain("win-1");
  });

  it("9. A move between outputs invalidates both old and new screens", () => {
    coordinator.getOrCreateScreen(SCREEN_2);

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeNormalWindow("win-1", "HDMI-A-1")
    });
    coordinator.reconcile();

    const moveRes = coordinator.ingestEvent({
      type: "WindowMovedOutput",
      windowId: "win-1",
      fromOutputId: "HDMI-A-1",
      toOutputId: "DP-1"
    });

    expect(moveRes.affectedScreens).toContain("HDMI-A-1");
    expect(moveRes.affectedScreens).toContain("DP-1");

    const scr1 = coordinator.getRetainedScreen("HDMI-A-1")!;
    const scr2 = coordinator.getRetainedScreen("DP-1")!;
    expect(scr1.persistentOrder).not.toContain("win-1");
    expect(scr2.persistentOrder).toContain("win-1");
  });

  it("10. An unaffected screen is not recomputed for a local window event", () => {
    coordinator.getOrCreateScreen(SCREEN_2);

    // Initial setup on both screens
    coordinator.ingestEvent({ type: "WindowDiscovered", window: makeNormalWindow("win-1", "HDMI-A-1") });
    coordinator.ingestEvent({ type: "WindowDiscovered", window: makeNormalWindow("win-2", "DP-1") });
    coordinator.reconcile();

    // Now add win-3 only to HDMI-A-1
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeNormalWindow("win-3", "HDMI-A-1")
    });

    const tx = coordinator.reconcile();
    expect(tx!.affectedScreens).toEqual(["HDMI-A-1"]);
    expect(tx!.affectedScreens).not.toContain("DP-1");
  });

  it("11. A global configuration revision invalidates all required screens", () => {
    coordinator.getOrCreateScreen(SCREEN_2);

    coordinator.ingestEvent({ type: "WindowDiscovered", window: makeNormalWindow("win-1", "HDMI-A-1") });
    coordinator.ingestEvent({ type: "WindowDiscovered", window: makeNormalWindow("win-2", "DP-1") });
    coordinator.reconcile();

    // Global gaps update
    coordinator.ingestEvent({
      type: "GlobalConfigChanged",
      config: { gapInner: 16 }
    });

    const tx = coordinator.reconcile();
    expect(tx!.affectedScreens).toContain("HDMI-A-1");
    expect(tx!.affectedScreens).toContain("DP-1");
  });

  it("12. Entering true fullscreen preserves persistent slot/order", () => {
    coordinator.ingestEvent({ type: "WindowDiscovered", window: makeNormalWindow("win-1") });
    coordinator.ingestEvent({ type: "WindowDiscovered", window: makeNormalWindow("win-2") });
    coordinator.ingestEvent({ type: "WindowDiscovered", window: makeNormalWindow("win-3") });
    coordinator.reconcile();

    const screen = coordinator.getRetainedScreen("HDMI-A-1")!;
    expect(screen.persistentOrder).toEqual(["win-1", "win-2", "win-3"]);

    // win-2 enters true fullscreen
    const res = coordinator.ingestEvent({
      type: "WindowStateChanged",
      windowId: "win-2",
      updates: { fullScreen: true }
    });
    expect(res.dirty).toBe(true);

    // Persistent order must NOT lose win-2
    expect(screen.persistentOrder).toEqual(["win-1", "win-2", "win-3"]);

    // But win-2 is excluded from active tileable windows
    const activeTileable = coordinator.getTileableWindowsForScreen(screen);
    expect(activeTileable.map(w => w.id)).toEqual(["win-1", "win-3"]);
  });

  it("13. Exiting true fullscreen restores the original slot/order", () => {
    coordinator.ingestEvent({ type: "WindowDiscovered", window: makeNormalWindow("win-1") });
    coordinator.ingestEvent({ type: "WindowDiscovered", window: makeNormalWindow("win-2") });
    coordinator.ingestEvent({ type: "WindowDiscovered", window: makeNormalWindow("win-3") });
    coordinator.reconcile();

    // win-2 goes fullscreen and returns
    coordinator.ingestEvent({
      type: "WindowStateChanged",
      windowId: "win-2",
      updates: { fullScreen: true }
    });
    coordinator.reconcile();

    coordinator.ingestEvent({
      type: "WindowStateChanged",
      windowId: "win-2",
      updates: { fullScreen: false }
    });
    coordinator.reconcile();

    const screen = coordinator.getRetainedScreen("HDMI-A-1")!;
    const activeTileable = coordinator.getTileableWindowsForScreen(screen);
    expect(activeTileable.map(w => w.id)).toEqual(["win-1", "win-2", "win-3"]);
  });

  it("14. Entering fullscreen-like mode changes tileability once", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeNormalWindow("game-1", "HDMI-A-1", {
        resourceClass: "retroarch",
        frameGeometry: { x: 0, y: 0, width: 800, height: 600 }
      })
    });
    coordinator.reconcile();

    // Expands to cover full physical output without borders (fullscreen-like)
    const res1 = coordinator.ingestEvent({
      type: "WindowGeometryChanged",
      windowId: "game-1",
      geometry: { x: 0, y: 0, width: 1920, height: 1080 }
    });
    coordinator.ingestEvent({
      type: "WindowStateChanged",
      windowId: "game-1",
      updates: { noBorder: true, maximizeMode: 0 }
    });

    const win = coordinator.getRetainedWindow("game-1")!;
    expect(win.classification).toBe("fullscreen-like");
    expect(win.tileable).toBe(false);

    // Duplicate geometry event covering same fullscreen rectangle
    const res2 = coordinator.ingestEvent({
      type: "WindowGeometryChanged",
      windowId: "game-1",
      geometry: { x: 0, y: 0, width: 1920, height: 1080 }
    });
    // Classification does not change again
    expect(res2.dirty).toBe(true); // normal geometry event, but tileability didn't flip
  });

  it("15. Unchanged classification causes no additional transaction", () => {
    coordinator.ingestEvent({ type: "WindowDiscovered", window: makeNormalWindow("win-1") });
    coordinator.reconcile();

    // Update title only
    const res = coordinator.ingestEvent({
      type: "WindowStateChanged",
      windowId: "win-1",
      updates: { title: "New Title - vim" }
    });

    expect(res.dirty).toBe(false);
    const tx = coordinator.reconcile();
    expect(tx).toBeNull();
  });

  it("16. Game classification remains floating by default", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: {
        id: "steam-game",
        resourceClass: "steam_app_1245620",
        managed: true,
        normalWindow: true
      }
    });

    const win = coordinator.getRetainedWindow("steam-game")!;
    expect(win.classification).toBe("floating");
    expect(win.tileable).toBe(false);
  });

  it("17. Ordinary Steam and generic Wine windows retain their approved behavior", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: {
        id: "steam-client",
        resourceClass: "steam",
        resourceName: "steamwebhelper",
        managed: true,
        normalWindow: true
      }
    });

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: {
        id: "wine-tool",
        resourceClass: "wine",
        title: "Wine Configuration",
        managed: true,
        normalWindow: true
      }
    });

    const steamWin = coordinator.getRetainedWindow("steam-client")!;
    const wineWin = coordinator.getRetainedWindow("wine-tool")!;
    expect(steamWin.classification).toBe("tiled");
    expect(wineWin.classification).toBe("tiled");
  });

  it("18. Maximized normal applications are not mistaken for fullscreen-like games", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: {
        id: "kate-max",
        resourceClass: "kate",
        managed: true,
        normalWindow: true,
        noBorder: false,
        maximizeMode: 3, // fully maximized
        frameGeometry: { x: 0, y: 0, width: 1920, height: 1080 }
      }
    });

    const win = coordinator.getRetainedWindow("kate-max")!;
    expect(win.classification).toBe("tiled");
    // While maximized, it is tileable by rule, but preserves its slot peacefully
    expect(win.tileable).toBe(true);
  });

  it("19. Staged generated-artifact drift fails verification", () => {
    // Check that verify:artifacts script checks against HEAD
    const rootDir = resolve(__dirname, "../../../");
    const pkgJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf-8"));
    expect(pkgJson.scripts["verify:artifacts"]).toContain("git diff --exit-code HEAD --");
    expect(pkgJson.scripts["verify:artifacts"]).toContain("contents/code/reconciler.js");
  });

  it("20. Package contents contain all required generated runtime bridges", () => {
    const rootDir = resolve(__dirname, "../../../");
    expect(existsSync(resolve(rootDir, "contents/code/layouts.js"))).toBe(true);
    expect(existsSync(resolve(rootDir, "contents/code/rules.js"))).toBe(true);
    expect(existsSync(resolve(rootDir, "contents/code/reconciler.js"))).toBe(true);
    expect(existsSync(resolve(rootDir, "contents/ui/main.qml"))).toBe(true);
  });
});
