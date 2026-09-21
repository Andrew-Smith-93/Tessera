import { describe, it, expect } from 'vitest';
import { findDirectionalNeighbor } from '../src/navigator.js';
import type { Rect } from '@tessera/protocol';

describe('spatial directional navigator', () => {
  // Setup a 2x2 grid:
  // [A] [B]
  // [C] [D]
  const layout = new Map<string, Rect>([
    ['A', { x: 0, y: 0, width: 500, height: 500 }],
    ['B', { x: 500, y: 0, width: 500, height: 500 }],
    ['C', { x: 0, y: 500, width: 500, height: 500 }],
    ['D', { x: 500, y: 500, width: 500, height: 500 }],
  ]);

  it('navigates right from A to B', () => {
    const next = findDirectionalNeighbor('A', 'right', layout);
    expect(next).toBe('B');
  });

  it('navigates down from A to C', () => {
    const next = findDirectionalNeighbor('A', 'down', layout);
    expect(next).toBe('C');
  });

  it('navigates left from B to A', () => {
    const next = findDirectionalNeighbor('B', 'left', layout);
    expect(next).toBe('A');
  });

  it('navigates up from C to A', () => {
    const next = findDirectionalNeighbor('C', 'up', layout);
    expect(next).toBe('A');
  });

  it('navigates diagonally-adjacent cells along cardinal axes', () => {
    // From D, left should be C, up should be B
    expect(findDirectionalNeighbor('D', 'left', layout)).toBe('C');
    expect(findDirectionalNeighbor('D', 'up', layout)).toBe('B');
  });

  it('returns null when navigating into the void / edge', () => {
    expect(findDirectionalNeighbor('A', 'left', layout)).toBeNull();
    expect(findDirectionalNeighbor('A', 'up', layout)).toBeNull();
    expect(findDirectionalNeighbor('D', 'right', layout)).toBeNull();
    expect(findDirectionalNeighbor('D', 'down', layout)).toBeNull();
  });
});
