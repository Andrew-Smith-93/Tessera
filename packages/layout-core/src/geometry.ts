import type { Rect, GapConfig, SizeConstraints } from "@tessera/protocol";

export function createRect(x: number, y: number, width: number, height: number): Rect {
  return { x: Math.round(x), y: Math.round(y), width: Math.max(0, Math.round(width)), height: Math.max(0, Math.round(height)) };
}

export function rectEquals(a: Rect | null | undefined, b: Rect | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function applyGaps(
  rect: Rect,
  gaps: GapConfig,
  isLeft: boolean = true,
  isRight: boolean = true,
  isTop: boolean = true,
  isBottom: boolean = true
): Rect {
  const x = rect.x + (isLeft ? gaps.outer : Math.floor(gaps.inner / 2));
  const y = rect.y + (isTop ? gaps.outer : Math.floor(gaps.inner / 2));
  const r = (rect.x + rect.width) - (isRight ? gaps.outer : Math.ceil(gaps.inner / 2));
  const b = (rect.y + rect.height) - (isBottom ? gaps.outer : Math.ceil(gaps.inner / 2));

  return {
    x,
    y,
    width: Math.max(80, r - x),
    height: Math.max(60, b - y)
  };
}

export function clampConstraints(rect: Rect, constraints?: SizeConstraints): Rect {
  if (!constraints) return rect;
  let w = rect.width;
  let h = rect.height;

  if (constraints.minWidth > 0 && w < constraints.minWidth) w = constraints.minWidth;
  if (constraints.minHeight > 0 && h < constraints.minHeight) h = constraints.minHeight;
  if (constraints.maxWidth > 0 && w > constraints.maxWidth) w = constraints.maxWidth;
  if (constraints.maxHeight > 0 && h > constraints.maxHeight) h = constraints.maxHeight;

  return { x: rect.x, y: rect.y, width: w, height: h };
}

export function centerPoint(rect: Rect): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}
