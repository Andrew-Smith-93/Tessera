import {
  evaluateCommitGeometry,
  normalizeCommitGeometry,
  toNormalizedScreen,
  toNormalizedWindow,
} from "../src/qml-reconciler-compat.js";

describe("QML compatibility normalization", () => {
  it("extracts stable IDs from live KWin desktop and activity objects", () => {
    const normalized = toNormalizedWindow({
      internalId: "window-1",
      desktops: [{ id: "desk-a", name: "Desktop A" }, { id: "desk-b" }],
      activities: [{ id: "activity-a" }, { name: "activity-b" }],
      frameGeometry: { x: 1, y: 2, width: 300, height: 200 },
      managed: true,
      normalWindow: true,
    });

    expect(normalized.desktopId).toBe("desk-a");
    expect(normalized.desktopIds).toEqual(["desk-a", "desk-b"]);
    expect(normalized.activityId).toBe("activity-a");
    expect(normalized.activities).toEqual(["activity-a", "activity-b"]);

    const unknownObjects = toNormalizedWindow({
      internalId: "window-2",
      desktops: [{}],
      activities: [{}],
    });
    expect(unknownObjects.desktopId).toBe("1");
    expect(unknownObjects.desktopIds).toEqual([]);
    expect(unknownObjects.activities).toEqual([]);
  });

  it("carries active desktop and activity IDs into normalized screens", () => {
    const normalized = toNormalizedScreen(
      { name: "DP-1", geometry: { x: 0, y: 0, width: 1920, height: 1080 } },
      { x: 0, y: 24, width: 1920, height: 1056 },
      { id: "desk-2" },
      { id: "activity-work" },
    );

    expect(normalized.activeDesktopId).toBe("desk-2");
    expect(normalized.activeActivityId).toBe("activity-work");
  });

  it("rejects non-finite or non-positive geometry and clamps valid rectangles", () => {
    const bounds = { x: 100, y: 50, width: 800, height: 600 };

    expect(normalizeCommitGeometry({ x: NaN, y: 0, width: 10, height: 10 }, bounds)).toBeNull();
    expect(normalizeCommitGeometry({ x: "1", y: 0, width: 10, height: 10 }, bounds)).toBeNull();
    expect(normalizeCommitGeometry({ x: 0, y: 0, width: 0, height: 10 }, bounds)).toBeNull();
    expect(normalizeCommitGeometry({ x: 0, y: 0, width: 10, height: 10 }, { ...bounds, width: Infinity })).toBeNull();
    expect(normalizeCommitGeometry(
      { x: -500.2, y: 999.7, width: 1200.1, height: 700.9 },
      bounds,
    )).toEqual({ x: 100, y: 50, width: 800, height: 600 });
    expect(normalizeCommitGeometry(
      { x: 120.4, y: 80.6, width: 300.2, height: 200.8 },
      bounds,
    )).toEqual({ x: 120, y: 81, width: 300, height: 201 });
  });

  it("enforces explicit outcome contract across window lifecycle states", () => {
    const validBounds = { x: 0, y: 0, width: 1920, height: 1080 };
    const validTarget = { x: 100, y: 100, width: 800, height: 600 };

    // 1. Rejects null / undefined window
    expect(evaluateCommitGeometry(null, validTarget, validBounds).outcome).toBe("rejected");
    expect(evaluateCommitGeometry(undefined, validTarget, validBounds).outcome).toBe("rejected");

    // 2. Rejects destroyed window
    expect(evaluateCommitGeometry({ deleted: true, managed: true, frameGeometry: { x: 0, y: 0, width: 500, height: 500 } }, validTarget, validBounds).outcome).toBe("rejected");

    // 3. Rejects unmanaged window (explicit false or undefined) and non-normal window
    expect(evaluateCommitGeometry({ managed: false, frameGeometry: { x: 0, y: 0, width: 500, height: 500 } }, validTarget, validBounds).outcome).toBe("rejected");
    expect(evaluateCommitGeometry({ frameGeometry: { x: 0, y: 0, width: 500, height: 500 } } as any, validTarget, validBounds).outcome).toBe("rejected");
    expect(evaluateCommitGeometry({ managed: true, normalWindow: false, frameGeometry: { x: 0, y: 0, width: 500, height: 500 } }, validTarget, validBounds).outcome).toBe("rejected");

    // 4. Rejects window without frameGeometry
    expect(evaluateCommitGeometry({ managed: true }, validTarget, validBounds).outcome).toBe("rejected");

    // 5. Rejects non-finite or non-positive targetRect
    const liveWin = { managed: true, frameGeometry: { x: 100, y: 100, width: 800, height: 600 } };
    expect(evaluateCommitGeometry(liveWin, null, validBounds).outcome).toBe("rejected");
    expect(evaluateCommitGeometry(liveWin, { x: 0, y: 0, width: -10, height: 100 }, validBounds).outcome).toBe("rejected");
    expect(evaluateCommitGeometry(liveWin, { x: 0, y: 0, width: 100, height: 0 }, validBounds).outcome).toBe("rejected");
    expect(evaluateCommitGeometry(liveWin, { x: NaN, y: 0, width: 100, height: 100 }, validBounds).outcome).toBe("rejected");

    // 6. Returns unchanged-valid when geometry matches exactly
    const identicalRes = evaluateCommitGeometry(liveWin, { x: 100, y: 100, width: 800, height: 600 }, validBounds);
    expect(identicalRes.outcome).toBe("unchanged-valid");
    expect(identicalRes.normalized).toEqual({ x: 100, y: 100, width: 800, height: 600 });

    // 7. Returns applied when geometry differs and is valid
    const appliedRes = evaluateCommitGeometry(liveWin, { x: 200, y: 200, width: 600, height: 400 }, validBounds);
    expect(appliedRes.outcome).toBe("applied");
    expect(appliedRes.normalized).toEqual({ x: 200, y: 200, width: 600, height: 400 });
  });
});
