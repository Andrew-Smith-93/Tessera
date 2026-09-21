import {
  solveBalancedGrid,
  solveMasterStack,
  solveLayout,
  solveTree,
  insertWindow,
  applyGaps
} from "@tessera/layout-core";
import type { Rect, GapConfig, RuntimeWindowId } from "@tessera/protocol";

export interface QmlLayoutOptions {
  gapInner?: number;
  gapOuter?: number;
  masterRatio?: number;
  masterCount?: number;
}

function makeSyntheticIds(count: number): RuntimeWindowId[] {
  const ids: RuntimeWindowId[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(`win-${i}`);
  }
  return ids;
}

function solutionToArray(solution: Map<RuntimeWindowId, Rect>, ids: RuntimeWindowId[]): Rect[] {
  return ids.map(id => solution.get(id) || { x: 0, y: 0, width: 0, height: 0 });
}

function extractGaps(options?: QmlLayoutOptions): GapConfig {
  return {
    inner: options?.gapInner ?? 8,
    outer: options?.gapOuter ?? 10
  };
}

export const Layouts = {
  applyGaps(rect: Rect, gapInner: number, gapOuter: number, isLeft = true, isRight = true, isTop = true, isBottom = true): Rect {
    return applyGaps(rect, { inner: gapInner, outer: gapOuter }, isLeft, isRight, isTop, isBottom);
  },

  masterStack(area: Rect, count: number, options?: QmlLayoutOptions): Rect[] {
    if (count <= 0) return [];
    const ids = makeSyntheticIds(count);
    const gaps = extractGaps(options);
    const solution = solveMasterStack(area, ids, gaps, {
      masterRatio: options?.masterRatio,
      masterCount: options?.masterCount
    });
    return solutionToArray(solution, ids);
  },

  balancedGrid(area: Rect, count: number, options?: QmlLayoutOptions): Rect[] {
    if (count <= 0) return [];
    const ids = makeSyntheticIds(count);
    const gaps = extractGaps(options);
    const solution = solveBalancedGrid(area, ids, gaps);
    return solutionToArray(solution, ids);
  },

  grid(area: Rect, count: number, options?: QmlLayoutOptions): Rect[] {
    return this.balancedGrid(area, count, options);
  },

  binarySplit(area: Rect, count: number, options?: QmlLayoutOptions): Rect[] {
    if (count <= 0) return [];
    const ids = makeSyntheticIds(count);
    const gaps = extractGaps(options);
    let root = null;
    for (const id of ids) {
      root = insertWindow(root, id);
    }
    const solution = solveTree(root, area, gaps);
    return solutionToArray(solution, ids);
  },

  columns(area: Rect, count: number, options?: QmlLayoutOptions): Rect[] {
    if (count <= 0) return [];
    const ids = makeSyntheticIds(count);
    const gaps = extractGaps(options);
    const solution = solveLayout("columns", area, ids, gaps);
    return solutionToArray(solution, ids);
  },

  rows(area: Rect, count: number, options?: QmlLayoutOptions): Rect[] {
    if (count <= 0) return [];
    const ids = makeSyntheticIds(count);
    const gaps = extractGaps(options);
    const solution = solveLayout("rows", area, ids, gaps);
    return solutionToArray(solution, ids);
  },

  monocle(area: Rect, count: number, options?: QmlLayoutOptions): Rect[] {
    if (count <= 0) return [];
    const ids = makeSyntheticIds(count);
    const gaps = extractGaps(options);
    const solution = solveLayout("monocle", area, ids, gaps);
    return solutionToArray(solution, ids);
  },

  supportedLayouts: ["master-stack", "bsp", "columns", "rows", "grid", "monocle", "floating"]
};

// Export to global for QML consumption
(globalThis as unknown as { Layouts: typeof Layouts }).Layouts = Layouts;
