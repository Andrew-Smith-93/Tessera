import { describe, it, expect } from 'vitest';
import { solveBalancedGrid, solveMasterStack, solveTree } from '../src/solver.js';
import { insertWindow } from '../src/tree.js';
import type { Rect, GapConfig } from '@tessera/protocol';

describe('layout solver', () => {
  const container: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
  const noGaps: GapConfig = { inner: 0, outer: 0 };
  const gaps: GapConfig = { inner: 10, outer: 20 };

  describe('solveBalancedGrid', () => {
    it('handles 1 window with full container area', () => {
      const solution = solveBalancedGrid(container, ['win-1'], noGaps);
      expect(solution.size).toBe(1);
      expect(solution.get('win-1')).toEqual(container);
    });

    it('handles 2 windows with exact 50/50 vertical split', () => {
      const solution = solveBalancedGrid(container, ['win-1', 'win-2'], noGaps);
      expect(solution.size).toBe(2);

      const w1 = solution.get('win-1')!;
      const w2 = solution.get('win-2')!;

      expect(w1.width).toBe(960);
      expect(w2.width).toBe(960);
      expect(w1.height).toBe(1080);
      expect(w2.height).toBe(1080);
      expect(w1.x).toBe(0);
      expect(w2.x).toBe(960);
    });

    it('handles 3 windows with 3 equal vertical columns', () => {
      const solution = solveBalancedGrid(container, ['win-1', 'win-2', 'win-3'], noGaps);
      expect(solution.size).toBe(3);

      const w1 = solution.get('win-1')!;
      const w2 = solution.get('win-2')!;
      const w3 = solution.get('win-3')!;

      expect(w1.width).toBe(640);
      expect(w2.width).toBe(640);
      expect(w3.width).toBe(640);
      expect(w1.x).toBe(0);
      expect(w2.x).toBe(640);
      expect(w3.x).toBe(1280);
    });

    it('handles 4 windows as 4 equal quarters (2x2)', () => {
      const solution = solveBalancedGrid(container, ['win-1', 'win-2', 'win-3', 'win-4'], noGaps);
      expect(solution.size).toBe(4);

      const w1 = solution.get('win-1')!;
      const w2 = solution.get('win-2')!;
      const w3 = solution.get('win-3')!;
      const w4 = solution.get('win-4')!;

      // Row-major:
      // win-1: (0, 0), win-2: (960, 0)
      // win-3: (0, 540), win-4: (960, 540)
      expect(w1).toEqual({ x: 0, y: 0, width: 960, height: 540 });
      expect(w2).toEqual({ x: 960, y: 0, width: 960, height: 540 });
      expect(w3).toEqual({ x: 0, y: 540, width: 960, height: 540 });
      expect(w4).toEqual({ x: 960, y: 540, width: 960, height: 540 });
    });

    it('handles 5 windows with 2 left, 1 center stack, 2 right', () => {
      const solution = solveBalancedGrid(
        container,
        ['win-1', 'win-2', 'win-3', 'win-4', 'win-5'],
        noGaps,
      );
      expect(solution.size).toBe(5);

      const w1 = solution.get('win-1')!;
      const w2 = solution.get('win-2')!;
      const w3 = solution.get('win-3')!; // center
      const w4 = solution.get('win-4')!;
      const w5 = solution.get('win-5')!;

      const colW = Math.floor(1920 / 3); // 640
      const halfH = Math.floor(1080 / 2); // 540

      // Left column: win-1, win-2
      expect(w1).toEqual({ x: 0, y: 0, width: colW, height: halfH });
      expect(w2).toEqual({ x: 0, y: halfH, width: colW, height: 1080 - halfH });

      // Center column: win-3
      expect(w3).toEqual({ x: colW, y: 0, width: colW, height: 1080 });

      // Right column: win-4, win-5
      const rightX = colW * 2;
      expect(w4).toEqual({ x: rightX, y: 0, width: 1920 - rightX, height: halfH });
      expect(w5).toEqual({ x: rightX, y: halfH, width: 1920 - rightX, height: 1080 - halfH });
    });

    it('handles 6 windows with 2 rows x 3 columns', () => {
      const solution = solveBalancedGrid(
        container,
        ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
        noGaps,
      );
      expect(solution.size).toBe(6);

      const w1 = solution.get('w1')!;
      expect(w1.width).toBe(Math.floor(1920 / 3));
      expect(w1.height).toBe(Math.floor(1080 / 2));
    });

    it('applies inner and outer gaps accurately', () => {
      const solution = solveBalancedGrid(container, ['win-1', 'win-2'], gaps);
      const w1 = solution.get('win-1')!;
      const w2 = solution.get('win-2')!;

      expect(w1.x).toBe(20);
      expect(w1.y).toBe(20);
      expect(w1.width).toBe(935);
      expect(w1.height).toBe(1040);

      expect(w2.x).toBe(965);
      expect(w2.y).toBe(20);
      expect(w2.width).toBe(935);
      expect(w2.height).toBe(1040);
    });
  });

  describe('solveMasterStack', () => {
    it('falls back to solveBalancedGrid when masterCount is 0', () => {
      const solution = solveMasterStack(
        container,
        ['w1', 'w2', 'w3', 'w4'],
        noGaps,
        { masterCount: 0 },
      );
      // 4 windows with 0 masters should produce 4 equal quarters, not 1 giant master
      expect(solution.size).toBe(4);
      const w1 = solution.get('w1')!;
      expect(w1).toEqual({ x: 0, y: 0, width: 960, height: 540 });
    });

    it('allocates 50/50 when exactly 2 windows are present regardless of masterCount', () => {
      const solution = solveMasterStack(
        container,
        ['w1', 'w2'],
        noGaps,
        { masterCount: 1, masterRatio: 0.5 },
      );
      expect(solution.get('w1')!.width).toBe(960);
      expect(solution.get('w2')!.width).toBe(960);
    });

    it('stacks 1 master on left, 2 secondary windows on right', () => {
      const solution = solveMasterStack(
        container,
        ['m1', 's1', 's2'],
        noGaps,
        { masterCount: 1, masterRatio: 0.5 },
      );
      expect(solution.size).toBe(3);

      const m1 = solution.get('m1')!;
      const s1 = solution.get('s1')!;
      const s2 = solution.get('s2')!;

      expect(m1).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
      expect(s1).toEqual({ x: 960, y: 0, width: 960, height: 540 });
      expect(s2).toEqual({ x: 960, y: 540, width: 960, height: 540 });
    });
  });

  describe('solveTree', () => {
    it('solves binary split tree', () => {
      let root = insertWindow(null, 'w1');
      root = insertWindow(root, 'w2');

      const solution = solveTree(root, container, noGaps);
      expect(solution.size).toBe(2);
      expect(solution.get('w1')!.width).toBe(960);
      expect(solution.get('w2')!.width).toBe(960);
    });
  });
});
