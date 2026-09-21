import type { Rect, GapConfig, LayoutAlgorithm, RuntimeWindowId } from "@tessera/protocol";
import { applyGaps } from "./geometry.js";
import type { LayoutNode, LeafNode } from "./tree.js";

export interface SolverOptions {
  masterRatio?: number;
  masterCount?: number;
}

export type SolutionMap = Map<RuntimeWindowId, Rect>;

/**
 * Balanced Square Grid Layout:
 * Optimally partitions area so that windows have square-like proportions with zero dominant master.
 * - 1 window: 100%
 * - 2 windows: 50/50 side-by-side
 * - 3 windows: 3 equal vertical columns
 * - 4 windows: 4 equal quarters (2x2)
 * - 5 windows: two horizontal split sides on each end (2 left, 2 right) and a full-height stack in the center
 * - N >= 6: symmetrical balanced column/row partitions
 */
export function solveBalancedGrid(
  area: Rect,
  windows: readonly RuntimeWindowId[],
  gaps: GapConfig
): SolutionMap {
  const result: SolutionMap = new Map();
  const count = windows.length;
  if (count === 0) return result;

  if (count === 1) {
    result.set(windows[0], applyGaps(area, gaps, true, true, true, true));
    return result;
  }

  if (count === 2) {
    const w0 = Math.floor(area.width / 2);
    const w1 = area.width - w0;
    result.set(windows[0], applyGaps({ x: area.x, y: area.y, width: w0, height: area.height }, gaps, true, false, true, true));
    result.set(windows[1], applyGaps({ x: area.x + w0, y: area.y, width: w1, height: area.height }, gaps, false, true, true, true));
    return result;
  }

  if (count === 3) {
    const colW = Math.floor(area.width / 3);
    for (let c = 0; c < 3; c++) {
      const cx = area.x + c * colW;
      const cw = (c === 2) ? (area.width - 2 * colW) : colW;
      result.set(windows[c], applyGaps({ x: cx, y: area.y, width: cw, height: area.height }, gaps, c === 0, c === 2, true, true));
    }
    return result;
  }

  if (count === 4) {
    const colW = Math.floor(area.width / 2);
    const rowH = Math.floor(area.height / 2);
    let idx = 0;
    for (let row = 0; row < 2; row++) {
      const ry = area.y + row * rowH;
      const rh = (row === 1) ? (area.height - rowH) : rowH;
      for (let col = 0; col < 2; col++) {
        const cx = area.x + col * colW;
        const cw = (col === 1) ? (area.width - colW) : colW;
        result.set(windows[idx++], applyGaps({ x: cx, y: ry, width: cw, height: rh }, gaps, col === 0, col === 1, row === 0, row === 1));
      }
    }
    return result;
  }

  if (count === 5) {
    const colW = Math.floor(area.width / 3);
    const colW0 = colW;
    const colW1 = colW;
    const colW2 = area.width - (colW0 + colW1);
    const rowH = Math.floor(area.height / 2);

    // Left end: 2 horizontal splits
    result.set(windows[0], applyGaps({ x: area.x, y: area.y, width: colW0, height: rowH }, gaps, true, false, true, false));
    result.set(windows[1], applyGaps({ x: area.x, y: area.y + rowH, width: colW0, height: area.height - rowH }, gaps, true, false, false, true));

    // Middle: 1 full-height window
    result.set(windows[2], applyGaps({ x: area.x + colW0, y: area.y, width: colW1, height: area.height }, gaps, false, false, true, true));

    // Right end: 2 horizontal splits
    const rightX = area.x + colW0 + colW1;
    result.set(windows[3], applyGaps({ x: rightX, y: area.y, width: colW2, height: rowH }, gaps, false, true, true, false));
    result.set(windows[4], applyGaps({ x: rightX, y: area.y + rowH, width: colW2, height: area.height - rowH }, gaps, false, true, false, true));

    return result;
  }

  // N >= 6: Symmetrical balanced square grid
  let numCols = 3;
  if (count >= 8 && count <= 10) {
    numCols = count === 9 ? 3 : 4;
  } else if (count > 10) {
    numCols = Math.ceil(Math.sqrt(count * (area.width / area.height)));
  }

  const countsPerCol: number[] = new Array(numCols).fill(Math.floor(count / numCols));
  let rem = count % numCols;
  if (rem === 1) {
    countsPerCol[Math.floor(numCols / 2)]++;
  } else if (rem === 2 && numCols === 3) {
    countsPerCol[0]++;
    countsPerCol[2]++;
  } else if (rem > 0) {
    let left = 0;
    let right = numCols - 1;
    while (rem > 0) {
      countsPerCol[left]++;
      rem--;
      if (rem > 0 && left !== right) {
        countsPerCol[right]++;
        rem--;
      }
      left++;
      right--;
      if (left > right) {
        left = 0;
        right = numCols - 1;
      }
    }
  }

  const colW = Math.floor(area.width / numCols);
  let currentX = area.x;
  let winIdx = 0;

  for (let c = 0; c < numCols; c++) {
    const cw = (c === numCols - 1) ? (area.x + area.width - currentX) : colW;
    const numRows = countsPerCol[c];
    const rowH = Math.floor(area.height / numRows);
    let currentY = area.y;

    for (let r = 0; r < numRows; r++) {
      const rh = (r === numRows - 1) ? (area.y + area.height - currentY) : rowH;
      result.set(
        windows[winIdx++],
        applyGaps(
          { x: currentX, y: currentY, width: cw, height: rh },
          gaps,
          c === 0,
          c === numCols - 1,
          r === 0,
          r === numRows - 1
        )
      );
      currentY += rh;
    }
    currentX += cw;
  }

  return result;
}

/**
 * Master-Stack Layout:
 * - When masterCount === 0: delegates to balanced square grid!
 * - When count === 2: defaults to clean 50/50 side-by-side split!
 * - When actualMasters > 1 and no stack: partitions into equal side-by-side columns!
 */
export function solveMasterStack(
  area: Rect,
  windows: readonly RuntimeWindowId[],
  gaps: GapConfig,
  options?: SolverOptions
): SolutionMap {
  const result: SolutionMap = new Map();
  const count = windows.length;
  if (count === 0) return result;

  const masterRatio = options?.masterRatio !== undefined ? options.masterRatio : 0.50;
  const masterCount = Math.max(0, options?.masterCount !== undefined ? options.masterCount : 1);

  if (count === 1) {
    result.set(windows[0], applyGaps(area, gaps, true, true, true, true));
    return result;
  }

  // 0 Masters: delegate to balanced square grid
  if (masterCount === 0) {
    return solveBalancedGrid(area, windows, gaps);
  }

  // 2 Windows: exact 50/50 split
  if (count === 2) {
    const halfW = Math.floor(area.width / 2);
    result.set(windows[0], applyGaps({ x: area.x, y: area.y, width: halfW, height: area.height }, gaps, true, false, true, true));
    result.set(windows[1], applyGaps({ x: area.x + halfW, y: area.y, width: area.width - halfW, height: area.height }, gaps, false, true, true, true));
    return result;
  }

  const actualMasters = Math.min(count, masterCount);
  const stackCount = count - actualMasters;

  if (stackCount === 0) {
    const colWidth = Math.floor(area.width / actualMasters);
    for (let c = 0; c < actualMasters; c++) {
      const cx = area.x + c * colWidth;
      const cw = (c === actualMasters - 1) ? (area.width - c * colWidth) : colWidth;
      result.set(windows[c], applyGaps({ x: cx, y: area.y, width: cw, height: area.height }, gaps, c === 0, c === actualMasters - 1, true, true));
    }
    return result;
  }

  const masterWidth = Math.floor(area.width * masterRatio);
  const stackWidth = area.width - masterWidth;

  // Master Column
  const masterHeight = Math.floor(area.height / actualMasters);
  for (let m = 0; m < actualMasters; m++) {
    const my = area.y + m * masterHeight;
    const mh = (m === actualMasters - 1) ? (area.height - m * masterHeight) : masterHeight;
    result.set(windows[m], applyGaps({ x: area.x, y: my, width: masterWidth, height: mh }, gaps, true, false, m === 0, m === actualMasters - 1));
  }

  // Stack Column
  const stackHeight = Math.floor(area.height / stackCount);
  for (let s = 0; s < stackCount; s++) {
    const sy = area.y + s * stackHeight;
    const sh = (s === stackCount - 1) ? (area.height - s * stackHeight) : stackHeight;
    result.set(windows[actualMasters + s], applyGaps({ x: area.x + masterWidth, y: sy, width: stackWidth, height: sh }, gaps, false, true, s === 0, s === stackCount - 1));
  }

  return result;
}

/**
 * Binary Space Partitioning (Tree-Driven):
 */
export function solveTree(
  node: LayoutNode | null,
  area: Rect,
  gaps: GapConfig
): SolutionMap {
  const result: SolutionMap = new Map();
  if (!node) return result;

  function traverse(n: LayoutNode, r: Rect, isLeft: boolean, isRight: boolean, isTop: boolean, isBottom: boolean) {
    n.rect = r;
    if (n.kind === "leaf") {
      result.set((n as LeafNode).windowId, applyGaps(r, gaps, isLeft, isRight, isTop, isBottom));
      return;
    }

    if (n.direction === "horizontal") {
      const w0 = Math.floor(r.width * n.ratio);
      const w1 = r.width - w0;
      traverse(n.children[0], { x: r.x, y: r.y, width: w0, height: r.height }, isLeft, false, isTop, isBottom);
      traverse(n.children[1], { x: r.x + w0, y: r.y, width: w1, height: r.height }, false, isRight, isTop, isBottom);
    } else {
      const h0 = Math.floor(r.height * n.ratio);
      const h1 = r.height - h0;
      traverse(n.children[0], { x: r.x, y: r.y, width: r.width, height: h0 }, isLeft, isRight, isTop, false);
      traverse(n.children[1], { x: r.x, y: r.y + h0, width: r.width, height: h1 }, isLeft, isRight, false, isBottom);
    }
  }

  traverse(node, area, true, true, true, true);
  return result;
}

export function solveLayout(
  algorithm: LayoutAlgorithm,
  area: Rect,
  windows: readonly RuntimeWindowId[],
  gaps: GapConfig,
  options?: SolverOptions,
  treeNode?: LayoutNode | null
): SolutionMap {
  switch (algorithm) {
    case "balanced-grid":
    case "grid" as LayoutAlgorithm:
      return solveBalancedGrid(area, windows, gaps);
    case "master-stack":
      return solveMasterStack(area, windows, gaps, options);
    case "binary-split":
      return treeNode ? solveTree(treeNode, area, gaps) : solveBalancedGrid(area, windows, gaps);
    case "columns": {
      const res: SolutionMap = new Map();
      const colW = Math.floor(area.width / windows.length);
      for (let i = 0; i < windows.length; i++) {
        const cw = (i === windows.length - 1) ? (area.width - i * colW) : colW;
        res.set(windows[i], applyGaps({ x: area.x + i * colW, y: area.y, width: cw, height: area.height }, gaps, i === 0, i === windows.length - 1, true, true));
      }
      return res;
    }
    case "rows": {
      const res: SolutionMap = new Map();
      const rowH = Math.floor(area.height / windows.length);
      for (let i = 0; i < windows.length; i++) {
        const rh = (i === windows.length - 1) ? (area.height - i * rowH) : rowH;
        res.set(windows[i], applyGaps({ x: area.x, y: area.y + i * rowH, width: area.width, height: rh }, gaps, true, true, i === 0, i === windows.length - 1));
      }
      return res;
    }
    case "monocle": {
      const res: SolutionMap = new Map();
      const full = applyGaps(area, gaps, true, true, true, true);
      for (const w of windows) {
        res.set(w, full);
      }
      return res;
    }
    case "floating":
    default:
      return new Map();
  }
}
