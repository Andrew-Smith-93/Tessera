"use strict";
var LayoutsModule = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // apps/kwin-adapter/src/qml-compat.ts
  var qml_compat_exports = {};
  __export(qml_compat_exports, {
    Layouts: () => Layouts
  });

  // packages/layout-core/src/geometry.ts
  function applyGaps(rect, gaps, isLeft = true, isRight = true, isTop = true, isBottom = true) {
    const x = rect.x + (isLeft ? gaps.outer : Math.floor(gaps.inner / 2));
    const y = rect.y + (isTop ? gaps.outer : Math.floor(gaps.inner / 2));
    const r = rect.x + rect.width - (isRight ? gaps.outer : Math.ceil(gaps.inner / 2));
    const b = rect.y + rect.height - (isBottom ? gaps.outer : Math.ceil(gaps.inner / 2));
    return {
      x,
      y,
      width: Math.max(80, r - x),
      height: Math.max(60, b - y)
    };
  }

  // packages/layout-core/src/tree.ts
  var nextNodeId = 1;
  function generateNodeId() {
    return `node-${nextNodeId++}`;
  }
  function createLeaf(windowId, id) {
    return {
      kind: "leaf",
      id: id || generateNodeId(),
      windowId,
      rect: { x: 0, y: 0, width: 0, height: 0 },
      dirty: true
    };
  }
  function createSplit(left, right, direction = "horizontal", ratio = 0.5, id) {
    return {
      kind: "split",
      id: id || generateNodeId(),
      direction,
      ratio: Math.max(0.05, Math.min(0.95, ratio)),
      children: [left, right],
      rect: { x: 0, y: 0, width: 0, height: 0 },
      dirty: true
    };
  }
  function allLeaves(node) {
    if (!node) return [];
    if (node.kind === "leaf") return [node];
    return [...allLeaves(node.children[0]), ...allLeaves(node.children[1])];
  }
  function findLeafByWindow(node, windowId) {
    if (!node) return null;
    if (node.kind === "leaf") {
      return node.windowId === windowId ? node : null;
    }
    return findLeafByWindow(node.children[0], windowId) || findLeafByWindow(node.children[1], windowId);
  }
  function findParent(root, targetId) {
    if (!root || root.kind === "leaf") return null;
    if (root.children[0].id === targetId || root.children[1].id === targetId) {
      return root;
    }
    return findParent(root.children[0], targetId) || findParent(root.children[1], targetId);
  }
  function insertWindow(root, newWindowId, targetWindowId, direction = "horizontal", ratio = 0.5) {
    const newLeaf = createLeaf(newWindowId);
    if (!root) return newLeaf;
    const target = targetWindowId ? findLeafByWindow(root, targetWindowId) : null;
    const insertTarget = target || allLeaves(root)[0];
    if (!insertTarget) return newLeaf;
    if (insertTarget === root) {
      return createSplit(insertTarget, newLeaf, direction, ratio);
    }
    const parent = findParent(root, insertTarget.id);
    if (!parent) {
      return createSplit(root, newLeaf, direction, ratio);
    }
    const newSubSplit = createSplit(insertTarget, newLeaf, direction, ratio);
    if (parent.children[0].id === insertTarget.id) {
      parent.children[0] = newSubSplit;
    } else {
      parent.children[1] = newSubSplit;
    }
    parent.dirty = true;
    return root;
  }

  // packages/layout-core/src/solver.ts
  function solveBalancedGrid(area, windows, gaps) {
    const result = /* @__PURE__ */ new Map();
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
      const colW2 = Math.floor(area.width / 3);
      for (let c = 0; c < 3; c++) {
        const cx = area.x + c * colW2;
        const cw = c === 2 ? area.width - 2 * colW2 : colW2;
        result.set(windows[c], applyGaps({ x: cx, y: area.y, width: cw, height: area.height }, gaps, c === 0, c === 2, true, true));
      }
      return result;
    }
    if (count === 4) {
      const colW2 = Math.floor(area.width / 2);
      const rowH = Math.floor(area.height / 2);
      let idx = 0;
      for (let row = 0; row < 2; row++) {
        const ry = area.y + row * rowH;
        const rh = row === 1 ? area.height - rowH : rowH;
        for (let col = 0; col < 2; col++) {
          const cx = area.x + col * colW2;
          const cw = col === 1 ? area.width - colW2 : colW2;
          result.set(windows[idx++], applyGaps({ x: cx, y: ry, width: cw, height: rh }, gaps, col === 0, col === 1, row === 0, row === 1));
        }
      }
      return result;
    }
    if (count === 5) {
      const colW2 = Math.floor(area.width / 3);
      const colW0 = colW2;
      const colW1 = colW2;
      const colW22 = area.width - (colW0 + colW1);
      const rowH = Math.floor(area.height / 2);
      result.set(windows[0], applyGaps({ x: area.x, y: area.y, width: colW0, height: rowH }, gaps, true, false, true, false));
      result.set(windows[1], applyGaps({ x: area.x, y: area.y + rowH, width: colW0, height: area.height - rowH }, gaps, true, false, false, true));
      result.set(windows[2], applyGaps({ x: area.x + colW0, y: area.y, width: colW1, height: area.height }, gaps, false, false, true, true));
      const rightX = area.x + colW0 + colW1;
      result.set(windows[3], applyGaps({ x: rightX, y: area.y, width: colW22, height: rowH }, gaps, false, true, true, false));
      result.set(windows[4], applyGaps({ x: rightX, y: area.y + rowH, width: colW22, height: area.height - rowH }, gaps, false, true, false, true));
      return result;
    }
    let numCols = 3;
    if (count >= 8 && count <= 10) {
      numCols = count === 9 ? 3 : 4;
    } else if (count > 10) {
      numCols = Math.ceil(Math.sqrt(count * (area.width / area.height)));
    }
    const countsPerCol = new Array(numCols).fill(Math.floor(count / numCols));
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
      const cw = c === numCols - 1 ? area.x + area.width - currentX : colW;
      const numRows = countsPerCol[c];
      const rowH = Math.floor(area.height / numRows);
      let currentY = area.y;
      for (let r = 0; r < numRows; r++) {
        const rh = r === numRows - 1 ? area.y + area.height - currentY : rowH;
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
  function solveMasterStack(area, windows, gaps, options) {
    const result = /* @__PURE__ */ new Map();
    const count = windows.length;
    if (count === 0) return result;
    const masterRatio = options?.masterRatio !== void 0 ? options.masterRatio : 0.5;
    const masterCount = Math.max(0, options?.masterCount !== void 0 ? options.masterCount : 1);
    if (count === 1) {
      result.set(windows[0], applyGaps(area, gaps, true, true, true, true));
      return result;
    }
    if (masterCount === 0) {
      return solveBalancedGrid(area, windows, gaps);
    }
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
        const cw = c === actualMasters - 1 ? area.width - c * colWidth : colWidth;
        result.set(windows[c], applyGaps({ x: cx, y: area.y, width: cw, height: area.height }, gaps, c === 0, c === actualMasters - 1, true, true));
      }
      return result;
    }
    const masterWidth = Math.floor(area.width * masterRatio);
    const stackWidth = area.width - masterWidth;
    const masterHeight = Math.floor(area.height / actualMasters);
    for (let m = 0; m < actualMasters; m++) {
      const my = area.y + m * masterHeight;
      const mh = m === actualMasters - 1 ? area.height - m * masterHeight : masterHeight;
      result.set(windows[m], applyGaps({ x: area.x, y: my, width: masterWidth, height: mh }, gaps, true, false, m === 0, m === actualMasters - 1));
    }
    const stackHeight = Math.floor(area.height / stackCount);
    for (let s = 0; s < stackCount; s++) {
      const sy = area.y + s * stackHeight;
      const sh = s === stackCount - 1 ? area.height - s * stackHeight : stackHeight;
      result.set(windows[actualMasters + s], applyGaps({ x: area.x + masterWidth, y: sy, width: stackWidth, height: sh }, gaps, false, true, s === 0, s === stackCount - 1));
    }
    return result;
  }
  function solveTree(node, area, gaps) {
    const result = /* @__PURE__ */ new Map();
    if (!node) return result;
    function traverse(n, r, isLeft, isRight, isTop, isBottom) {
      n.rect = r;
      if (n.kind === "leaf") {
        result.set(n.windowId, applyGaps(r, gaps, isLeft, isRight, isTop, isBottom));
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
  function solveLayout(algorithm, area, windows, gaps, options, treeNode) {
    switch (algorithm) {
      case "balanced-grid":
      case "grid":
        return solveBalancedGrid(area, windows, gaps);
      case "master-stack":
        return solveMasterStack(area, windows, gaps, options);
      case "binary-split":
        return treeNode ? solveTree(treeNode, area, gaps) : solveBalancedGrid(area, windows, gaps);
      case "columns": {
        const res = /* @__PURE__ */ new Map();
        const colW = Math.floor(area.width / windows.length);
        for (let i = 0; i < windows.length; i++) {
          const cw = i === windows.length - 1 ? area.width - i * colW : colW;
          res.set(windows[i], applyGaps({ x: area.x + i * colW, y: area.y, width: cw, height: area.height }, gaps, i === 0, i === windows.length - 1, true, true));
        }
        return res;
      }
      case "rows": {
        const res = /* @__PURE__ */ new Map();
        const rowH = Math.floor(area.height / windows.length);
        for (let i = 0; i < windows.length; i++) {
          const rh = i === windows.length - 1 ? area.height - i * rowH : rowH;
          res.set(windows[i], applyGaps({ x: area.x, y: area.y + i * rowH, width: area.width, height: rh }, gaps, true, true, i === 0, i === windows.length - 1));
        }
        return res;
      }
      case "monocle": {
        const res = /* @__PURE__ */ new Map();
        const full = applyGaps(area, gaps, true, true, true, true);
        for (const w of windows) {
          res.set(w, full);
        }
        return res;
      }
      case "floating":
      default:
        return /* @__PURE__ */ new Map();
    }
  }

  // apps/kwin-adapter/src/qml-compat.ts
  function makeSyntheticIds(count) {
    const ids = [];
    for (let i = 0; i < count; i++) {
      ids.push(`win-${i}`);
    }
    return ids;
  }
  function solutionToArray(solution, ids) {
    return ids.map((id) => solution.get(id) || { x: 0, y: 0, width: 0, height: 0 });
  }
  function extractGaps(options) {
    return {
      inner: options?.gapInner ?? 8,
      outer: options?.gapOuter ?? 10
    };
  }
  var Layouts = {
    applyGaps(rect, gapInner, gapOuter, isLeft = true, isRight = true, isTop = true, isBottom = true) {
      return applyGaps(rect, { inner: gapInner, outer: gapOuter }, isLeft, isRight, isTop, isBottom);
    },
    masterStack(area, count, options) {
      if (count <= 0) return [];
      const ids = makeSyntheticIds(count);
      const gaps = extractGaps(options);
      const solution = solveMasterStack(area, ids, gaps, {
        masterRatio: options?.masterRatio,
        masterCount: options?.masterCount
      });
      return solutionToArray(solution, ids);
    },
    balancedGrid(area, count, options) {
      if (count <= 0) return [];
      const ids = makeSyntheticIds(count);
      const gaps = extractGaps(options);
      const solution = solveBalancedGrid(area, ids, gaps);
      return solutionToArray(solution, ids);
    },
    grid(area, count, options) {
      return this.balancedGrid(area, count, options);
    },
    binarySplit(area, count, options) {
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
    columns(area, count, options) {
      if (count <= 0) return [];
      const ids = makeSyntheticIds(count);
      const gaps = extractGaps(options);
      const solution = solveLayout("columns", area, ids, gaps);
      return solutionToArray(solution, ids);
    },
    rows(area, count, options) {
      if (count <= 0) return [];
      const ids = makeSyntheticIds(count);
      const gaps = extractGaps(options);
      const solution = solveLayout("rows", area, ids, gaps);
      return solutionToArray(solution, ids);
    },
    monocle(area, count, options) {
      if (count <= 0) return [];
      const ids = makeSyntheticIds(count);
      const gaps = extractGaps(options);
      const solution = solveLayout("monocle", area, ids, gaps);
      return solutionToArray(solution, ids);
    },
    supportedLayouts: ["master-stack", "bsp", "columns", "rows", "grid", "monocle", "floating"]
  };
  globalThis.Layouts = Layouts;
  return __toCommonJS(qml_compat_exports);
})();
var Layouts = LayoutsModule.Layouts;
