import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeCoordinator } from "../src/runtime-coordinator.js";
import type {
  NormalizedScreenInput,
  NormalizedWindowInput,
} from "../src/coordinator-types.js";
import { computeSnapZones, matchSnapZoneHover } from "../src/snap-zones.js";

describe("Scoped Slot Ordering and Runtime Authority", () => {
  let coordinator: RuntimeCoordinator;

  const SCREEN_0: NormalizedScreenInput = {
    outputId: "HDMI-A-1",
    name: "HDMI-A-1",
    geometry: { x: 0, y: 0, width: 1920, height: 1080 },
    usableArea: { x: 0, y: 0, width: 1920, height: 1080 },
    activeDesktopId: "1",
  };

  const SCREEN_1: NormalizedScreenInput = {
    outputId: "DP-1",
    name: "DP-1",
    geometry: { x: 1920, y: 0, width: 1920, height: 1080 },
    usableArea: { x: 1920, y: 0, width: 1920, height: 1080 },
    activeDesktopId: "1",
  };

  const makeWindow = (
    id: string,
    outputId: string = "HDMI-A-1",
    desktopId: string = "1",
    extra: Partial<NormalizedWindowInput> = {}
  ): NormalizedWindowInput => ({
    id,
    resourceClass: "kitty",
    resourceName: "kitty",
    title: "Terminal",
    outputId,
    desktopId,
    frameGeometry: { x: 100, y: 100, width: 600, height: 400 },
    managed: true,
    normalWindow: true,
    tileable: true,
    ...extra,
  });

  beforeEach(() => {
    coordinator = new RuntimeCoordinator({
      enableTiling: true,
      defaultLayout: "master-stack",
      gapInner: 10,
      gapOuter: 20,
      masterRatio: 0.5,
      masterCount: 1,
    });
    coordinator.getOrCreateScreen(SCREEN_0);
    coordinator.getOrCreateScreen(SCREEN_1);
  });

  it("maintains separate slot orders per desktop on the same screen", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w1", "HDMI-A-1", "1"),
    });
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w2", "HDMI-A-1", "1"),
    });
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w3", "HDMI-A-1", "2"),
    });
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w4", "HDMI-A-1", "2"),
    });

    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w1", "w2"]);
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "2").orderedSlotWindowIds).toEqual(["w3", "w4"]);
  });

  it("does not truncate slot order when a window becomes fullscreen or minimized", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w1", "HDMI-A-1", "1"),
    });
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w2", "HDMI-A-1", "1"),
    });
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w3", "HDMI-A-1", "1"),
    });

    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w1", "w2", "w3"]);

    // w2 goes fullscreen
    coordinator.ingestEvent({
      type: "WindowStateChanged",
      windowId: "w2",
      updates: { fullScreen: true },
    });
    // w2 must still be present in the canonical slot ordering
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w1", "w2", "w3"]);

    // w2 un-fullscreens
    coordinator.ingestEvent({
      type: "WindowStateChanged",
      windowId: "w2",
      updates: { fullScreen: false },
    });
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w1", "w2", "w3"]);

    // w1 is minimized
    coordinator.ingestEvent({
      type: "WindowStateChanged",
      windowId: "w1",
      updates: { minimized: true },
    });
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w1", "w2", "w3"]);

    // w1 un-minimizes
    coordinator.ingestEvent({
      type: "WindowStateChanged",
      windowId: "w1",
      updates: { minimized: false },
    });
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w1", "w2", "w3"]);
  });

  it("supports explicit slot manipulation: moveWindowToSlot, moveWindowToFirstSlot, swapWindowSlots", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w1", "HDMI-A-1", "1"),
    });
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w2", "HDMI-A-1", "1"),
    });
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w3", "HDMI-A-1", "1"),
    });

    // Initial order: w1, w2, w3
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w1", "w2", "w3"]);

    // Move w3 to slot 0
    coordinator.moveWindowToSlot("w3", 0);
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w3", "w1", "w2"]);

    // Move w1 to first slot
    coordinator.moveWindowToFirstSlot("w1");
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w1", "w3", "w2"]);

    // Swap slots between w1 and w2
    coordinator.swapWindowSlots("w1", "w2");
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w2", "w3", "w1"]);
  });

  it("cleans up removed windows from workspace slot ordering", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w1", "HDMI-A-1", "1"),
    });
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w2", "HDMI-A-1", "1"),
    });

    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w1", "w2"]);

    coordinator.ingestEvent({
      type: "WindowRemoved",
      windowId: "w1",
    });
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w2"]);
  });

  it("maps corner snap zones to distinct and unambiguous slot indices", () => {
    const area = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 20, 10);

    // Top-left
    const tlIdx = matchSnapZoneHover(zones, { x: 10, y: 10 });
    expect(tlIdx).toBeGreaterThanOrEqual(0);
    expect(zones[tlIdx].id).toBe("top-left");
    expect(zones[tlIdx].slotIndex).toBe(0);

    // Top-right
    const trIdx = matchSnapZoneHover(zones, { x: 1910, y: 10 });
    expect(trIdx).toBeGreaterThanOrEqual(0);
    expect(zones[trIdx].id).toBe("top-right");
    expect(zones[trIdx].slotIndex).toBe(1);

    // Bottom-right
    const brIdx = matchSnapZoneHover(zones, { x: 1910, y: 1070 });
    expect(brIdx).toBeGreaterThanOrEqual(0);
    expect(zones[brIdx].id).toBe("bottom-right");
    expect(zones[brIdx].slotIndex).toBe(2);

    // Bottom-left
    const blIdx = matchSnapZoneHover(zones, { x: 10, y: 1070 });
    expect(blIdx).toBeGreaterThanOrEqual(0);
    expect(zones[blIdx].id).toBe("bottom-left");
    expect(zones[blIdx].slotIndex).toBe(3);
  });

  it("supports windows assigned to multiple virtual desktops without collapsing memberships", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w1", "HDMI-A-1", "1", {
        desktopIds: ["1", "2"],
      }),
    });

    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toContain("w1");
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "2").orderedSlotWindowIds).toContain("w1");
  });

  it("handles sticky windows (onAllDesktops) participating across active desktops on the output", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w-sticky", "HDMI-A-1", "1", {
        onAllDesktops: true,
      }),
    });

    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toContain("w-sticky");

    // Switch active desktop on screen to desktop 2
    coordinator.ingestEvent({
      type: "ScreenDesktopChanged",
      outputId: "HDMI-A-1",
      toDesktopId: "2",
    });

    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "2").orderedSlotWindowIds).toContain("w-sticky");
  });

  it("updates memberships cleanly when desktop assignments change via WindowDesktopsChanged", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w1", "HDMI-A-1", "1", {
        desktopIds: ["1", "2"],
      }),
    });

    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toContain("w1");
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "2").orderedSlotWindowIds).toContain("w1");

    // Window moved from desktops [1, 2] to [2, 3]
    coordinator.ingestEvent({
      type: "WindowDesktopsChanged",
      windowId: "w1",
      desktopIds: ["2", "3"],
      onAllDesktops: false,
    });

    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).not.toContain("w1");
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "2").orderedSlotWindowIds).toContain("w1");
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "3").orderedSlotWindowIds).toContain("w1");
  });

  it("uses a global-scope sentinel when perDesktopLayout is false", () => {
    const globalCoord = new RuntimeCoordinator({
      enableTiling: true,
      defaultLayout: "master-stack",
      perDesktopLayout: false,
    });
    globalCoord.getOrCreateScreen(SCREEN_0);

    globalCoord.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w1", "HDMI-A-1", "1"),
    });
    globalCoord.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w2", "HDMI-A-1", "2"),
    });

    // When perDesktopLayout is false, both windows share the single global workspace on this screen
    const globalWs = globalCoord.getOrCreateWorkspace("HDMI-A-1", "__global__");
    expect(globalWs.orderedSlotWindowIds).toEqual(["w1", "w2"]);
  });

  it("preserves normalized activity list without accidental first-activity authority", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w1", "HDMI-A-1", "1", {
        activities: ["activity-alpha", "activity-beta"],
      }),
    });

    const retained = coordinator.getRetainedWindow("w1");
    expect(retained?.activities).toEqual(["activity-alpha", "activity-beta"]);
  });

  it("generates collision-safe scope keys even when outputId contains colons or delimiters", () => {
    const key1 = coordinator.getWorkspaceScopeKey("DP-1:0", "1");
    const key2 = coordinator.getWorkspaceScopeKey("DP-1", "0:1");
    expect(key1).not.toEqual(key2);
  });

  it("keeps a real desktop named __global__ distinct from global-layout mode", () => {
    const local = new RuntimeCoordinator({ perDesktopLayout: true });
    const global = new RuntimeCoordinator({ perDesktopLayout: false });

    const localKey = local.getOrCreateWorkspace("DP-1", "__global__").scopeKey;
    const globalKey = global.getOrCreateWorkspace("DP-1", "__global__").scopeKey;

    expect(localKey).not.toBe(globalKey);
    expect(localKey).toBe("DP-1//__global__");
    expect(globalKey).toContain("%00tessera-global");
  });

  it("preserves every desktop membership when a multi-desktop window is snapped", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("multi", "HDMI-A-1", "1", { desktopIds: ["1", "2"] }),
    });

    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "multi",
      outputId: "DP-1",
      desktopId: "2",
      targetRect: { x: 1920, y: 0, width: 960, height: 1080 },
      slotIndex: 0,
    });

    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).not.toContain("multi");
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "2").orderedSlotWindowIds).not.toContain("multi");
    expect(coordinator.getOrCreateWorkspace("DP-1", "1").orderedSlotWindowIds).toContain("multi");
    expect(coordinator.getOrCreateWorkspace("DP-1", "2").orderedSlotWindowIds).toContain("multi");
    expect(coordinator.getRetainedWindow("multi")?.desktopIds).toEqual(["1", "2"]);
  });

  it("rebuilds memberships when per-desktop layout mode changes", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w1", "HDMI-A-1", "1"),
    });
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("w2", "HDMI-A-1", "2"),
    });

    coordinator.updateConfig({ perDesktopLayout: false });
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w1", "w2"]);

    coordinator.updateConfig({ perDesktopLayout: true });
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w1"]);
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "2").orderedSlotWindowIds).toEqual(["w2"]);
  });

  it("loads canonical wildcard workspace overrides and migrates legacy maps", () => {
    const canonical = new RuntimeCoordinator({
      workspaceLayoutsJson: '{"version":1,"scopes":{"*//2":{"layout":"columns","ratio":0.6,"primaryCount":2}}}',
    });
    const overridden = canonical.getOrCreateWorkspace("DP-9", "2");
    expect(overridden.activeLayout).toBe("columns");
    expect(overridden.primaryRegionRatio).toBe(0.6);
    expect(overridden.primaryRegionCount).toBe(2);
    expect(canonical.getWorkspaceLayoutConfigError()).toBeNull();

    const legacy = new RuntimeCoordinator({
      workspaceLayoutsJson: '{"DP-1//1":{"layout":"master-stack"}}',
    });
    expect(legacy.getOrCreateWorkspace("DP-1", "1").activeLayout).toBe("primary-stack");
    expect(legacy.getConfig().workspaceLayoutsJson).toBe(
      '{"version":1,"scopes":{"DP-1//1":{"layout":"primary-stack"}}}',
    );
  });

  it("fails closed on non-canonical or unsafe versioned workspace overrides", () => {
    const malformed = new RuntimeCoordinator({
      defaultLayout: "balanced-grid",
      workspaceLayoutsJson: '{"version":1, "scopes":{"__proto__//1":{"layout":"columns"}}}',
    });

    expect(malformed.getWorkspaceLayoutConfigError()).not.toBeNull();
    expect(malformed.getOrCreateWorkspace("DP-1", "1").activeLayout).toBe("balanced-grid");

    const duplicate = new RuntimeCoordinator({
      workspaceLayoutsJson: '{"version":1,"scopes":{},"scopes":{}}',
    });
    expect(duplicate.getWorkspaceLayoutConfigError()).toContain("duplicate JSON key");
  });

  it("removes retired screens and their workspace state during topology updates", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("orphan", "HDMI-A-1", "1"),
    });

    coordinator.ingestEvent({ type: "ScreenTopologyChanged", screens: [SCREEN_1] });

    expect(coordinator.getRetainedScreen("HDMI-A-1")).toBeUndefined();
    expect(coordinator.getWorkspace("HDMI-A-1", "1")).toBeUndefined();
    expect(coordinator.getRetainedWindow("orphan")?.outputId).toBe("DP-1");
    expect(coordinator.getOrCreateWorkspace("DP-1", "1").orderedSlotWindowIds).toContain("orphan");
  });

  it("treats repeated synchronization events as no-ops", () => {
    const input = makeWindow("stable", "HDMI-A-1", "1", {
      desktopIds: ["1"],
      activities: ["work"],
    });
    coordinator.ingestEvent({ type: "WindowDiscovered", window: input });
    coordinator.reconcile();

    expect(coordinator.ingestEvent({
      type: "WindowStateChanged",
      windowId: "stable",
      updates: {
        minimized: false,
        fullScreen: false,
        noBorder: false,
        maximizeMode: 0,
        frameGeometry: input.frameGeometry,
      },
    }).dirty).toBe(false);
    expect(coordinator.ingestEvent({
      type: "WindowDesktopsChanged",
      windowId: "stable",
      desktopIds: ["1"],
      onAllDesktops: false,
    }).dirty).toBe(false);
    expect(coordinator.ingestEvent({
      type: "WindowActivitiesChanged",
      windowId: "stable",
      activities: ["work"],
    }).dirty).toBe(false);
    expect(coordinator.ingestEvent({
      type: "ScreenTopologyChanged",
      screens: [SCREEN_0, SCREEN_1],
    }).dirty).toBe(false);
    expect(coordinator.reconcile()).toBeNull();
  });

  it("filters retained windows by the screen's active activity", () => {
    coordinator.ingestEvent({
      type: "ScreenTopologyChanged",
      screens: [{ ...SCREEN_0, activeActivityId: "work" }, SCREEN_1],
    });
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("work", "HDMI-A-1", "1", { activities: ["work"] }),
    });
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("play", "HDMI-A-1", "1", { activities: ["play"] }),
    });
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("all-activities", "HDMI-A-1", "1", { activities: [] }),
    });

    const screen = coordinator.getRetainedScreen("HDMI-A-1")!;
    expect(coordinator.getTileableWindowsForScreen(screen).map(win => win.id)).toEqual([
      "work",
      "all-activities",
    ]);
  });

  it("cleans every prior membership on an explicit desktop move", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("multi-move", "HDMI-A-1", "1", { desktopIds: ["1", "2"] }),
    });
    coordinator.ingestEvent({
      type: "WindowMovedDesktop",
      windowId: "multi-move",
      fromDesktopId: "1",
      toDesktopId: "3",
    });

    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).not.toContain("multi-move");
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "2").orderedSlotWindowIds).not.toContain("multi-move");
    expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "3").orderedSlotWindowIds).toContain("multi-move");
  });

  it("governs manual floating solely through reducer transition without pre-mutation", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWindow("float-win", "HDMI-A-1", "1"),
    });
    coordinator.reconcile();

    const screen = coordinator.getRetainedScreen("HDMI-A-1")!;
    expect(coordinator.getTileableWindowsForScreen(screen).map(w => w.id)).toEqual(["float-win"]);

    // Transition false -> true: must be dirty and mark screen
    const res1 = coordinator.setManualFloating("float-win", true);
    expect(res1.dirty).toBe(true);
    expect(res1.affectedScreens).toEqual(["HDMI-A-1"]);
    expect(coordinator.isManualFloating("float-win")).toBe(true);
    expect(coordinator.getTileableWindowsForScreen(screen).map(w => w.id)).toEqual([]);

    // Repeated transition true -> true: must be idempotent (dirty: false)
    const resRepeat = coordinator.setManualFloating("float-win", true);
    expect(resRepeat.dirty).toBe(false);

    // Transition true -> false: must be dirty and restore tileability
    const res2 = coordinator.setManualFloating("float-win", false);
    expect(res2.dirty).toBe(true);
    expect(res2.affectedScreens).toEqual(["HDMI-A-1"]);
    expect(coordinator.isManualFloating("float-win")).toBe(false);
    expect(coordinator.getTileableWindowsForScreen(screen).map(w => w.id)).toEqual(["float-win"]);
  });

  it("treats ScreenDesktopChanged as strictly idempotent when desktop is unchanged", () => {
    // SCREEN_0 starts with activeDesktopId "1"
    const noopRes = coordinator.ingestEvent({
      type: "ScreenDesktopChanged",
      outputId: "HDMI-A-1",
      toDesktopId: "1",
    });
    expect(noopRes.dirty).toBe(false);
    expect(noopRes.affectedScreens).toEqual([]);

    // Change desktop from "1" to "2"
    const changeRes = coordinator.ingestEvent({
      type: "ScreenDesktopChanged",
      outputId: "HDMI-A-1",
      toDesktopId: "2",
    });
    expect(changeRes.dirty).toBe(true);
    expect(changeRes.affectedScreens).toEqual(["HDMI-A-1"]);
    expect(coordinator.getRetainedScreen("HDMI-A-1")?.activeDesktopId).toBe("2");

    // Repeated call with "2" is a no-op
    const repeatRes = coordinator.ingestEvent({
      type: "ScreenDesktopChanged",
      outputId: "HDMI-A-1",
      toDesktopId: "2",
    });
    expect(repeatRes.dirty).toBe(false);
    expect(repeatRes.affectedScreens).toEqual([]);
  });

  describe("WindowSnapCommitted invariant state transitions", () => {
    it("1. performs same-output/same-desktop reorder without duplicates", () => {
      coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWindow("w1", "HDMI-A-1", "1") });
      coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWindow("w2", "HDMI-A-1", "1") });
      coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWindow("w3", "HDMI-A-1", "1") });

      expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w1", "w2", "w3"]);

      // Snap w3 to slot 0 on same output and desktop
      const res = coordinator.ingestEvent({
        type: "WindowSnapCommitted",
        windowId: "w3",
        outputId: "HDMI-A-1",
        desktopId: "1",
        targetRect: { x: 0, y: 0, width: 960, height: 1080 },
        slotIndex: 0,
      });

      expect(res.dirty).toBe(true);
      expect(res.affectedScreens).toEqual(["HDMI-A-1"]);
      expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w3", "w1", "w2"]);
    });

    it("2. performs cross-output move while strictly preserving desktopIds", () => {
      coordinator.ingestEvent({
        type: "WindowDiscovered",
        window: makeWindow("w_multi", "HDMI-A-1", "1", { desktopIds: ["1", "2"] }),
      });

      expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toContain("w_multi");
      expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "2").orderedSlotWindowIds).toContain("w_multi");

      // Snap to DP-1 without passing an explicit desktopId
      const res = coordinator.ingestEvent({
        type: "WindowSnapCommitted",
        windowId: "w_multi",
        outputId: "DP-1",
        targetRect: { x: 1920, y: 0, width: 960, height: 1080 },
        slotIndex: 0,
      });

      expect(res.dirty).toBe(true);
      expect(res.affectedScreens).toContain("DP-1");
      expect(res.affectedScreens).toContain("HDMI-A-1");

      // Removed from old output
      expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).not.toContain("w_multi");
      expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "2").orderedSlotWindowIds).not.toContain("w_multi");

      // Preserved desktopIds on new output
      const retained = coordinator.getRetainedWindow("w_multi")!;
      expect(retained.outputId).toBe("DP-1");
      expect(retained.desktopIds).toEqual(["1", "2"]);
      expect(coordinator.getOrCreateWorkspace("DP-1", "1").orderedSlotWindowIds).toContain("w_multi");
      expect(coordinator.getOrCreateWorkspace("DP-1", "2").orderedSlotWindowIds).toContain("w_multi");
    });

    it("3. moves to explicit target desktop leaving no stale source membership", () => {
      coordinator.ingestEvent({
        type: "WindowDiscovered",
        window: makeWindow("w_target", "HDMI-A-1", "1"),
      });

      expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).toEqual(["w_target"]);

      // Snap with explicit target desktop "3"
      const res = coordinator.ingestEvent({
        type: "WindowSnapCommitted",
        windowId: "w_target",
        outputId: "HDMI-A-1",
        desktopId: "3",
        targetRect: { x: 0, y: 0, width: 960, height: 1080 },
        slotIndex: 0,
      });

      expect(res.dirty).toBe(true);
      expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).not.toContain("w_target");
      expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "3").orderedSlotWindowIds).toEqual(["w_target"]);
      const retained = coordinator.getRetainedWindow("w_target")!;
      expect(retained.desktopId).toBe("3");
      expect(retained.desktopIds).toEqual(["3"]);
    });

    it("4. places sticky window strictly on target screen's active desktop", () => {
      // DP-1 has active desktop set to "2"
      coordinator.ingestEvent({
        type: "ScreenDesktopChanged",
        outputId: "DP-1",
        toDesktopId: "2",
      });

      coordinator.ingestEvent({
        type: "WindowDiscovered",
        window: makeWindow("w_sticky", "HDMI-A-1", "1", { onAllDesktops: true }),
      });

      // Snap sticky window across outputs to DP-1 (even if desktopId is unassigned or different)
      const res = coordinator.ingestEvent({
        type: "WindowSnapCommitted",
        windowId: "w_sticky",
        outputId: "DP-1",
        desktopId: "4", // Even if caller passed "4", sticky window must use target screen's active desktop "2"
        targetRect: { x: 1920, y: 0, width: 960, height: 1080 },
        slotIndex: 0,
      });

      expect(res.dirty).toBe(true);
      expect(coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds).not.toContain("w_sticky");
      expect(coordinator.getOrCreateWorkspace("DP-1", "2").orderedSlotWindowIds).toContain("w_sticky");
      expect(coordinator.getOrCreateWorkspace("DP-1", "1").orderedSlotWindowIds).not.toContain("w_sticky");
      expect(coordinator.getOrCreateWorkspace("DP-1", "4").orderedSlotWindowIds).not.toContain("w_sticky");
    });

    it("5. guarantees no duplicate membership under repeated or clamping snaps", () => {
      coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWindow("w_dup", "HDMI-A-1", "1") });
      coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWindow("w_other", "HDMI-A-1", "1") });

      // Repeated snaps into same workspace
      for (const slotIndex of [0, 5, 1, 0, 10]) {
        coordinator.ingestEvent({
          type: "WindowSnapCommitted",
          windowId: "w_dup",
          outputId: "HDMI-A-1",
          desktopId: "1",
          targetRect: { x: 0, y: 0, width: 960, height: 1080 },
          slotIndex,
        });
        const list = coordinator.getOrCreateWorkspace("HDMI-A-1", "1").orderedSlotWindowIds;
        const occurrences = list.filter(id => id === "w_dup").length;
        expect(occurrences).toBe(1);
      }
    });
  });
});
