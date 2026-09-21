import { describe, it, expect } from 'vitest';
import { createRect, rectEquals, applyGaps, clampConstraints, centerPoint } from '../src/geometry.js';
import type { Rect, GapConfig, SizeConstraints } from '@tessera/protocol';

describe('geometry utilities', () => {
  it('creates rect with rounded precision', () => {
    const r = createRect(10.2, 20.2, 100.2, 200.1);
    expect(r).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });

  it('correctly compares rect equality', () => {
    const r1: Rect = { x: 0, y: 0, width: 800, height: 600 };
    const r2: Rect = { x: 0, y: 0, width: 800, height: 600 };
    const r3: Rect = { x: 1, y: 0, width: 800, height: 600 };
    expect(rectEquals(r1, r2)).toBe(true);
    expect(rectEquals(r1, r3)).toBe(false);
  });

  it('applies outer gaps to container area', () => {
    const container: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const gaps: GapConfig = { inner: 8, outer: 16 };
    const inner = applyGaps(container, gaps);
    expect(inner).toEqual({
      x: 16,
      y: 16,
      width: 1920 - 32,
      height: 1080 - 32,
    });
  });

  it('calculates center point correctly', () => {
    const r: Rect = { x: 100, y: 200, width: 300, height: 400 };
    expect(centerPoint(r)).toEqual({ x: 250, y: 400 });
  });

  it('clamps rectangle to min and max size constraints', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 500 };
    const constraints: SizeConstraints = {
      minWidth: 200,
      maxWidth: 600,
      minHeight: 100,
      maxHeight: 300,
    };
    const clamped = clampConstraints(r, constraints);
    expect(clamped.width).toBe(200);
    expect(clamped.height).toBe(300);
  });
});
