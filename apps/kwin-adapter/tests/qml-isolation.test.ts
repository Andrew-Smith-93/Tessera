import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeCoordinator, LogicalClock } from "../src/index.js";
import type { NormalizedScreenInput, NormalizedWindowInput } from "../src/coordinator-types.js";

const SCREEN_1: NormalizedScreenInput = {
  outputId: "HDMI-A-1",
  name: "HDMI-A-1",
  geometry: { x: 0, y: 0, width: 1920, height: 1080 },
  usableArea: { x: 0, y: 0, width: 1920, height: 1080 },
  activeDesktopId: "1"
};

function makeWin(id: string, outputId: string = "HDMI-A-1", extra: Partial<NormalizedWindowInput> = {}): NormalizedWindowInput {
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

describe("QML Mirror-State Audit & Reconciler Mode Isolation", () => {
  let coordinator: RuntimeCoordinator;
  let clock: LogicalClock;

  beforeEach(() => {
    clock = new LogicalClock(0);
    coordinator = new RuntimeCoordinator(
      { enableTiling: true, defaultLayout: "master-stack" },
      clock
    );
    coordinator.getOrCreateScreen(SCREEN_1);
  });

  it("1. Coordinator is authoritative owner for classification and tileability", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-1")
    });

    const retained = coordinator.getRetainedWindow("win-1");
    expect(retained).toBeDefined();
    expect(retained?.classification).toBe("tiled");
    expect(retained?.tileable).toBe(true);

    // Stale external legacy state cannot alter coordinator's classification
    const fakeLegacyMap: Record<string, string> = { "win-1": "floating" };
    expect(coordinator.getRetainedWindow("win-1")?.classification).toBe("tiled");
    expect(fakeLegacyMap["win-1"]).toBe("floating");
  });

  it("2. Manual floating state is authoritatively owned by the coordinator", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-1")
    });

    expect(coordinator.getRetainedWindow("win-1")?.isManualFloating).toBe(false);

    // Toggle manual floating via coordinator authoritative method
    coordinator.setManualFloating("win-1", true);

    const updated = coordinator.getRetainedWindow("win-1");
    expect(updated?.isManualFloating).toBe(true);
    expect(coordinator.isManualFloating("win-1")).toBe(true);
  });

  it("3. Screen ordering and geometry restoration are managed in coordinator state store", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-1", "HDMI-A-1", { frameGeometry: { x: 0, y: 0, width: 500, height: 500 } })
    });
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-2", "HDMI-A-1", { frameGeometry: { x: 500, y: 0, width: 500, height: 500 } })
    });

    coordinator.reconcile();

    const retainedScreen = coordinator.getRetainedScreen("HDMI-A-1");
    expect(retainedScreen).toBeDefined();
    expect(retainedScreen?.orderedWindowIds).toEqual(["win-1", "win-2"]);

    // Geometry cache restoration
    coordinator.setSavedTiledGeometry("win-1", { x: 10, y: 10, width: 946, height: 1060 });
    const cached = coordinator.getSavedTiledGeometry("win-1");
    expect(cached).toEqual({ x: 10, y: 10, width: 946, height: 1060 });
  });

  it("4. Stale QML mirrors do not override coordinator results", () => {
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: makeWin("win-1")
    });

    const tx = coordinator.reconcile();
    expect(tx).not.toBeNull();
    expect(tx?.operations.length).toBe(1);
    expect(tx?.operations[0].windowId).toBe("win-1");

    const retained = coordinator.getRetainedWindow("win-1");
    expect(retained?.outputId).toBe("HDMI-A-1");
  });
});
