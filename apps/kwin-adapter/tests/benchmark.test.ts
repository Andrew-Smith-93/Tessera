import { describe, it, expect } from "vitest";
import { RuntimeCoordinator } from "../src/runtime-coordinator.js";
import type { NormalizedScreenInput, NormalizedWindowInput } from "../src/coordinator-types.js";

const SCREEN_1: NormalizedScreenInput = {
  outputId: "Screen-1",
  name: "Screen-1",
  geometry: { x: 0, y: 0, width: 2560, height: 1440 },
  usableArea: { x: 0, y: 0, width: 2560, height: 1440 },
  activeDesktopId: "1"
};

const SCREEN_2: NormalizedScreenInput = {
  outputId: "Screen-2",
  name: "Screen-2",
  geometry: { x: 2560, y: 0, width: 1920, height: 1080 },
  usableArea: { x: 2560, y: 0, width: 1920, height: 1080 },
  activeDesktopId: "1"
};

describe("Phase 2A Synthetic Performance & Structural Work Benchmarks", () => {
  it("Benchmark 1: 1 Screen and 10 Windows Burst", () => {
    const coordinator = new RuntimeCoordinator();
    coordinator.getOrCreateScreen(SCREEN_1);

    // Ingest 10 windows in one rapid burst
    for (let i = 0; i < 10; i++) {
      coordinator.ingestEvent({
        type: "WindowDiscovered",
        window: {
          id: `bench1-win-${i}`,
          resourceClass: "terminal",
          title: `Terminal ${i}`,
          outputId: "Screen-1",
          frameGeometry: { x: 100, y: 100, width: 400, height: 300 },
          managed: true,
          normalWindow: true
        }
      });
    }

    // Coalesce into exactly 1 transaction
    const tx = coordinator.reconcile();
    expect(tx).not.toBeNull();
    expect(tx!.epoch).toBe(1);
    expect(tx!.operations.length).toBe(10); // initial positioning for all 10 windows
    expect(tx!.skippedWrites).toBe(0);

    const diag = coordinator.getDiagnostics();
    expect(diag.totalNormalizedEvents).toBe(10);
    expect(diag.totalReconciliationTransactions).toBe(1);
    expect(diag.totalLayoutComputations).toBe(1);
    expect(diag.totalGeometryWrites).toBe(10);
    expect(diag.retainedWindowCount).toBe(10);
    expect(diag.retainedScreenCount).toBe(1);

    console.log("\n--- Benchmark 1 Result (1 Screen, 10 Windows) ---");
    console.log(`Events: ${diag.totalNormalizedEvents}, Transactions: ${diag.totalReconciliationTransactions}, Layout Computations: ${diag.totalLayoutComputations}, Geometry Operations: ${diag.totalGeometryWrites}`);
  });

  it("Benchmark 2: 2 Screens and 30 Windows Burst", () => {
    const coordinator = new RuntimeCoordinator();
    coordinator.getOrCreateScreen(SCREEN_1);
    coordinator.getOrCreateScreen(SCREEN_2);

    // Ingest 15 windows on Screen-1 and 15 windows on Screen-2
    for (let i = 0; i < 30; i++) {
      const outputId = i < 15 ? "Screen-1" : "Screen-2";
      coordinator.ingestEvent({
        type: "WindowDiscovered",
        window: {
          id: `bench2-win-${i}`,
          resourceClass: "editor",
          title: `Editor ${i}`,
          outputId,
          frameGeometry: { x: 0, y: 0, width: 800, height: 600 },
          managed: true,
          normalWindow: true
        }
      });
    }

    const tx = coordinator.reconcile();
    expect(tx).not.toBeNull();
    expect(tx!.affectedScreens.length).toBe(2);
    expect(tx!.operations.length).toBe(30);

    const diag = coordinator.getDiagnostics();
    expect(diag.totalNormalizedEvents).toBe(30);
    expect(diag.totalReconciliationTransactions).toBe(1);
    expect(diag.totalLayoutComputations).toBe(2); // 1 per screen
    expect(diag.totalGeometryWrites).toBe(30);
    expect(diag.retainedWindowCount).toBe(30);
    expect(diag.retainedScreenCount).toBe(2);

    console.log("\n--- Benchmark 2 Result (2 Screens, 30 Windows) ---");
    console.log(`Events: ${diag.totalNormalizedEvents}, Transactions: ${diag.totalReconciliationTransactions}, Layout Computations: ${diag.totalLayoutComputations}, Geometry Operations: ${diag.totalGeometryWrites}`);
  });

  it("Benchmark 3: 100-Event Geometry Burst", () => {
    const coordinator = new RuntimeCoordinator();
    coordinator.getOrCreateScreen(SCREEN_1);

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: {
        id: "target-win",
        resourceClass: "browser",
        outputId: "Screen-1",
        frameGeometry: { x: 0, y: 0, width: 1000, height: 800 },
        managed: true,
        normalWindow: true
      }
    });
    const initTx = coordinator.reconcile();
    const applied = initTx!.operations[0].targetRect;

    // Simulate window manager echo stream (100 rapid frame geometry updates matching target)
    for (let i = 0; i < 100; i++) {
      coordinator.checkAndHandleEcho("target-win", applied);
    }

    const diag = coordinator.getDiagnostics();
    expect(diag.suppressedGeometryEchoes).toBe(1); // 1 echo fulfilled, subsequent are clean
    expect(diag.totalReconciliationTransactions).toBe(1); // No new transactions triggered by echoes
    expect(diag.totalGeometryWrites).toBe(1);

    console.log("\n--- Benchmark 3 Result (100-Event Geometry Burst) ---");
    console.log(`Transactions: ${diag.totalReconciliationTransactions}, Suppressed Echoes: ${diag.suppressedGeometryEchoes}, Geometry Writes: ${diag.totalGeometryWrites}`);
  });

  it("Benchmark 4: Fullscreen Transition Burst", () => {
    const coordinator = new RuntimeCoordinator();
    coordinator.getOrCreateScreen(SCREEN_1);

    // Setup 4 windows
    for (let i = 0; i < 4; i++) {
      coordinator.ingestEvent({
        type: "WindowDiscovered",
        window: {
          id: `fs-win-${i}`,
          resourceClass: "player",
          outputId: "Screen-1",
          managed: true,
          normalWindow: true
        }
      });
    }
    coordinator.reconcile();

    // Burst: win-0 toggles fullscreen 10 times rapidly
    for (let i = 0; i < 10; i++) {
      const isFs = i % 2 === 0;
      coordinator.ingestEvent({
        type: "WindowStateChanged",
        windowId: "fs-win-0",
        updates: { fullScreen: isFs }
      });
    }

    // Coalesce final state
    const tx = coordinator.reconcile();
    expect(tx).not.toBeNull();

    const screen = coordinator.getRetainedScreen("Screen-1")!;
    // Persistent order remains strictly preserved
    expect(screen.persistentOrder).toEqual(["fs-win-0", "fs-win-1", "fs-win-2", "fs-win-3"]);

    const diag = coordinator.getDiagnostics();
    console.log("\n--- Benchmark 4 Result (Fullscreen Transition Burst) ---");
    console.log(`Total Events: ${diag.totalNormalizedEvents}, Total Transactions: ${diag.totalReconciliationTransactions}, Layout Computations: ${diag.totalLayoutComputations}`);
  });

  it("Benchmark 5: Minimize/Restore 1 window among 10", () => {
    const coordinator = new RuntimeCoordinator();
    coordinator.getOrCreateScreen(SCREEN_1);

    for (let i = 0; i < 10; i++) {
      coordinator.ingestEvent({
        type: "WindowDiscovered",
        window: {
          id: `min-win-${i}`,
          outputId: "Screen-1",
          frameGeometry: { x: 100, y: 100, width: 400, height: 300 }
        }
      });
    }
    const initTx = coordinator.reconcile();
    expect(initTx).not.toBeNull();

    const initialSavedGeom = coordinator.getSavedTiledGeometry("min-win-0");
    expect(initialSavedGeom).not.toBeNull();

    // Minimize window 0
    coordinator.handleMinimize("min-win-0", true, { x: 50, y: 50, width: 400, height: 300 });
    const minTx = coordinator.reconcile();
    expect(minTx).not.toBeNull();

    // Verify preMinimizeGeometry is recorded
    const preMinGeom = coordinator.getPreMinimizeGeometry("min-win-0");
    expect(preMinGeom).toEqual({ x: 50, y: 50, width: 400, height: 300 });

    // Restore window 0
    coordinator.handleMinimize("min-win-0", false);
    const restoreTx = coordinator.reconcile();
    expect(restoreTx).not.toBeNull();

    // Verify window 0 retained its persistent slot in screen
    const screen = coordinator.getRetainedScreen("Screen-1")!;
    expect(screen.persistentOrder[0]).toBe("min-win-0");

    console.log("\n--- Benchmark 5 Result (Minimize/Restore 1 of 10) ---");
    console.log(`Initial Tiled: ${JSON.stringify(initialSavedGeom)}, Restored Slot preserved.`);
  });

  it("Benchmark 6: Move 1 window between 2 outputs with 30 windows", () => {
    const coordinator = new RuntimeCoordinator();
    coordinator.getOrCreateScreen(SCREEN_1);
    coordinator.getOrCreateScreen(SCREEN_2);

    for (let i = 0; i < 30; i++) {
      const outputId = i < 15 ? "Screen-1" : "Screen-2";
      coordinator.ingestEvent({
        type: "WindowDiscovered",
        window: {
          id: `move-win-${i}`,
          outputId,
          frameGeometry: { x: 0, y: 0, width: 600, height: 400 }
        }
      });
    }
    coordinator.reconcile();

    // Move move-win-0 from Screen-1 to Screen-2
    const moveRes = coordinator.ingestEvent({
      type: "WindowMovedOutput",
      windowId: "move-win-0",
      fromOutputId: "Screen-1",
      toOutputId: "Screen-2"
    });
    expect(moveRes.affectedScreens).toEqual(["Screen-1", "Screen-2"]);

    const moveTx = coordinator.reconcile();
    expect(moveTx).not.toBeNull();
    expect(moveTx!.affectedScreens).toContain("Screen-1");
    expect(moveTx!.affectedScreens).toContain("Screen-2");

    const s1 = coordinator.getRetainedScreen("Screen-1")!;
    const s2 = coordinator.getRetainedScreen("Screen-2")!;
    expect(s1.persistentOrder.length).toBe(14);
    expect(s2.persistentOrder.length).toBe(16);
    expect(s2.persistentOrder).toContain("move-win-0");

    console.log("\n--- Benchmark 6 Result (Move Window Across Screens) ---");
    console.log(`Screen 1 windows: ${s1.persistentOrder.length}, Screen 2 windows: ${s2.persistentOrder.length}`);
  });

  it("Benchmark 7: Remove 1 output during a 30-window topology", () => {
    const coordinator = new RuntimeCoordinator();
    coordinator.getOrCreateScreen(SCREEN_1);
    coordinator.getOrCreateScreen(SCREEN_2);

    for (let i = 0; i < 30; i++) {
      const outputId = i < 15 ? "Screen-1" : "Screen-2";
      coordinator.ingestEvent({
        type: "WindowDiscovered",
        window: {
          id: `topo-win-${i}`,
          outputId,
          frameGeometry: { x: i < 15 ? 100 : 2600, y: 100, width: 600, height: 400 }
        }
      });
    }
    coordinator.reconcile();

    // Unplug Screen-2
    const topoTx = coordinator.handleTopologyChange([SCREEN_1]);
    expect(topoTx).not.toBeNull();

    const s1 = coordinator.getRetainedScreen("Screen-1")!;
    expect(s1.persistentOrder.length).toBe(30);

    const s2 = coordinator.getRetainedScreen("Screen-2");
    expect(s2).toBeUndefined();

    console.log("\n--- Benchmark 7 Result (Topology Screen Removal) ---");
    console.log(`Relocated all 30 windows onto single remaining screen.`);
  });

  it("Benchmark 8: 100 cursor-position updates", async () => {
    const { resolveCursorTargetScreen } = await import("../src/screen-affinity.js");
    const screens = [SCREEN_1, SCREEN_2];

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const px = (i * 45) % 4000;
      const py = (i * 25) % 1200;
      const target = resolveCursorTargetScreen(screens, { x: px, y: py });
      expect(target).toBeDefined();
    }
    const elapsed = performance.now() - start;

    console.log("\n--- Benchmark 8 Result (100 Cursor Updates) ---");
    console.log(`Duration: ${elapsed.toFixed(3)}ms (average ${(elapsed / 100).toFixed(3)}ms/op)`);
    expect(elapsed).toBeLessThan(50); // fast pure function
  });

  it("Benchmark 9: 100 snap-preview updates + 1 committed snap", async () => {
    const { computeSnapZones, matchSnapZoneHover } = await import("../src/snap-zones.js");
    const area = SCREEN_1.usableArea;
    const zones = computeSnapZones(area, 10, 8);

    const start = performance.now();
    let lastMatch = -1;
    for (let i = 0; i < 100; i++) {
      const px = (i * 25) % area.width;
      const py = (i * 15) % area.height;
      lastMatch = matchSnapZoneHover(zones, { x: px, y: py });
    }
    const elapsed = performance.now() - start;

    // Committed snap
    const chosenZone = zones[1]; // Left half
    expect(chosenZone.id).toBe("left-half");

    console.log("\n--- Benchmark 9 Result (100 Snap Updates + Commit) ---");
    console.log(`Duration: ${elapsed.toFixed(3)}ms, Committed Zone: ${chosenZone.title}`);
    expect(elapsed).toBeLessThan(50);
  });
});

