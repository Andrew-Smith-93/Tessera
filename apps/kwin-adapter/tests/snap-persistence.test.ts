import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeCoordinator } from "../src/runtime-coordinator.js";
import { computeSnapZones } from "../src/snap-zones.js";
import type { NormalizedScreenInput, NormalizedWindowInput, ReconciliationTransaction } from "../src/coordinator-types.js";
import type { Rect } from "@tessera/protocol";

const SCREEN: NormalizedScreenInput = {
  outputId: "HDMI-A-1",
  name: "HDMI-A-1",
  geometry: { x: 0, y: 0, width: 1920, height: 1080 },
  usableArea: { x: 0, y: 0, width: 1920, height: 1080 },
  activeDesktopId: "1"
};

function makeWin(id: string, geom?: Rect): NormalizedWindowInput {
  return {
    id,
    resourceClass: "app",
    resourceName: "app",
    title: `App ${id}`,
    outputId: "HDMI-A-1",
    frameGeometry: geom || { x: 100, y: 100, width: 600, height: 400 },
    managed: true,
    normalWindow: true
  };
}

function applyCompositorLoop(coordinator: RuntimeCoordinator, tx: ReconciliationTransaction | null): void {
  if (!tx) return;
  for (const op of tx.operations) {
    coordinator.recordCommand(op.windowId, op.targetRect, tx.epoch);
    coordinator.checkAndHandleEcho(op.windowId, op.targetRect);
    const win = coordinator.getRetainedWindow(op.windowId);
    if (win) {
      win.frameGeometry = { ...op.targetRect };
      win.lastObservedGeometry = { ...op.targetRect };
    }
  }
}

describe("Production-Path Regressions: Region Occupancy Model", () => {
  let coordinator: RuntimeCoordinator;

  beforeEach(() => {
    coordinator = new RuntimeCoordinator({
      enableTiling: true,
      defaultLayout: "balanced-grid",
      gapInner: 8,
      gapOuter: 10,
      primaryRegionRatio: 0.50,
      primaryRegionCount: 1,
      geometryTolerancePx: 1
    });
    coordinator.getOrCreateScreen(SCREEN);
  });

  it("REG-01: existing unsnapped left-half peer plus quadrant drop keeps peer in left-half and leaves bottom-right empty", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 10, 8);
    const leftHalf = zones.find(z => z.id === "left-half")!;
    const topRight = zones.find(z => z.id === "top-right")!;

    // 1. Discover win-1 as an existing unsnapped window already placed in left-half
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-1", leftHalf.targetRect)
    });
    const txInit = coordinator.reconcile();
    applyCompositorLoop(coordinator, txInit);

    const win1State = coordinator.getRetainedWindow("win-1");
    expect(win1State).toBeDefined();

    // 2. Discover win-2 and drop into top-right quadrant
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-2")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-2",
      outputId: "HDMI-A-1",
      targetRect: topRight.targetRect,
      snapRegion: "top-right",
      slotIndex: topRight.slotIndex,
      desktopId: "1"
    });

    // 3. Reconcile
    const tx = coordinator.reconcile();
    expect(tx).not.toBeNull();
    applyCompositorLoop(coordinator, tx);

    const win1StateAfter = coordinator.getRetainedWindow("win-1")!;
    const win2StateAfter = coordinator.getRetainedWindow("win-2")!;

    // Assert actual transaction operations / final observed rectangles
    const win1Op = tx!.operations.find(op => op.windowId === "win-1");
    const win2Op = tx!.operations.find(op => op.windowId === "win-2");

    // win-1 must be kept in left-half (width ~946, height ~1060), not blown away to full width!
    if (win1Op) {
      expect(win1Op.targetRect.x).toBe(leftHalf.targetRect.x);
      expect(win1Op.targetRect.width).toBe(leftHalf.targetRect.width);
      expect(win1Op.targetRect.height).toBe(leftHalf.targetRect.height);
    }
    expect(win1StateAfter.frameGeometry.x).toBe(leftHalf.targetRect.x);
    expect(win1StateAfter.frameGeometry.width).toBe(leftHalf.targetRect.width);
    expect(win1StateAfter.frameGeometry.height).toBe(leftHalf.targetRect.height);

    // win-2 must retain top-right quadrant (height ~526, not 1060)
    expect(win2Op).toBeDefined();
    expect(win2Op!.targetRect).toEqual(topRight.targetRect);
    expect(win2StateAfter.frameGeometry).toEqual(topRight.targetRect);
  });

  it("REG-02: same-region collision allocates non-overlapping compatible regions without identical rects", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 10, 8);
    const topRight = zones.find(z => z.id === "top-right")!;
    const bottomRight = zones.find(z => z.id === "bottom-right")!;

    // 1. Drop win-1 into top-right
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-1")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-1",
      outputId: "HDMI-A-1",
      targetRect: topRight.targetRect,
      snapRegion: "top-right",
      slotIndex: topRight.slotIndex,
      desktopId: "1"
    });

    // 2. Drop win-2 into SAME top-right region
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-2")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-2",
      outputId: "HDMI-A-1",
      targetRect: topRight.targetRect,
      snapRegion: "top-right",
      slotIndex: topRight.slotIndex,
      desktopId: "1"
    });

    const tx = coordinator.reconcile();
    expect(tx).not.toBeNull();
    applyCompositorLoop(coordinator, tx);

    const win1State = coordinator.getRetainedWindow("win-1")!;
    const win2State = coordinator.getRetainedWindow("win-2")!;

    const win1Op = tx!.operations.find(op => op.windowId === "win-1");
    const win2Op = tx!.operations.find(op => op.windowId === "win-2");
    expect(win1Op).toBeDefined();
    expect(win2Op).toBeDefined();

    // Actual transaction operations MUST NOT be identical!
    expect(win1Op!.targetRect).not.toEqual(win2Op!.targetRect);
    expect(win1State.frameGeometry).not.toEqual(win2State.frameGeometry);

    // One occupies top-right, the other occupies bottom-right
    const yCoordinates = [win1State.frameGeometry.y, win2State.frameGeometry.y].sort((a, b) => a - b);
    expect(yCoordinates[0]).toBe(topRight.targetRect.y);
    expect(yCoordinates[1]).toBe(bottomRight.targetRect.y);
  });

  it("REG-03: center-pillar conflicts with center-top/bottom: center-full transitions to center-bottom", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 10, 8);
    const centerPillar = zones.find(z => z.id === "center-pillar")!;
    const centerTop = zones.find(z => z.id === "center-top")!;
    const centerBottom = zones.find(z => z.id === "center-bottom")!;

    // 1. Drop win-1 into center-pillar (full height)
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-1")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-1",
      outputId: "HDMI-A-1",
      targetRect: centerPillar.targetRect,
      snapRegion: "center-pillar",
      slotIndex: centerPillar.slotIndex,
      desktopId: "1"
    });

    const tx1 = coordinator.reconcile();
    applyCompositorLoop(coordinator, tx1);

    // 2. Drop win-2 into center-top
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-2")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-2",
      outputId: "HDMI-A-1",
      targetRect: centerTop.targetRect,
      snapRegion: "center-top",
      slotIndex: centerTop.slotIndex,
      desktopId: "1"
    });

    const tx2 = coordinator.reconcile();
    expect(tx2).not.toBeNull();
    applyCompositorLoop(coordinator, tx2);

    const win1State = coordinator.getRetainedWindow("win-1")!;
    const win2State = coordinator.getRetainedWindow("win-2")!;

    const win1Op = tx2!.operations.find(op => op.windowId === "win-1");
    const win2Op = tx2!.operations.find(op => op.windowId === "win-2");

    expect(win2Op).toBeDefined();
    expect(win2Op!.targetRect).toEqual(centerTop.targetRect);
    expect(win2State.frameGeometry).toEqual(centerTop.targetRect);

    // win-1 must have transitioned to center-bottom to resolve conflict with win-2!
    expect(win1Op).toBeDefined();
    expect(win1Op!.targetRect).toEqual(centerBottom.targetRect);
    expect(win1State.frameGeometry).toEqual(centerBottom.targetRect);
  });

  it("REG-04: repeated reconciliation is idempotent with 0 geometry writes after initial commit", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 10, 8);
    const leftHalf = zones.find(z => z.id === "left-half")!;
    const topRight = zones.find(z => z.id === "top-right")!;

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-1")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-1",
      outputId: "HDMI-A-1",
      targetRect: leftHalf.targetRect,
      snapRegion: "left-half",
      desktopId: "1"
    });

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-2")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-2",
      outputId: "HDMI-A-1",
      targetRect: topRight.targetRect,
      snapRegion: "top-right",
      desktopId: "1"
    });

    const tx1 = coordinator.reconcile();
    expect(tx1).not.toBeNull();
    applyCompositorLoop(coordinator, tx1);

    // Run 5 consecutive reconciliations through compositor loop
    for (let i = 0; i < 5; i++) {
      coordinator.markScreenDirty("HDMI-A-1", "IdleCheck");
      const tx = coordinator.reconcile();
      if (tx) {
        expect(tx.operations.length).toBe(0);
      }
    }
  });

  it("REG-05: output geometry changes recalculate proportional regions preserving snap positions", () => {
    const area1: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones1 = computeSnapZones(area1, 10, 8);
    const leftHalf1 = zones1.find(z => z.id === "left-half")!;
    const topRight1 = zones1.find(z => z.id === "top-right")!;

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-1")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-1",
      outputId: "HDMI-A-1",
      targetRect: leftHalf1.targetRect,
      snapRegion: "left-half",
      desktopId: "1"
    });

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-2")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-2",
      outputId: "HDMI-A-1",
      targetRect: topRight1.targetRect,
      snapRegion: "top-right",
      desktopId: "1"
    });

    const tx1 = coordinator.reconcile();
    applyCompositorLoop(coordinator, tx1);

    // Change screen geometry to 2560x1440
    const screen2560: NormalizedScreenInput = {
      outputId: "HDMI-A-1",
      geometry: { x: 0, y: 0, width: 2560, height: 1440 },
      usableArea: { x: 0, y: 0, width: 2560, height: 1440 },
      activeDesktopId: "1"
    };
    const txTopology = coordinator.handleTopologyChange([screen2560]);
    expect(txTopology).not.toBeNull();
    applyCompositorLoop(coordinator, txTopology);

    const zones2 = computeSnapZones(screen2560.usableArea, 10, 8);
    const leftHalf2 = zones2.find(z => z.id === "left-half")!;
    const topRight2 = zones2.find(z => z.id === "top-right")!;

    const win1State = coordinator.getRetainedWindow("win-1")!;
    const win2State = coordinator.getRetainedWindow("win-2")!;

    expect(win1State.frameGeometry).toEqual(leftHalf2.targetRect);
    expect(win2State.frameGeometry).toEqual(topRight2.targetRect);
  });

  it("REG-06: keyboard resized window retains custom bounds across subsequent reconciliations", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 10, 8);
    const topRight = zones.find(z => z.id === "top-right")!;

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-1")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-1",
      outputId: "HDMI-A-1",
      targetRect: topRight.targetRect,
      snapRegion: "top-right",
      desktopId: "1"
    });

    const tx1 = coordinator.reconcile();
    applyCompositorLoop(coordinator, tx1);

    // User resizes win-1 via keyboard
    const customResizedRect: Rect = {
      x: topRight.targetRect.x - 50,
      y: topRight.targetRect.y,
      width: topRight.targetRect.width + 50,
      height: topRight.targetRect.height
    };
    coordinator.setCustomTiledGeometry("win-1", customResizedRect);

    // Another event triggers reconcile
    coordinator.markScreenDirty("HDMI-A-1", "ExternalTrigger");
    const tx2 = coordinator.reconcile();
    applyCompositorLoop(coordinator, tx2);

    const win1State = coordinator.getRetainedWindow("win-1")!;
    expect(win1State.frameGeometry).toEqual(customResizedRect);
  });

  it("REG-07: cross-family geometric collision: left-half peer + center-pillar drop adapts left-half to left-pillar with zero geometric overlap", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 10, 8);
    const leftHalf = zones.find(z => z.id === "left-half")!;
    const centerPillar = zones.find(z => z.id === "center-pillar")!;
    const leftPillar = zones.find(z => z.id === "left-pillar")!;

    // 1. Existing window in left-half
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-1", leftHalf.targetRect)
    });
    const tx1 = coordinator.reconcile();
    applyCompositorLoop(coordinator, tx1);

    // 2. Drop second window into center-pillar
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-2")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-2",
      outputId: "HDMI-A-1",
      targetRect: centerPillar.targetRect,
      snapRegion: "center-pillar",
      desktopId: "1"
    });

    const tx2 = coordinator.reconcile();
    expect(tx2).not.toBeNull();
    applyCompositorLoop(coordinator, tx2);

    const win1State = coordinator.getRetainedWindow("win-1")!;
    const win2State = coordinator.getRetainedWindow("win-2")!;

    // Requested drop target win-2 must retain center-pillar
    expect(win2State.frameGeometry).toEqual(centerPillar.targetRect);
    // win-1 must adapt to left-pillar
    expect(win1State.frameGeometry).toEqual(leftPillar.targetRect);

    // Assert zero geometric overlap
    const xOverlap = Math.max(0, Math.min(win1State.frameGeometry.x + win1State.frameGeometry.width, win2State.frameGeometry.x + win2State.frameGeometry.width) - Math.max(win1State.frameGeometry.x, win2State.frameGeometry.x));
    expect(xOverlap).toBe(0);
  });

  it("REG-08: cross-family geometric collision: top-left quadrant peer + center-top drop adapts top-left to left-pillar-top with zero geometric overlap", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 10, 8);
    const topLeft = zones.find(z => z.id === "top-left")!;
    const centerTop = zones.find(z => z.id === "center-top")!;
    const leftPillar = zones.find(z => z.id === "left-pillar")!;

    // 1. Existing window in top-left
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-1", topLeft.targetRect)
    });
    const tx1 = coordinator.reconcile();
    applyCompositorLoop(coordinator, tx1);

    // 2. Drop second window into center-top
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-2")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-2",
      outputId: "HDMI-A-1",
      targetRect: centerTop.targetRect,
      snapRegion: "center-top",
      desktopId: "1"
    });

    const tx2 = coordinator.reconcile();
    expect(tx2).not.toBeNull();
    applyCompositorLoop(coordinator, tx2);

    const win1State = coordinator.getRetainedWindow("win-1")!;
    const win2State = coordinator.getRetainedWindow("win-2")!;

    // Requested drop target win-2 must retain center-top
    expect(win2State.frameGeometry).toEqual(centerTop.targetRect);
    // win-1 must adapt to left-pillar-top (same X as leftPillar, top half height)
    expect(win1State.frameGeometry.x).toBe(leftPillar.targetRect.x);
    expect(win1State.frameGeometry.width).toBe(leftPillar.targetRect.width);

    // Assert zero geometric overlap
    const xOverlap = Math.max(0, Math.min(win1State.frameGeometry.x + win1State.frameGeometry.width, win2State.frameGeometry.x + win2State.frameGeometry.width) - Math.max(win1State.frameGeometry.x, win2State.frameGeometry.x));
    const yOverlap = Math.max(0, Math.min(win1State.frameGeometry.y + win1State.frameGeometry.height, win2State.frameGeometry.y + win2State.frameGeometry.height) - Math.max(win1State.frameGeometry.y, win2State.frameGeometry.y));
    expect(xOverlap * yOverlap).toBe(0);
  });

  it("REG-09: WindowSnapCommitted clears existing customTiledGeometry so subsequent snap drop takes newly chosen region", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 10, 8);
    const leftHalf = zones.find(z => z.id === "left-half")!;
    const rightHalf = zones.find(z => z.id === "right-half")!;

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-1")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-1",
      outputId: "HDMI-A-1",
      targetRect: leftHalf.targetRect,
      snapRegion: "left-half",
      desktopId: "1"
    });
    const tx1 = coordinator.reconcile();
    applyCompositorLoop(coordinator, tx1);

    // 1. User performs custom resize
    const customRect: Rect = { x: 10, y: 10, width: 700, height: 900 };
    coordinator.setCustomTiledGeometry("win-1", customRect);
    const win1Before = coordinator.getRetainedWindow("win-1")!;
    expect(win1Before.customTiledGeometry).toEqual(customRect);

    // 2. User drags and drops window into right-half
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-1",
      outputId: "HDMI-A-1",
      targetRect: rightHalf.targetRect,
      snapRegion: "right-half",
      desktopId: "1"
    });

    // Custom tiled geometry must be cleared!
    const win1AfterSnap = coordinator.getRetainedWindow("win-1")!;
    expect(win1AfterSnap.customTiledGeometry).toBeNull();

    // 3. Reconcile
    const tx2 = coordinator.reconcile();
    applyCompositorLoop(coordinator, tx2);

    expect(win1AfterSnap.frameGeometry).toEqual(rightHalf.targetRect);
  });

  it("REG-10: custom resize bounds validation clamps out-of-bounds, negative, or changed-output rectangles and avoids zero/negative rectangles under overcrowding", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-1")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-1",
      outputId: "HDMI-A-1",
      targetRect: { x: 10, y: 10, width: 940, height: 1060 },
      snapRegion: "left-half",
      desktopId: "1"
    });

    // Invalid negative custom rect completely off-screen
    coordinator.setCustomTiledGeometry("win-1", { x: -2000, y: -2000, width: 500, height: 500 });
    const tx = coordinator.reconcile();
    applyCompositorLoop(coordinator, tx);

    const win1State = coordinator.getRetainedWindow("win-1")!;
    // Must not be negative or offscreen
    expect(win1State.frameGeometry.x).toBeGreaterThanOrEqual(0);
    expect(win1State.frameGeometry.y).toBeGreaterThanOrEqual(0);
    expect(win1State.frameGeometry.width).toBeGreaterThan(0);
    expect(win1State.frameGeometry.height).toBeGreaterThan(0);

    // Overcrowding test: 8 windows in left-half
    for (let i = 2; i <= 8; i++) {
      coordinator.ingestEvent({
        type: "WindowDiscovered",
        window: makeWin(`win-${i}`)
      });
      coordinator.ingestEvent({
        type: "WindowSnapCommitted",
        windowId: `win-${i}`,
        outputId: "HDMI-A-1",
        targetRect: { x: 10, y: 10, width: 940, height: 1060 },
        snapRegion: "left-half",
        desktopId: "1"
      });
    }

    const txOvercrowded = coordinator.reconcile();
    applyCompositorLoop(coordinator, txOvercrowded);

    for (let i = 1; i <= 8; i++) {
      const w = coordinator.getRetainedWindow(`win-${i}`)!;
      expect(w.frameGeometry.width).toBeGreaterThanOrEqual(40);
      expect(w.frameGeometry.height).toBeGreaterThanOrEqual(30);
      expect(w.frameGeometry.x).toBeGreaterThanOrEqual(0);
      expect(w.frameGeometry.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("REG-11: full three-pillar occupancy: left-pillar, center-pillar, and right-pillar windows coexist with zero overlap and preserve requested drop target", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 10, 8);
    const leftPillar = zones.find(z => z.id === "left-pillar")!;
    const centerPillar = zones.find(z => z.id === "center-pillar")!;
    const rightPillar = zones.find(z => z.id === "right-pillar")!;

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-left")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-left",
      outputId: "HDMI-A-1",
      targetRect: leftPillar.targetRect,
      snapRegion: "left-pillar",
      desktopId: "1"
    });

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-center")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-center",
      outputId: "HDMI-A-1",
      targetRect: centerPillar.targetRect,
      snapRegion: "center-pillar",
      desktopId: "1"
    });

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-right")
    });
    coordinator.ingestEvent({
      type: "WindowSnapCommitted",
      windowId: "win-right",
      outputId: "HDMI-A-1",
      targetRect: rightPillar.targetRect,
      snapRegion: "right-pillar",
      desktopId: "1"
    });

    const tx = coordinator.reconcile();
    applyCompositorLoop(coordinator, tx);

    const leftState = coordinator.getRetainedWindow("win-left")!;
    const centerState = coordinator.getRetainedWindow("win-center")!;
    const rightState = coordinator.getRetainedWindow("win-right")!;

    expect(leftState.frameGeometry).toEqual(leftPillar.targetRect);
    expect(centerState.frameGeometry).toEqual(centerPillar.targetRect);
    expect(rightState.frameGeometry).toEqual(rightPillar.targetRect);

    // Verify all 3 pillars are completely disjoint
    const leftRightOverlap = Math.max(0, Math.min(leftState.frameGeometry.x + leftState.frameGeometry.width, centerState.frameGeometry.x + centerState.frameGeometry.width) - Math.max(leftState.frameGeometry.x, centerState.frameGeometry.x));
    const centerRightOverlap = Math.max(0, Math.min(centerState.frameGeometry.x + centerState.frameGeometry.width, rightState.frameGeometry.x + rightState.frameGeometry.width) - Math.max(centerState.frameGeometry.x, rightState.frameGeometry.x));
    expect(leftRightOverlap).toBe(0);
    expect(centerRightOverlap).toBe(0);
  });

  it("REG-12: exhaustive 121 ordered pairs of snap zone drops resolve with zero geometric overlap", () => {
    const zones = [
      "left-half", "right-half", "top-left", "bottom-left", "top-right", "bottom-right",
      "left-pillar", "center-pillar", "center-top", "center-bottom", "right-pillar"
    ];
    const screenRect: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const snapZones = computeSnapZones(screenRect, 10, 8);
    const snapZoneMap = new Map(snapZones.map(z => [z.id, z.targetRect]));

    const checkOverlap = (r1: Rect, r2: Rect): boolean => {
      const xOverlap = Math.max(0, Math.min(r1.x + r1.width, r2.x + r2.width) - Math.max(r1.x, r2.x));
      const yOverlap = Math.max(0, Math.min(r1.y + r1.height, r2.y + r2.height) - Math.max(r1.y, r2.y));
      return (xOverlap * yOverlap) > 0;
    };

    let totalPairsTested = 0;
    const failedPairs: string[] = [];
    for (const z1 of zones) {
      for (const z2 of zones) {
        const testCoord = new RuntimeCoordinator({ defaultLayout: "primary-stack", gapInner: 8, gapOuter: 10 });
        const screen: OutputScope = {
          outputId: "HDMI-A-1",
          geometry: screenRect,
          usableArea: screenRect,
          activeDesktopId: "1"
        };
        testCoord.handleTopologyChange([screen]);

        testCoord.ingestEvent({
          type: "WindowDiscovered",
          window: makeWin("win-1")
        });
        testCoord.ingestEvent({
          type: "WindowSnapCommitted",
          windowId: "win-1",
          outputId: "HDMI-A-1",
          targetRect: snapZoneMap.get(z1) || screenRect,
          snapRegion: z1,
          desktopId: "1"
        });

        testCoord.ingestEvent({
          type: "WindowDiscovered",
          window: makeWin("win-2")
        });
        testCoord.ingestEvent({
          type: "WindowSnapCommitted",
          windowId: "win-2",
          outputId: "HDMI-A-1",
          targetRect: snapZoneMap.get(z2) || screenRect,
          snapRegion: z2,
          desktopId: "1"
        });

        const tx = testCoord.reconcile();
        applyCompositorLoop(testCoord, tx);

        const w1State = testCoord.getRetainedWindow("win-1")!;
        const w2State = testCoord.getRetainedWindow("win-2")!;

        const isOverlapping = checkOverlap(w1State.frameGeometry, w2State.frameGeometry);
        if (isOverlapping) {
          failedPairs.push(`${z1} -> ${z2}`);
        }
        totalPairsTested++;
      }
    }
    expect(failedPairs).toEqual([]);
    expect(totalPairsTested).toBe(121);
  });

  it("REG-13: exhaustive 1331 ordered triples of snap zone drops resolve with zero geometric overlap", () => {
    const zones = [
      "left-half", "right-half", "top-left", "bottom-left", "top-right", "bottom-right",
      "left-pillar", "center-pillar", "center-top", "center-bottom", "right-pillar"
    ];
    const screenRect: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const snapZones = computeSnapZones(screenRect, 10, 8);
    const snapZoneMap = new Map(snapZones.map(z => [z.id, z.targetRect]));

    const checkOverlap = (r1: Rect, r2: Rect): boolean => {
      const xOverlap = Math.max(0, Math.min(r1.x + r1.width, r2.x + r2.width) - Math.max(r1.x, r2.x));
      const yOverlap = Math.max(0, Math.min(r1.y + r1.height, r2.y + r2.height) - Math.max(r1.y, r2.y));
      return (xOverlap * yOverlap) > 0;
    };

    let totalTriplesTested = 0;
    const failedTriples: string[] = [];

    for (const z1 of zones) {
      for (const z2 of zones) {
        for (const z3 of zones) {
          const testCoord = new RuntimeCoordinator({ defaultLayout: "primary-stack", gapInner: 8, gapOuter: 10 });
          const screen: OutputScope = {
            outputId: "HDMI-A-1",
            geometry: screenRect,
            usableArea: screenRect,
            activeDesktopId: "1"
          };
          testCoord.handleTopologyChange([screen]);

          const dropSequence = [
            { id: "win-1", zone: z1 },
            { id: "win-2", zone: z2 },
            { id: "win-3", zone: z3 }
          ];

          for (const item of dropSequence) {
            testCoord.ingestEvent({
              type: "WindowDiscovered",
              window: makeWin(item.id)
            });
            testCoord.ingestEvent({
              type: "WindowSnapCommitted",
              windowId: item.id,
              outputId: "HDMI-A-1",
              targetRect: snapZoneMap.get(item.zone) || screenRect,
              snapRegion: item.zone,
              desktopId: "1"
            });
            const tx = testCoord.reconcile();
            applyCompositorLoop(testCoord, tx);
          }

          const w1 = testCoord.getRetainedWindow("win-1")!.frameGeometry;
          const w2 = testCoord.getRetainedWindow("win-2")!.frameGeometry;
          const w3 = testCoord.getRetainedWindow("win-3")!.frameGeometry;

          if (checkOverlap(w1, w2) || checkOverlap(w1, w3) || checkOverlap(w2, w3)) {
            failedTriples.push(`${z1} -> ${z2} -> ${z3}`);
          }
          totalTriplesTested++;
        }
      }
    }

    expect(failedTriples).toEqual([]);
    expect(totalTriplesTested).toBe(1331);
  });

  it("REG-14: newest-target preservation: left-half, left-half, right-half preserves newest right-half intact at full height and fits older peers in remaining left space with zero repeat drift", () => {
    const screenRect: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const snapZones = computeSnapZones(screenRect, 10, 8);
    const snapZoneMap = new Map(snapZones.map(z => [z.id, z.targetRect]));
    const rightHalf = snapZoneMap.get("right-half")!;
    const leftHalf = snapZoneMap.get("left-half")!;

    const testCoord = new RuntimeCoordinator({ defaultLayout: "primary-stack", gapInner: 8, gapOuter: 10 });
    const screen: OutputScope = {
      outputId: "HDMI-A-1",
      geometry: screenRect,
      usableArea: screenRect,
      activeDesktopId: "1"
    };
    testCoord.handleTopologyChange([screen]);

    const seq = [
      { id: "win-1", zone: "left-half" },
      { id: "win-2", zone: "left-half" },
      { id: "win-3", zone: "right-half" }
    ];

    for (const item of seq) {
      testCoord.ingestEvent({
        type: "WindowDiscovered",
        window: makeWin(item.id)
      });
      testCoord.ingestEvent({
        type: "WindowSnapCommitted",
        windowId: item.id,
        outputId: "HDMI-A-1",
        targetRect: snapZoneMap.get(item.zone)!,
        snapRegion: item.zone,
        desktopId: "1"
      });
      const tx = testCoord.reconcile();
      applyCompositorLoop(testCoord, tx);
    }

    const w1 = testCoord.getRetainedWindow("win-1")!.frameGeometry;
    const w2 = testCoord.getRetainedWindow("win-2")!.frameGeometry;
    const w3 = testCoord.getRetainedWindow("win-3")!.frameGeometry;

    // Newest right-half must remain completely intact at full height
    expect(w3).toEqual(rightHalf);

    // Older peers win-1 and win-2 fit in remaining left space
    expect(w1.x).toBe(leftHalf.x);
    expect(w1.width).toBe(leftHalf.width);
    expect(w2.x).toBe(leftHalf.x);
    expect(w2.width).toBe(leftHalf.width);
    expect(w1.height + w2.height + 8).toBe(leftHalf.height);

    // Assert zero overlap
    const checkOverlap = (r1: Rect, r2: Rect): boolean => {
      const xOverlap = Math.max(0, Math.min(r1.x + r1.width, r2.x + r2.width) - Math.max(r1.x, r2.x));
      const yOverlap = Math.max(0, Math.min(r1.y + r1.height, r2.y + r2.height) - Math.max(r1.y, r2.y));
      return (xOverlap * yOverlap) > 0;
    };
    expect(checkOverlap(w1, w2)).toBe(false);
    expect(checkOverlap(w1, w3)).toBe(false);
    expect(checkOverlap(w2, w3)).toBe(false);

    // Repeated reconciliation must stabilize with zero drift
    const repeatTx = testCoord.reconcile();
    expect(repeatTx).toBeNull();
  });

  it("REG-15: 4-window pillar layout: left-pillar, center-pillar, right-pillar, center-pillar preserves full-height outer pillars and stacks center windows across all insertion orders", () => {
    const screenRect: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const snapZones = computeSnapZones(screenRect, 10, 8);
    const snapZoneMap = new Map(snapZones.map(z => [z.id, z.targetRect]));
    const leftPillar = snapZoneMap.get("left-pillar")!;
    const rightPillar = snapZoneMap.get("right-pillar")!;
    const centerTop = snapZoneMap.get("center-top")!;
    const centerBottom = snapZoneMap.get("center-bottom")!;

    const baseSeq = ["left-pillar", "center-pillar", "right-pillar", "center-pillar"];
    const permute = (arr: string[]): string[][] => {
      if (arr.length <= 1) return [arr];
      const res: string[][] = [];
      for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        for (const p of permute(rest)) {
          res.push([arr[i], ...p]);
        }
      }
      return res;
    };

    const allPermutations = permute(baseSeq);
    expect(allPermutations.length).toBe(24);

    for (const p of allPermutations) {
      const testCoord = new RuntimeCoordinator({ defaultLayout: "primary-stack", gapInner: 8, gapOuter: 10 });
      const screen: OutputScope = {
        outputId: "HDMI-A-1",
        geometry: screenRect,
        usableArea: screenRect,
        activeDesktopId: "1"
      };
      testCoord.handleTopologyChange([screen]);

      for (let i = 0; i < p.length; i++) {
        const wid = `win-${i}`;
        const zId = p[i];
        testCoord.ingestEvent({
          type: "WindowDiscovered",
          window: makeWin(wid)
        });
        testCoord.ingestEvent({
          type: "WindowSnapCommitted",
          windowId: wid,
          outputId: "HDMI-A-1",
          targetRect: snapZoneMap.get(zId)!,
          snapRegion: zId,
          desktopId: "1"
        });
        const tx = testCoord.reconcile();
        applyCompositorLoop(testCoord, tx);
      }

      const wins = [0, 1, 2, 3].map(i => testCoord.getRetainedWindow(`win-${i}`)!.frameGeometry);
      const leftWin = wins.find(w => w.x === leftPillar.x);
      const rightWin = wins.find(w => w.x === rightPillar.x);
      const centerWins = wins.filter(w => w.x === centerTop.x);

      expect(leftWin).toBeDefined();
      expect(leftWin!.height).toBe(leftPillar.height); // Full height 1060
      expect(rightWin).toBeDefined();
      expect(rightWin!.height).toBe(rightPillar.height); // Full height 1060
      expect(centerWins.length).toBe(2);
      expect(centerWins.some(w => w.y === centerTop.y && w.height === centerTop.height)).toBe(true);
      expect(centerWins.some(w => w.y === centerBottom.y && w.height === centerBottom.height)).toBe(true);

      // Repeat reconcile stabilizes with zero drift
      const repeatTx = testCoord.reconcile();
      expect(repeatTx).toBeNull();
    }
  });

  it("REG-16: outer-pillar duplicate policy: duplicate outer pillars retain full-height without vertical splitting", () => {
    const screenRect: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const snapZones = computeSnapZones(screenRect, 10, 8);
    const snapZoneMap = new Map(snapZones.map(z => [z.id, z.targetRect]));
    const leftPillar = snapZoneMap.get("left-pillar")!;
    const rightPillar = snapZoneMap.get("right-pillar")!;

    // Case 1: duplicate left-pillar
    const coordLeft = new RuntimeCoordinator({ defaultLayout: "primary-stack", gapInner: 8, gapOuter: 10 });
    coordLeft.handleTopologyChange([{ outputId: "HDMI-A-1", geometry: screenRect, usableArea: screenRect, activeDesktopId: "1" }]);
    for (const wid of ["win-1", "win-2"]) {
      coordLeft.ingestEvent({ type: "WindowDiscovered", window: makeWin(wid) });
      coordLeft.ingestEvent({
        type: "WindowSnapCommitted",
        windowId: wid,
        outputId: "HDMI-A-1",
        targetRect: leftPillar,
        snapRegion: "left-pillar",
        desktopId: "1"
      });
      const tx = coordLeft.reconcile();
      applyCompositorLoop(coordLeft, tx);
    }
    const l1 = coordLeft.getRetainedWindow("win-1")!.frameGeometry;
    const l2 = coordLeft.getRetainedWindow("win-2")!.frameGeometry;
    // Newest win-2 gets left-pillar full height; older win-1 adapts to center-pillar full height
    expect(l2).toEqual(leftPillar);
    expect(l1.height).toBe(1060);
    expect(l1.width).toBe(leftPillar.width);
    expect(coordLeft.reconcile()).toBeNull();

    // Case 2: duplicate right-pillar
    const coordRight = new RuntimeCoordinator({ defaultLayout: "primary-stack", gapInner: 8, gapOuter: 10 });
    coordRight.handleTopologyChange([{ outputId: "HDMI-A-1", geometry: screenRect, usableArea: screenRect, activeDesktopId: "1" }]);
    for (const wid of ["win-1", "win-2"]) {
      coordRight.ingestEvent({ type: "WindowDiscovered", window: makeWin(wid) });
      coordRight.ingestEvent({
        type: "WindowSnapCommitted",
        windowId: wid,
        outputId: "HDMI-A-1",
        targetRect: rightPillar,
        snapRegion: "right-pillar",
        desktopId: "1"
      });
      const tx = coordRight.reconcile();
      applyCompositorLoop(coordRight, tx);
    }
    const r1 = coordRight.getRetainedWindow("win-1")!.frameGeometry;
    const r2 = coordRight.getRetainedWindow("win-2")!.frameGeometry;
    expect(r2).toEqual(rightPillar);
    expect(r1.height).toBe(1060);
    expect(r1.width).toBe(rightPillar.width);
    expect(coordRight.reconcile()).toBeNull();
  });

  it("REG-17: mixed-family newest-target preservation across center-pillar and quadrant/half drops with repeated reconciliation stabilization", () => {
    const screenRect: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const snapZones = computeSnapZones(screenRect, 10, 8);
    const snapZoneMap = new Map(snapZones.map(z => [z.id, z.targetRect]));

    // Sequence A: ["left-half", "left-half", "center-top", "top-left"]
    const coordA = new RuntimeCoordinator({ defaultLayout: "primary-stack", gapInner: 8, gapOuter: 10 });
    coordA.handleTopologyChange([{ outputId: "HDMI-A-1", geometry: screenRect, usableArea: screenRect, activeDesktopId: "1" }]);
    const seqA = ["left-half", "left-half", "center-top", "top-left"];
    for (let i = 0; i < seqA.length; i++) {
      const wid = `win-${i}`;
      const zId = seqA[i];
      coordA.ingestEvent({ type: "WindowDiscovered", window: makeWin(wid) });
      coordA.ingestEvent({
        type: "WindowSnapCommitted",
        windowId: wid,
        outputId: "HDMI-A-1",
        targetRect: snapZoneMap.get(zId)!,
        snapRegion: zId,
        desktopId: "1"
      });
      const tx = coordA.reconcile();
      applyCompositorLoop(coordA, tx);
    }
    const win3GeomA = coordA.getRetainedWindow("win-3")!.frameGeometry;
    const expectedTopLeft = snapZoneMap.get("top-left")!;
    // Newest top-left must retain exact full quadrant dimensions: 946x526, not shrunk to pillar width 628
    expect(win3GeomA).toEqual(expectedTopLeft);
    expect(win3GeomA.width).toBe(946);
    expect(win3GeomA.height).toBe(526);

    // Assert zero overlaps across all 4 windows
    const geomsA = [0, 1, 2, 3].map(i => coordA.getRetainedWindow(`win-${i}`)!.frameGeometry);
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const r1 = geomsA[i];
        const r2 = geomsA[j];
        const xOv = Math.max(0, Math.min(r1.x + r1.width, r2.x + r2.width) - Math.max(r1.x, r2.x));
        const yOv = Math.max(0, Math.min(r1.y + r1.height, r2.y + r2.height) - Math.max(r1.y, r2.y));
        expect(xOv * yOv).toBe(0);
      }
    }
    // Repeat reconciliation must produce zero operations / zero drift
    const repeatA = coordA.reconcile();
    expect(repeatA).toBeNull();

    // Sequence B: ["left-half", "left-half", "center-top", "right-half"]
    const coordB = new RuntimeCoordinator({ defaultLayout: "primary-stack", gapInner: 8, gapOuter: 10 });
    coordB.handleTopologyChange([{ outputId: "HDMI-A-1", geometry: screenRect, usableArea: screenRect, activeDesktopId: "1" }]);
    const seqB = ["left-half", "left-half", "center-top", "right-half"];
    for (let i = 0; i < seqB.length; i++) {
      const wid = `win-${i}`;
      const zId = seqB[i];
      coordB.ingestEvent({ type: "WindowDiscovered", window: makeWin(wid) });
      coordB.ingestEvent({
        type: "WindowSnapCommitted",
        windowId: wid,
        outputId: "HDMI-A-1",
        targetRect: snapZoneMap.get(zId)!,
        snapRegion: zId,
        desktopId: "1"
      });
      const tx = coordB.reconcile();
      applyCompositorLoop(coordB, tx);
    }
    const win3GeomB = coordB.getRetainedWindow("win-3")!.frameGeometry;
    const expectedRightHalf = snapZoneMap.get("right-half")!;
    // Newest right-half must retain exact full half dimensions: {x: 964, y: 10, width: 946, height: 1060}
    expect(win3GeomB).toEqual(expectedRightHalf);
    expect(win3GeomB.x).toBe(964);
    expect(win3GeomB.width).toBe(946);

    // Assert zero overlaps across all 4 windows
    const geomsB = [0, 1, 2, 3].map(i => coordB.getRetainedWindow(`win-${i}`)!.frameGeometry);
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const r1 = geomsB[i];
        const r2 = geomsB[j];
        const xOv = Math.max(0, Math.min(r1.x + r1.width, r2.x + r2.width) - Math.max(r1.x, r2.x));
        const yOv = Math.max(0, Math.min(r1.y + r1.height, r2.y + r2.height) - Math.max(r1.y, r2.y));
        expect(xOv * yOv).toBe(0);
      }
    }
    // Repeat reconciliation must produce zero operations / zero drift
    const repeatB = coordB.reconcile();
    expect(repeatB).toBeNull();
  });
});
