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
});
