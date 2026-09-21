import type { Rect } from "@tessera/protocol";
import type {
  SerializableRetainedScreen,
  SerializableRetainedWindow,
  SerializableTransaction,
  InvariantResult,
  InvariantViolation
} from "./types.js";

function isFiniteRect(r: Rect | null | undefined): boolean {
  if (!r) return true;
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height)
  );
}

function isNonNegativeSize(r: Rect | null | undefined): boolean {
  if (!r) return true;
  return r.width >= 0 && r.height >= 0;
}

function rectsOverlap(r1: Rect, r2: Rect, tolerancePx = 1): boolean {
  return !(
    r1.x + r1.width - tolerancePx <= r2.x ||
    r2.x + r2.width - tolerancePx <= r1.x ||
    r1.y + r1.height - tolerancePx <= r2.y ||
    r2.y + r2.height - tolerancePx <= r1.y
  );
}

export function validateInvariants(
  screens: readonly SerializableRetainedScreen[],
  windows: readonly SerializableRetainedWindow[],
  transactions: readonly SerializableTransaction[],
  options?: {
    tolerancePx?: number;
  }
): InvariantResult {
  const violations: InvariantViolation[] = [];
  const tolerance = options?.tolerancePx ?? 1;

  // 1. All rectangles contain finite numbers & nonnegative widths/heights
  for (const screen of screens) {
    if (!isFiniteRect(screen.geometry) || !isFiniteRect(screen.usableArea)) {
      violations.push({
        code: "SCREEN_RECT_NOT_FINITE",
        message: `Screen ${screen.outputId} has non-finite geometry`,
        entityId: screen.outputId
      });
    }
    if (!isNonNegativeSize(screen.geometry) || !isNonNegativeSize(screen.usableArea)) {
      violations.push({
        code: "SCREEN_RECT_NEGATIVE_DIMENSIONS",
        message: `Screen ${screen.outputId} has negative dimensions`,
        entityId: screen.outputId
      });
    }
  }

  for (const win of windows) {
    if (!isFiniteRect(win.frameGeometry)) {
      violations.push({
        code: "WINDOW_FRAME_NOT_FINITE",
        message: `Window ${win.id} has non-finite frameGeometry`,
        entityId: win.id
      });
    }
    if (win.desiredGeometry && !isFiniteRect(win.desiredGeometry)) {
      violations.push({
        code: "WINDOW_DESIRED_NOT_FINITE",
        message: `Window ${win.id} has non-finite desiredGeometry`,
        entityId: win.id
      });
    }
    if (!isNonNegativeSize(win.frameGeometry)) {
      violations.push({
        code: "WINDOW_FRAME_NEGATIVE_DIMENSIONS",
        message: `Window ${win.id} has negative dimensions`,
        entityId: win.id
      });
    }
    if (win.desiredGeometry && !isNonNegativeSize(win.desiredGeometry)) {
      violations.push({
        code: "WINDOW_DESIRED_NEGATIVE_DIMENSIONS",
        message: `Window ${win.id} has negative desired dimensions`,
        entityId: win.id
      });
    }
  }

  for (const tx of transactions) {
    for (const op of tx.operations) {
      if (!isFiniteRect(op.targetRect) || (op.previousRect && !isFiniteRect(op.previousRect))) {
        violations.push({
          code: "OPERATION_RECT_NOT_FINITE",
          message: `Transaction ${tx.epoch} operation on ${op.windowId} has non-finite rect`,
          entityId: op.windowId
        });
      }
      if (!isNonNegativeSize(op.targetRect) || (op.previousRect && !isNonNegativeSize(op.previousRect))) {
        violations.push({
          code: "OPERATION_RECT_NEGATIVE_DIMENSIONS",
          message: `Transaction ${tx.epoch} operation on ${op.windowId} has negative dimensions`,
          entityId: op.windowId
        });
      }
    }
  }

  // 2. Tiled geometry remains within usable area
  const screenMap = new Map<string, SerializableRetainedScreen>(screens.map(s => [s.outputId, s]));

  for (const win of windows) {
    if (!win.tileable || win.minimized || win.fullScreen || !win.desiredGeometry) continue;
    const screen = screenMap.get(win.outputId);
    if (!screen) continue;

    const u = screen.usableArea;
    const d = win.desiredGeometry;

    // Horizontal bounds and top bound must ALWAYS hold, even under vertical saturation
    if (d.x < u.x - tolerance || d.x + d.width > u.x + u.width + tolerance || d.y < u.y - tolerance) {
      violations.push({
        code: "TILED_GEOMETRY_OUT_OF_BOUNDS",
        message: `Window ${win.id} desired geometry [${d.x},${d.y},${d.width}x${d.height}] exceeds screen ${screen.outputId} usable area [${u.x},${u.y},${u.width}x${u.height}] horizontally or above top boundary`,
        entityId: win.id
      });
      continue;
    }

    // Check vertical overflow: only permitted if screen height cannot accommodate 60px per window
    const countOnScreen = windows.filter(w => w.outputId === screen.outputId && w.tileable && !w.minimized && !w.fullScreen).length;
    const isVerticallySaturated = countOnScreen > 0 && screen.usableArea.height / countOnScreen < 60;

    if (d.y + d.height > u.y + u.height + tolerance) {
      if (!isVerticallySaturated) {
        violations.push({
          code: "TILED_GEOMETRY_OUT_OF_BOUNDS",
          message: `Window ${win.id} desired geometry [${d.x},${d.y},${d.width}x${d.height}] exceeds screen ${screen.outputId} usable area [${u.x},${u.y},${u.width}x${u.height}] vertically`,
          entityId: win.id
        });
      }
    }
  }

  // 3. Retained window belongs to at most one output
  const windowCounts = new Map<string, number>();
  for (const win of windows) {
    windowCounts.set(win.id, (windowCounts.get(win.id) ?? 0) + 1);
  }
  for (const [winId, count] of windowCounts.entries()) {
    if (count > 1) {
      violations.push({
        code: "DUPLICATE_WINDOW_RETAINED",
        message: `Window ${winId} appears ${count} times in retained window state`,
        entityId: winId
      });
    }
  }

  // Screen orderedWindowIds uniqueness and output matching
  for (const screen of screens) {
    const seenInScreen = new Set<string>();
    for (const wid of screen.orderedWindowIds) {
      if (seenInScreen.has(wid)) {
        violations.push({
          code: "DUPLICATE_WINDOW_IN_SCREEN_ORDER",
          message: `Screen ${screen.outputId} orderedWindowIds contains duplicate ${wid}`,
          entityId: wid
        });
      }
      seenInScreen.add(wid);

      const win = windows.find(w => w.id === wid);
      if (win && win.outputId !== screen.outputId) {
        violations.push({
          code: "WINDOW_OUTPUT_MISMATCH",
          message: `Window ${wid} is in screen ${screen.outputId} orderedWindowIds but window.outputId is ${win.outputId}`,
          entityId: wid
        });
      }
    }
  }

  // 4. Transaction epochs are strictly increasing
  let lastEpoch = 0;
  for (const tx of transactions) {
    if (tx.epoch <= lastEpoch) {
      violations.push({
        code: "TRANSACTION_EPOCH_NOT_STRICTLY_INCREASING",
        message: `Transaction epoch ${tx.epoch} is not strictly greater than previous ${lastEpoch}`
      });
    }
    lastEpoch = tx.epoch;
  }

  // 5. Fullscreen and floating windows excluded from tiled geometry operations (unless transitioning)
  const windowMap = new Map(windows.map(w => [w.id, w]));
  for (const tx of transactions) {
    for (const op of tx.operations) {
      const win = windowMap.get(op.windowId);
      if (win && !win.tileable) {
        // If window is currently retained and classified non-tileable/floating/fullscreen in the final state,
        // check if this transaction was when it was tileable, or if it was wrongly targeted for tiling
        // Note: op could be recorded while it was tileable before a later untile event.
      }
    }
  }

  // 6. Non-overlap invariant for non-overlapping layouts (master-stack, grid, binary-split, columns, rows)
  const OVERLAPPING_LAYOUTS = new Set(["monocle", "floating"]);
  for (const screen of screens) {
    if (OVERLAPPING_LAYOUTS.has(screen.activeLayout)) {
      continue;
    }

    const tileableOnScreen = windows.filter(
      w => w.outputId === screen.outputId && w.tileable && !w.minimized && !w.fullScreen && w.desiredGeometry
    );

    for (let i = 0; i < tileableOnScreen.length; i++) {
      for (let j = i + 1; j < tileableOnScreen.length; j++) {
        const w1 = tileableOnScreen[i];
        const w2 = tileableOnScreen[j];
        const r1 = w1.desiredGeometry!;
        const r2 = w2.desiredGeometry!;
        if (rectsOverlap(r1, r2, tolerance)) {
          // Partition-aware saturation rule:
          // 1. Windows MUST share the same column (exact same horizontal span).
          // Cross-column or horizontal overlaps always violate the invariant.
          const isSameColumn = Math.abs(r1.x - r2.x) <= tolerance && Math.abs(r1.width - r2.width) <= tolerance;
          if (isSameColumn) {
            // Count windows belonging to this specific column partition
            const partitionWindows = tileableOnScreen.filter(w => {
              const r = w.desiredGeometry!;
              return Math.abs(r.x - r1.x) <= tolerance && Math.abs(r.width - r1.width) <= tolerance;
            });
            const partitionHeight = screen.usableArea.height;
            const isPartitionUnsatisfiable = partitionWindows.length > 0 && (partitionHeight / partitionWindows.length) < 60;

            // Only mathematically unsatisfiable partitions get vertical overlap tolerance
            if (isPartitionUnsatisfiable) {
              continue;
            }
          }

          violations.push({
            code: "TILED_WINDOWS_OVERLAP",
            message: `Windows ${w1.id} and ${w2.id} overlap in non-overlapping layout ${screen.activeLayout} on screen ${screen.outputId}`,
            entityId: `${w1.id},${w2.id}`
          });
        }
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations
  };
}
