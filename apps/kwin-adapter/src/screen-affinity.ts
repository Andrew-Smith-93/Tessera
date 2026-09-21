import type { Rect, Point } from "@tessera/protocol";
import type { NormalizedScreenInput } from "./coordinator-types.js";

export interface ScreenAffinityInputs {
  readonly explicitOutputId?: string;
  readonly frameGeometry?: Rect;
  readonly previousOutputId?: string;
  readonly cursorPoint?: Point;
  readonly screens: readonly NormalizedScreenInput[];
}

/**
 * Calculates Euclidean distance between a point and a rectangle.
 * Returns 0 if the point is within or on the edge of the rectangle.
 */
export function pointToRectDistance(px: number, py: number, r: Rect): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.width));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.height));
  return Math.hypot(dx, dy);
}

/**
 * Calculates the area of intersection between two rectangles.
 */
export function rectIntersectionArea(a: Rect, b: Rect): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

/**
 * Checks whether a rectangle contains a point.
 */
export function rectContainsPoint(r: Rect, px: number, py: number): boolean {
  return px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height;
}

/**
 * Pure 7-step deterministic multi-screen affinity resolution hierarchy:
 * 1. Explicit valid KWin output identity.
 * 2. Output containing window center point.
 * 3. Output with greatest window intersection area.
 * 4. Previous valid retained output affinity.
 * 5. Output containing cursor point.
 * 6. Deterministic nearest-output fallback (Euclidean distance to screen rect).
 * 7. Stable lexical outputId tie-breaker.
 */
export function resolveScreenAffinity(inputs: ScreenAffinityInputs): string {
  const screens = inputs.screens;
  if (!screens || screens.length === 0) {
    return inputs.explicitOutputId || inputs.previousOutputId || "default";
  }

  // Pre-index valid outputIds
  const screenMap = new Map<string, NormalizedScreenInput>();
  for (const s of screens) {
    screenMap.set(s.outputId, s);
  }

  // Step 1: Explicit valid KWin output identity
  if (inputs.explicitOutputId && screenMap.has(inputs.explicitOutputId)) {
    return inputs.explicitOutputId;
  }

  const geom = inputs.frameGeometry;
  const hasGeom = Boolean(geom && geom.width > 0 && geom.height > 0);

  // Step 2: Output containing window center point
  if (hasGeom && geom) {
    const cx = geom.x + geom.width / 2;
    const cy = geom.y + geom.height / 2;

    const centerMatches: NormalizedScreenInput[] = [];
    for (const s of screens) {
      const targetArea = s.usableArea || s.geometry;
      if (rectContainsPoint(targetArea, cx, cy) || rectContainsPoint(s.geometry, cx, cy)) {
        centerMatches.push(s);
      }
    }

    if (centerMatches.length === 1) {
      return centerMatches[0].outputId;
    }
    if (centerMatches.length > 1) {
      // Tie-breaker: lexical outputId
      centerMatches.sort((a, b) => a.outputId.localeCompare(b.outputId));
      return centerMatches[0].outputId;
    }
  }

  // Step 3: Output with greatest window intersection area
  if (hasGeom && geom) {
    let maxArea = 0;
    let maxCandidates: NormalizedScreenInput[] = [];

    for (const s of screens) {
      const area = Math.max(
        rectIntersectionArea(geom, s.geometry),
        s.usableArea ? rectIntersectionArea(geom, s.usableArea) : 0
      );
      if (area > maxArea) {
        maxArea = area;
        maxCandidates = [s];
      } else if (area > 0 && area === maxArea) {
        maxCandidates.push(s);
      }
    }

    if (maxCandidates.length === 1) {
      return maxCandidates[0].outputId;
    }
    if (maxCandidates.length > 1) {
      maxCandidates.sort((a, b) => a.outputId.localeCompare(b.outputId));
      return maxCandidates[0].outputId;
    }
  }

  // Step 4: Previous valid retained output affinity
  if (inputs.previousOutputId && screenMap.has(inputs.previousOutputId)) {
    return inputs.previousOutputId;
  }

  // Step 5: Output containing cursor point
  if (inputs.cursorPoint) {
    const px = inputs.cursorPoint.x;
    const py = inputs.cursorPoint.y;
    const cursorMatches: NormalizedScreenInput[] = [];

    for (const s of screens) {
      const targetArea = s.usableArea || s.geometry;
      if (rectContainsPoint(targetArea, px, py) || rectContainsPoint(s.geometry, px, py)) {
        cursorMatches.push(s);
      }
    }

    if (cursorMatches.length === 1) {
      return cursorMatches[0].outputId;
    }
    if (cursorMatches.length > 1) {
      cursorMatches.sort((a, b) => a.outputId.localeCompare(b.outputId));
      return cursorMatches[0].outputId;
    }
  }

  // Step 6: Deterministic nearest-output fallback (Euclidean distance to screen rect)
  let refX = 0;
  let refY = 0;
  if (hasGeom && geom) {
    refX = geom.x + geom.width / 2;
    refY = geom.y + geom.height / 2;
  } else if (inputs.cursorPoint) {
    refX = inputs.cursorPoint.x;
    refY = inputs.cursorPoint.y;
  }

  let minDistance = Infinity;
  let nearestCandidates: NormalizedScreenInput[] = [];

  for (const s of screens) {
    const dist = pointToRectDistance(refX, refY, s.geometry);
    if (dist < minDistance - 1e-6) {
      minDistance = dist;
      nearestCandidates = [s];
    } else if (Math.abs(dist - minDistance) <= 1e-6) {
      nearestCandidates.push(s);
    }
  }

  // Step 7: Stable lexical outputId tie-breaker
  if (nearestCandidates.length > 0) {
    nearestCandidates.sort((a, b) => a.outputId.localeCompare(b.outputId));
    return nearestCandidates[0].outputId;
  }

  return screens[0].outputId;
}

/**
 * Pure helper for cursor-based target screen resolution with nearest-screen fallback.
 */
export function resolveCursorTargetScreen(
  screens: readonly NormalizedScreenInput[],
  cursorPoint: Point,
  fallbackOutputId?: string
): NormalizedScreenInput {
  if (!screens || screens.length === 0) {
    return {
      outputId: fallbackOutputId || "default",
      geometry: { x: 0, y: 0, width: 1920, height: 1080 },
      usableArea: { x: 0, y: 0, width: 1920, height: 1080 }
    };
  }

  // 1. Direct containment in usable area or geometry
  const containing: NormalizedScreenInput[] = [];
  for (const s of screens) {
    const area = s.usableArea || s.geometry;
    if (rectContainsPoint(area, cursorPoint.x, cursorPoint.y) || rectContainsPoint(s.geometry, cursorPoint.x, cursorPoint.y)) {
      containing.push(s);
    }
  }

  if (containing.length === 1) {
    return containing[0];
  }
  if (containing.length > 1) {
    containing.sort((a, b) => a.outputId.localeCompare(b.outputId));
    return containing[0];
  }

  // 2. Nearest screen fallback
  let minDistance = Infinity;
  let candidates: NormalizedScreenInput[] = [];

  for (const s of screens) {
    const dist = pointToRectDistance(cursorPoint.x, cursorPoint.y, s.geometry);
    if (dist < minDistance - 1e-6) {
      minDistance = dist;
      candidates = [s];
    } else if (Math.abs(dist - minDistance) <= 1e-6) {
      candidates.push(s);
    }
  }

  candidates.sort((a, b) => a.outputId.localeCompare(b.outputId));
  return candidates[0] || screens[0];
}
