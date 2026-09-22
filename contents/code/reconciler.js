"use strict";
var ReconcilerModule = (() => {
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

  // apps/kwin-adapter/src/qml-reconciler-compat.ts
  var qml_reconciler_compat_exports = {};
  __export(qml_reconciler_compat_exports, {
    ReconcilerBridge: () => ReconcilerBridge,
    computeSnapZones: () => computeSnapZones,
    createCoordinator: () => createCoordinator,
    evaluateCommitGeometry: () => evaluateCommitGeometry,
    getOrCreateCoordinator: () => getOrCreateCoordinator,
    matchSnapZoneHover: () => matchSnapZoneHover,
    normalizeCommitGeometry: () => normalizeCommitGeometry,
    pointToRectDistance: () => pointToRectDistance,
    rectContainsPoint: () => rectContainsPoint,
    rectIntersectionArea: () => rectIntersectionArea,
    resolveCursorTargetScreen: () => resolveCursorTargetScreen,
    resolveScreenAffinity: () => resolveScreenAffinity,
    toNormalizedScreen: () => toNormalizedScreen,
    toNormalizedWindow: () => toNormalizedWindow
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
  function solvePrimaryStack(area, windows, gaps, options) {
    const result = /* @__PURE__ */ new Map();
    const count = windows.length;
    if (count === 0) return result;
    const ratio = options?.primaryRegionRatio !== void 0 ? options.primaryRegionRatio : options?.masterRatio !== void 0 ? options.masterRatio : 0.5;
    const regionCount = Math.max(
      0,
      options?.primaryRegionCount !== void 0 ? options.primaryRegionCount : options?.masterCount !== void 0 ? options.masterCount : 1
    );
    if (count === 1) {
      result.set(windows[0], applyGaps(area, gaps, true, true, true, true));
      return result;
    }
    if (regionCount === 0) {
      return solveBalancedGrid(area, windows, gaps);
    }
    if (count === 2) {
      const halfW = Math.floor(area.width / 2);
      result.set(windows[0], applyGaps({ x: area.x, y: area.y, width: halfW, height: area.height }, gaps, true, false, true, true));
      result.set(windows[1], applyGaps({ x: area.x + halfW, y: area.y, width: area.width - halfW, height: area.height }, gaps, false, true, true, true));
      return result;
    }
    const actualPrimary = Math.min(count, regionCount);
    const stackCount = count - actualPrimary;
    if (stackCount === 0) {
      const colWidth = Math.floor(area.width / actualPrimary);
      for (let c = 0; c < actualPrimary; c++) {
        const cx = area.x + c * colWidth;
        const cw = c === actualPrimary - 1 ? area.width - c * colWidth : colWidth;
        result.set(windows[c], applyGaps({ x: cx, y: area.y, width: cw, height: area.height }, gaps, c === 0, c === actualPrimary - 1, true, true));
      }
      return result;
    }
    const primaryWidth = Math.floor(area.width * ratio);
    const stackWidth = area.width - primaryWidth;
    const primaryHeight = Math.floor(area.height / actualPrimary);
    let curY = area.y;
    for (let m = 0; m < actualPrimary; m++) {
      const mh = m === actualPrimary - 1 ? area.height - (curY - area.y) : primaryHeight;
      result.set(windows[m], applyGaps({ x: area.x, y: curY, width: primaryWidth, height: mh }, gaps, true, false, m === 0, m === actualPrimary - 1));
      curY += mh;
    }
    const stackHeight = Math.floor(area.height / stackCount);
    curY = area.y;
    for (let s = 0; s < stackCount; s++) {
      const sh = s === stackCount - 1 ? area.height - (curY - area.y) : stackHeight;
      result.set(windows[actualPrimary + s], applyGaps({ x: area.x + primaryWidth, y: curY, width: stackWidth, height: sh }, gaps, false, true, s === 0, s === stackCount - 1));
      curY += sh;
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
      case "primary-stack":
      case "master-stack":
        return solvePrimaryStack(area, windows, gaps, options);
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

  // apps/kwin-adapter/src/coordinator-types.ts
  var SystemClock = class {
    now() {
      return Date.now();
    }
  };
  var DEFAULT_GEOMETRY_TOLERANCE_PX = 1;
  var DEFAULT_ECHO_EXPIRY_MS = 500;
  function rectEqualsWithTolerance(a, b, tolerance = DEFAULT_GEOMETRY_TOLERANCE_PX) {
    return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance && Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance;
  }
  var GLOBAL_DESKTOP_SCOPE = "\0tessera-global";
  function getWorkspaceScopeKey(outputId, desktopId = "1") {
    return `${encodeURIComponent(outputId)}//${encodeURIComponent(desktopId)}`;
  }

  // packages/rules-engine/src/rules.ts
  function normalizeAction(action) {
    const a = (action || "").toLowerCase().trim();
    if (a === "tile" || a === "tiled") return "tiled";
    if (a === "float" || a === "floating") return "floating";
    if (a === "dialog") return "dialog";
    if (a === "fullscreen") return "fullscreen";
    if (a === "fullscreen-like") return "fullscreen-like";
    if (a === "ignored" || a === "ignore") return "ignored";
    return "tiled";
  }
  function isGameIdentity(input, customGamePatterns = []) {
    const rClass = (input.resourceClass || input.windowClass || "").toLowerCase();
    const rName = (input.resourceName || "").toLowerCase();
    const appId = (input.appId || "").toLowerCase();
    const desktopFile = (input.desktopFileName || "").toLowerCase();
    const isOrdinarySteam = rClass === "steam" && !rName.startsWith("steam_app") && !desktopFile.includes("steam_app") || rClass === "steamwebhelper" || rName === "steamwebhelper" || appId === "steamwebhelper";
    if (isOrdinarySteam) {
      return { isGame: false };
    }
    if (rClass.startsWith("steam_app_") || rClass.includes("steam_app_") || rName.startsWith("steam_app_") || rName.includes("steam_app_") || appId.startsWith("steam_app_") || appId.includes("steam_app_") || desktopFile.includes("steam_app_")) {
      return { isGame: true, matchedPattern: "steam_app_*" };
    }
    if (rClass.includes("gamescope") || rName.includes("gamescope") || appId.includes("gamescope")) {
      return { isGame: true, matchedPattern: "gamescope" };
    }
    for (const pat of customGamePatterns) {
      const p = pat.toLowerCase().trim();
      if (p.length > 0 && (rClass.includes(p) || rName.includes(p) || appId.includes(p) || desktopFile.includes(p))) {
        return { isGame: true, matchedPattern: pat };
      }
    }
    return { isGame: false };
  }
  function isFullscreenLike(input) {
    if (input.fullScreen === true) return false;
    if (input.noBorder !== true) return false;
    const maxMode = input.maximizeMode ?? 0;
    if (maxMode !== 0) return false;
    const frame = input.frameGeometry;
    const out = input.outputGeometry ?? input.outputUsableArea;
    if (!frame || !out) return false;
    const frameArea = frame.width * frame.height;
    const outArea = out.width * out.height;
    if (outArea <= 0 || frameArea <= 0) return false;
    const coverageRatio = frameArea / outArea;
    const coversAlmostAll = coverageRatio >= 0.98;
    const xDiff = Math.abs(frame.x - out.x);
    const yDiff = Math.abs(frame.y - out.y);
    const wDiff = Math.abs(frame.width - out.width);
    const hDiff = Math.abs(frame.height - out.height);
    const withinTolerance = xDiff <= 5 && yDiff <= 5 && wDiff <= 5 && hDiff <= 5;
    return coversAlmostAll || withinTolerance;
  }
  var WindowRuleEngine = class _WindowRuleEngine {
    userFilterTokens = [];
    customRules = [];
    gameWindowPolicy = "floating";
    customGamePatterns = [];
    /**
     * Only Tessera Control Center itself floats by default so user can configure the system.
     */
    static DEFAULT_FLOAT_PATTERNS = Object.freeze([
      "tessera",
      "tessera-settings",
      "tessera_settings.py"
    ]);
    constructor(options = {}) {
      this.updateOptions(options);
    }
    updateOptions(options) {
      if (options.userFilterString !== void 0) {
        this.userFilterTokens = options.userFilterString.split(",").map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
      } else if (options.userFilterPatterns !== void 0) {
        this.userFilterTokens = options.userFilterPatterns.flatMap((p) => p.split(",")).map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
      }
      if (options.customRules !== void 0) {
        this.customRules = [...options.customRules];
      }
      if (options.gameWindowPolicy !== void 0) {
        this.gameWindowPolicy = options.gameWindowPolicy;
      }
      if (options.customGamePatterns !== void 0) {
        this.customGamePatterns = [...options.customGamePatterns];
      }
    }
    /**
     * Determine if a window surface should be completely ignored by the window manager.
     */
    isIgnored(window) {
      const res = this.classify(window);
      return res.classification === "ignored";
    }
    /**
     * Determine if a window should float by default.
     */
    shouldFloat(window) {
      const res = this.classify(window);
      return res.classification === "floating" || res.classification === "fullscreen" || res.classification === "fullscreen-like";
    }
    /**
     * Single authoritative classification entrypoint.
     *
     * Precedence order:
     * 1. Unmanaged / non-normal system surfaces -> "ignored" (source: "runtime")
     * 2. True fullscreen (fullScreen === true) -> "fullscreen" (source: "runtime", cannot be overridden by user tile rule)
     * 3. Explicit user rules (custom rules / user filter) -> "user-rule"
     * 4. Fullscreen-like borderless state -> "fullscreen-like" (source: "runtime")
     * 5. Default game recognition -> follows gameWindowPolicy (source: "default-rule")
     * 6. Dialog / transient -> "dialog" (source: "runtime")
     * 7. Default float patterns (Tessera Control Center) -> "floating" (source: "default-rule")
     * 8. Default fallback -> "tiled" (source: "fallback")
     */
    classify(window) {
      const input = window;
      const isManaged = input.managed !== void 0 ? input.managed : input.isManaged !== void 0 ? input.isManaged : true;
      if (!isManaged) {
        return {
          classification: "ignored",
          reason: "Window is not managed by KWin",
          source: "runtime"
        };
      }
      const isNormal = input.normalWindow !== void 0 ? input.normalWindow : input.isNormal !== void 0 ? input.isNormal : true;
      if (!isNormal || input.desktopWindow || input.dock || input.splash || input.notification || input.onScreenDisplay || input.popupMenu || input.tooltip || input.specialWindow) {
        return {
          classification: "ignored",
          reason: "Surface is a non-normal system surface or transient popup",
          source: "runtime"
        };
      }
      if (input.fullScreen === true) {
        return {
          classification: "fullscreen",
          reason: "Window is in true fullscreen state",
          source: "runtime"
        };
      }
      const rClass = (input.resourceClass || input.windowClass || "").toLowerCase();
      const rName = (input.resourceName || "").toLowerCase();
      const appId = (input.appId || "").toLowerCase();
      const desktopFile = (input.desktopFileName || "").toLowerCase();
      const title = (input.caption || input.title || "").toLowerCase();
      const role = (input.windowRole || input.role || "").toLowerCase();
      for (const rule of this.customRules) {
        let target = "";
        switch (rule.matchType) {
          case "class":
            target = rClass || rName || appId || desktopFile;
            break;
          case "app":
            target = appId || rClass;
            break;
          case "title":
            target = title;
            break;
          case "role":
            target = role;
            break;
        }
        let matched = false;
        if (rule.isRegex) {
          try {
            const re = new RegExp(rule.pattern, "i");
            matched = re.test(target);
          } catch {
            matched = target.includes(rule.pattern.toLowerCase());
          }
        } else {
          matched = target.includes(rule.pattern.toLowerCase());
        }
        if (matched) {
          const normalized = normalizeAction(rule.action);
          return {
            classification: normalized,
            reason: `Matched user custom rule (${rule.pattern})`,
            source: "user-rule",
            matchedRuleId: rule.id,
            matchedPattern: rule.pattern
          };
        }
      }
      for (const token of this.userFilterTokens) {
        if (rClass && rClass.includes(token) || rName && rName.includes(token) || appId && appId.includes(token) || title && title.includes(token) || desktopFile && desktopFile.includes(token)) {
          return {
            classification: "floating",
            reason: `Matched user filter token (${token})`,
            source: "user-rule",
            matchedPattern: token
          };
        }
      }
      if (isFullscreenLike(input)) {
        return {
          classification: "fullscreen-like",
          reason: "Window is borderless and occupies physical display area",
          source: "runtime"
        };
      }
      const gameCheck = isGameIdentity(input, this.customGamePatterns);
      if (gameCheck.isGame) {
        return {
          classification: this.gameWindowPolicy,
          reason: `Identified game window; applying game window policy (${this.gameWindowPolicy})`,
          source: "default-rule",
          matchedPattern: gameCheck.matchedPattern
        };
      }
      for (const pat of _WindowRuleEngine.DEFAULT_FLOAT_PATTERNS) {
        if (rClass.includes(pat) || rName.includes(pat) || appId.includes(pat) || title.includes(pat)) {
          return {
            classification: "floating",
            reason: `Matched default float pattern (${pat})`,
            source: "default-rule",
            matchedPattern: pat
          };
        }
      }
      return {
        classification: "tiled",
        reason: "Default tiling fallback",
        source: "fallback"
      };
    }
  };
  var WindowClassificationTracker = class {
    classifications = /* @__PURE__ */ new Map();
    tileability = /* @__PURE__ */ new Map();
    evaluate(windowId, result) {
      const prevClassification = this.classifications.get(windowId);
      const prevTileable = this.tileability.get(windowId);
      const isTileable = result.classification === "tiled";
      this.classifications.set(windowId, result.classification);
      this.tileability.set(windowId, isTileable);
      const changed = prevTileable !== void 0 && prevTileable !== isTileable || prevClassification !== void 0 && prevClassification !== result.classification;
      return {
        changed,
        isTileable,
        classification: result.classification,
        previousClassification: prevClassification,
        result
      };
    }
    forget(windowId) {
      this.classifications.delete(windowId);
      this.tileability.delete(windowId);
    }
    getClassification(windowId) {
      return this.classifications.get(windowId);
    }
    isTileable(windowId) {
      return this.tileability.get(windowId);
    }
    clear() {
      this.classifications.clear();
      this.tileability.clear();
    }
  };

  // apps/kwin-adapter/src/qml-rules-compat.ts
  function toWindowRuleInput(w, options) {
    if (!w) return { managed: false };
    return {
      windowId: w.internalId ? String(w.internalId) : w.windowId || "",
      resourceClass: w.resourceClass ? String(w.resourceClass) : w.windowClass ? String(w.windowClass) : "",
      resourceName: w.resourceName ? String(w.resourceName) : "",
      appId: w.appId ? String(w.appId) : "",
      desktopFileName: w.desktopFileName ? String(w.desktopFileName) : "",
      title: w.caption ? String(w.caption) : w.title ? String(w.title) : "",
      caption: w.caption ? String(w.caption) : w.title ? String(w.title) : "",
      windowRole: w.windowRole ? String(w.windowRole) : w.role ? String(w.role) : "",
      role: w.windowRole ? String(w.windowRole) : w.role ? String(w.role) : "",
      managed: w.managed !== void 0 ? Boolean(w.managed) : w.isManaged !== void 0 ? Boolean(w.isManaged) : true,
      normalWindow: w.normalWindow !== void 0 ? Boolean(w.normalWindow) : w.isNormal !== void 0 ? Boolean(w.isNormal) : true,
      dialog: Boolean(w.dialog),
      transient: Boolean(w.transient),
      fullScreen: Boolean(w.fullScreen),
      noBorder: Boolean(w.noBorder),
      maximizeMode: typeof w.maximizeMode === "number" ? w.maximizeMode : 0,
      minimized: Boolean(w.minimized),
      frameGeometry: w.frameGeometry ? {
        x: Number(w.frameGeometry.x || 0),
        y: Number(w.frameGeometry.y || 0),
        width: Number(w.frameGeometry.width || 0),
        height: Number(w.frameGeometry.height || 0)
      } : void 0,
      outputGeometry: options?.outputGeometry || (w.output?.geometry ? {
        x: Number(w.output.geometry.x || 0),
        y: Number(w.output.geometry.y || 0),
        width: Number(w.output.geometry.width || 0),
        height: Number(w.output.geometry.height || 0)
      } : void 0),
      outputUsableArea: options?.outputUsableArea,
      desktopWindow: Boolean(w.desktopWindow),
      dock: Boolean(w.dock),
      splash: Boolean(w.splash),
      notification: Boolean(w.notification),
      onScreenDisplay: Boolean(w.onScreenDisplay),
      popupMenu: Boolean(w.popupMenu),
      tooltip: Boolean(w.tooltip),
      specialWindow: Boolean(w.specialWindow)
    };
  }
  function parseCustomRules(rules) {
    if (!rules) return [];
    if (Array.isArray(rules)) return rules;
    if (typeof rules === "string") {
      try {
        const parsed = JSON.parse(rules);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return [];
      }
    }
    return [];
  }
  var cachedEngine = null;
  var cachedSignature = "";
  var tracker = new WindowClassificationTracker();
  function computeConfigSignature(options) {
    if (!options) return "default";
    const customRulesStr = typeof options.customRules === "string" ? options.customRules : JSON.stringify(options.customRules || []);
    const filterStr = options.userFilterString || (options.userFilterPatterns ? options.userFilterPatterns.join(",") : "");
    const policyStr = options.gameWindowPolicy || "floating";
    const gamePatsStr = options.customGamePatterns ? options.customGamePatterns.join(",") : "";
    return `${policyStr}|${filterStr}|${customRulesStr}|${gamePatsStr}`;
  }
  function getOrCreateRuleEngine(options) {
    const sig = computeConfigSignature(options);
    if (!cachedEngine || cachedSignature !== sig) {
      const parsedRules = parseCustomRules(options?.customRules);
      const filterPatterns = options?.userFilterPatterns || (options?.userFilterString ? [options.userFilterString] : []);
      cachedEngine = new WindowRuleEngine({
        customRules: parsedRules,
        userFilterPatterns: filterPatterns,
        gameWindowPolicy: options?.gameWindowPolicy || "floating",
        customGamePatterns: options?.customGamePatterns
      });
      cachedSignature = sig;
    }
    return cachedEngine;
  }
  var RuleEngine = {
    classify(w, options) {
      const engine = getOrCreateRuleEngine(options);
      const input = toWindowRuleInput(w, options);
      return engine.classify(input);
    },
    evaluate(w, options) {
      const input = toWindowRuleInput(w, options);
      const engine = getOrCreateRuleEngine(options);
      const result = engine.classify(input);
      const wid = input.windowId || (w?.internalId ? String(w.internalId) : "unknown");
      return tracker.evaluate(wid, result);
    },
    forget(w) {
      const wid = typeof w === "string" ? w : w?.internalId ? String(w.internalId) : w?.windowId || "";
      if (wid) {
        tracker.forget(wid);
      }
    },
    shouldFloat(w, userFilterString, customRulesJson, gameWindowPolicy) {
      const result = this.classify(w, {
        userFilterString,
        customRules: customRulesJson,
        gameWindowPolicy: gameWindowPolicy || "floating"
      });
      return result.classification === "floating" || result.classification === "fullscreen" || result.classification === "fullscreen-like";
    },
    isIgnored(w) {
      const result = this.classify(w);
      return result.classification === "ignored";
    },
    defaultFloatPatterns: WindowRuleEngine.DEFAULT_FLOAT_PATTERNS,
    getCachedSignature() {
      return cachedSignature;
    },
    clearCache() {
      cachedEngine = null;
      cachedSignature = "";
      tracker.clear();
    },
    tracker
  };
  globalThis.RuleEngine = RuleEngine;

  // apps/kwin-adapter/src/screen-affinity.ts
  function pointToRectDistance(px, py, r) {
    const dx = Math.max(r.x - px, 0, px - (r.x + r.width));
    const dy = Math.max(r.y - py, 0, py - (r.y + r.height));
    return Math.hypot(dx, dy);
  }
  function rectIntersectionArea(a, b) {
    const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return xOverlap * yOverlap;
  }
  function rectContainsPoint(r, px, py) {
    return px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height;
  }
  function resolveScreenAffinity(inputs) {
    const screens = inputs.screens;
    if (!screens || screens.length === 0) {
      return inputs.explicitOutputId || inputs.previousOutputId || "default";
    }
    const screenMap = /* @__PURE__ */ new Map();
    for (const s of screens) {
      screenMap.set(s.outputId, s);
    }
    if (inputs.explicitOutputId && screenMap.has(inputs.explicitOutputId)) {
      return inputs.explicitOutputId;
    }
    const geom = inputs.frameGeometry;
    const hasGeom = Boolean(geom && geom.width > 0 && geom.height > 0);
    if (hasGeom && geom) {
      const cx = geom.x + geom.width / 2;
      const cy = geom.y + geom.height / 2;
      const centerMatches = [];
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
        centerMatches.sort((a, b) => a.outputId.localeCompare(b.outputId));
        return centerMatches[0].outputId;
      }
    }
    if (hasGeom && geom) {
      let maxArea = 0;
      let maxCandidates = [];
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
    if (inputs.previousOutputId && screenMap.has(inputs.previousOutputId)) {
      return inputs.previousOutputId;
    }
    if (inputs.cursorPoint) {
      const px = inputs.cursorPoint.x;
      const py = inputs.cursorPoint.y;
      const cursorMatches = [];
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
    let nearestCandidates = [];
    for (const s of screens) {
      const dist = pointToRectDistance(refX, refY, s.geometry);
      if (dist < minDistance - 1e-6) {
        minDistance = dist;
        nearestCandidates = [s];
      } else if (Math.abs(dist - minDistance) <= 1e-6) {
        nearestCandidates.push(s);
      }
    }
    if (nearestCandidates.length > 0) {
      nearestCandidates.sort((a, b) => a.outputId.localeCompare(b.outputId));
      return nearestCandidates[0].outputId;
    }
    return screens[0].outputId;
  }
  function resolveCursorTargetScreen(screens, cursorPoint, fallbackOutputId) {
    if (!screens || screens.length === 0) {
      return {
        outputId: fallbackOutputId || "default",
        geometry: { x: 0, y: 0, width: 1920, height: 1080 },
        usableArea: { x: 0, y: 0, width: 1920, height: 1080 }
      };
    }
    const containing = [];
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
    let minDistance = Infinity;
    let candidates = [];
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

  // apps/kwin-adapter/src/trace-recorder.ts
  var TraceRecorder = class {
    enabled;
    maxCapacity;
    recordTitles;
    redactAppIds;
    redactResourceClass;
    sequence = 0;
    buffer = [];
    constructor(options) {
      this.enabled = Boolean(options?.enabled);
      this.maxCapacity = Math.max(1, options?.maxCapacity ?? 1e3);
      this.recordTitles = Boolean(options?.recordTitles);
      this.redactAppIds = Boolean(options?.redactAppIds);
      this.redactResourceClass = Boolean(options?.redactResourceClass);
    }
    isEnabled() {
      return this.enabled;
    }
    setEnabled(enabled) {
      this.enabled = enabled;
    }
    clear() {
      this.buffer.length = 0;
      this.sequence = 0;
    }
    getRecordedEvents() {
      return [...this.buffer];
    }
    getEntries() {
      return [...this.buffer];
    }
    getCapacity() {
      return this.maxCapacity;
    }
    setCapacity(capacity) {
      this.maxCapacity = Math.max(1, capacity);
      while (this.buffer.length > this.maxCapacity) {
        this.buffer.shift();
      }
    }
    sanitizeWindowInput(win) {
      const copy = { ...win };
      if (!this.recordTitles) {
        delete copy.title;
      }
      if (this.redactAppIds && copy.appId) {
        copy.appId = "[REDACTED]";
      }
      if (this.redactResourceClass && copy.resourceClass) {
        copy.resourceClass = "[REDACTED]";
      }
      return copy;
    }
    sanitizeEvent(event) {
      if (event.type === "WindowDiscovered") {
        return {
          type: "WindowDiscovered",
          window: this.sanitizeWindowInput(event.window)
        };
      }
      if (event.type === "WindowStateChanged") {
        const updates = { ...event.updates };
        if (!this.recordTitles) {
          delete updates.title;
        }
        if (this.redactAppIds && updates.appId) {
          updates.appId = "[REDACTED]";
        }
        if (this.redactResourceClass && updates.resourceClass) {
          updates.resourceClass = "[REDACTED]";
        }
        return {
          type: "WindowStateChanged",
          windowId: event.windowId,
          updates
        };
      }
      return event;
    }
    recordEvent(event, timestamp) {
      if (!this.enabled) return;
      if (this.buffer.length >= this.maxCapacity) {
        this.buffer.shift();
      }
      this.buffer.push({
        sequence: ++this.sequence,
        timestamp,
        event: this.sanitizeEvent(event)
      });
    }
  };

  // apps/kwin-adapter/src/runtime-coordinator.ts
  var WORKSPACE_LAYOUT_VERSION = 1;
  var WORKSPACE_LAYOUT_MAX_ENTRIES = 50;
  var WORKSPACE_LAYOUT_MAX_BYTES = 65536;
  var VALID_WORKSPACE_LAYOUTS = /* @__PURE__ */ new Set([
    "balanced-grid",
    "primary-stack",
    "binary-split",
    "columns",
    "rows",
    "monocle",
    "floating"
  ]);
  var UNSAFE_SCOPE_PARTS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
  var RuntimeCoordinator = class {
    windows = /* @__PURE__ */ new Map();
    screens = /* @__PURE__ */ new Map();
    workspaces = /* @__PURE__ */ new Map();
    inFlightEchoes = /* @__PURE__ */ new Map();
    dirtyScreenIds = /* @__PURE__ */ new Set();
    pendingReasons = /* @__PURE__ */ new Set();
    workspaceLayoutOverrides = /* @__PURE__ */ new Map();
    clock;
    traceRecorder;
    config;
    currentEpoch = 0;
    // Diagnostics counters
    totalNormalizedEvents = 0;
    totalReconciliationTransactions = 0;
    totalLayoutComputations = 0;
    totalGeometryWrites = 0;
    skippedIdenticalWrites = 0;
    suppressedGeometryEchoes = 0;
    lastTransactionReasons = [];
    lastAffectedScreenIds = [];
    workspaceLayoutConfigError = null;
    constructor(initialConfig, clock = new SystemClock(), traceRecorder = new TraceRecorder()) {
      this.clock = clock;
      this.traceRecorder = traceRecorder;
      const effRatio = initialConfig?.primaryRegionRatio !== void 0 ? initialConfig.primaryRegionRatio : initialConfig?.masterRatio ?? 0.5;
      const effCount = initialConfig?.primaryRegionCount !== void 0 ? initialConfig.primaryRegionCount : initialConfig?.masterCount ?? 1;
      this.config = {
        enableTiling: initialConfig?.enableTiling ?? true,
        defaultLayout: initialConfig?.defaultLayout ?? "balanced-grid",
        gapInner: initialConfig?.gapInner ?? 8,
        gapOuter: initialConfig?.gapOuter ?? 10,
        primaryRegionRatio: effRatio,
        primaryRegionCount: effCount,
        masterRatio: effRatio,
        masterCount: effCount,
        perDesktopLayout: initialConfig?.perDesktopLayout ?? true,
        ignoreMinimized: initialConfig?.ignoreMinimized ?? true,
        gameWindowPolicy: initialConfig?.gameWindowPolicy ?? "floating",
        floatFilter: initialConfig?.floatFilter ?? "tessera,tessera-settings,tessera_settings.py",
        customRules: initialConfig?.customRules ?? "[]",
        workspaceLayoutsJson: initialConfig?.workspaceLayoutsJson ?? '{"version":1,"scopes":{}}',
        customGamePatterns: initialConfig?.customGamePatterns ?? [],
        geometryTolerancePx: initialConfig?.geometryTolerancePx ?? DEFAULT_GEOMETRY_TOLERANCE_PX,
        echoExpiryMs: initialConfig?.echoExpiryMs ?? DEFAULT_ECHO_EXPIRY_MS
      };
      this.loadWorkspaceLayoutsJson(initialConfig?.workspaceLayoutsJson);
    }
    getConfig() {
      return { ...this.config };
    }
    updateConfig(updates) {
      const previousPerDesktopLayout = this.config.perDesktopLayout;
      const effRatio = updates.primaryRegionRatio !== void 0 ? updates.primaryRegionRatio : updates.masterRatio !== void 0 ? updates.masterRatio : this.config.masterRatio;
      const effCount = updates.primaryRegionCount !== void 0 ? updates.primaryRegionCount : updates.masterCount !== void 0 ? updates.masterCount : this.config.masterCount;
      this.config = {
        ...this.config,
        ...updates,
        primaryRegionRatio: effRatio,
        primaryRegionCount: effCount,
        masterRatio: effRatio,
        masterCount: effCount
      };
      if (previousPerDesktopLayout !== this.config.perDesktopLayout) {
        this.rebuildWorkspaceMemberships();
      }
      if (updates.workspaceLayoutsJson !== void 0) {
        this.loadWorkspaceLayoutsJson(updates.workspaceLayoutsJson);
      }
      this.invalidateAllScreens("GlobalConfigChanged");
    }
    getWorkspaceScopeKey(outputId, desktopId = "1") {
      return getWorkspaceScopeKey(outputId, desktopId);
    }
    getEffectiveDesktopId(desktopId = "1") {
      if (this.config.perDesktopLayout === false) {
        return GLOBAL_DESKTOP_SCOPE;
      }
      return desktopId;
    }
    getRetainedWindow(id) {
      return this.windows.get(id);
    }
    getRetainedWindows() {
      return Array.from(this.windows.values());
    }
    getRetainedScreen(outputId) {
      return this.screens.get(outputId);
    }
    getRetainedScreens() {
      return Array.from(this.screens.values());
    }
    getOrCreateWorkspace(outputId, desktopId = "1") {
      const effDeskId = this.getEffectiveDesktopId(desktopId);
      const key = getWorkspaceScopeKey(outputId, effDeskId);
      let ws = this.workspaces.get(key);
      if (!ws) {
        const override = this.workspaceLayoutOverrides.get(key) || this.workspaceLayoutOverrides.get(getWorkspaceScopeKey("*", effDeskId));
        ws = {
          scopeKey: key,
          outputId,
          desktopId: effDeskId,
          activeLayout: override?.layout || this.config.defaultLayout,
          primaryRegionCount: override?.primaryCount ?? this.config.primaryRegionCount ?? this.config.masterCount,
          primaryRegionRatio: override?.ratio ?? this.config.primaryRegionRatio ?? this.config.masterRatio,
          gaps: { inner: this.config.gapInner, outer: this.config.gapOuter },
          orderedSlotWindowIds: []
        };
        this.workspaces.set(key, ws);
      }
      return ws;
    }
    getWorkspaceLayoutConfigError() {
      return this.workspaceLayoutConfigError;
    }
    loadWorkspaceLayoutsJson(serialized) {
      this.workspaceLayoutOverrides.clear();
      this.workspaceLayoutConfigError = null;
      if (serialized === void 0) {
        this.config.workspaceLayoutsJson = '{"version":1,"scopes":{}}';
        this.applyWorkspaceLayoutOverrides();
        return true;
      }
      const effectiveSerialized = serialized;
      try {
        if (this.utf8ByteLength(effectiveSerialized) > WORKSPACE_LAYOUT_MAX_BYTES) {
          throw new Error("workspace layout configuration exceeds 64 KiB");
        }
        this.assertNoDuplicateJsonKeys(effectiveSerialized);
        const parsed = JSON.parse(effectiveSerialized);
        let scopes;
        let requireCanonicalEncoding = true;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && !Object.prototype.hasOwnProperty.call(parsed, "version") && !Object.prototype.hasOwnProperty.call(parsed, "scopes")) {
          scopes = parsed;
          requireCanonicalEncoding = false;
        } else {
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("workspace layout configuration must be an object");
          }
          if (parsed.version !== WORKSPACE_LAYOUT_VERSION) {
            throw new Error(`unsupported workspace layout version '${String(parsed.version)}'`);
          }
          if (!parsed.scopes || typeof parsed.scopes !== "object" || Array.isArray(parsed.scopes)) {
            throw new Error("workspace layout scopes must be an object");
          }
          if (Object.keys(parsed).some((key) => key !== "version" && key !== "scopes")) {
            throw new Error("workspace layout root contains unknown fields");
          }
          scopes = parsed.scopes;
        }
        const scopeKeys = Object.keys(scopes);
        if (scopeKeys.length > WORKSPACE_LAYOUT_MAX_ENTRIES) {
          throw new Error("workspace layout configuration exceeds 50 scopes");
        }
        const canonicalScopes = {};
        for (const scopeKey of scopeKeys) {
          const parts = scopeKey.split("//");
          if (parts.length !== 2 || !parts[0] || !parts[1]) {
            throw new Error(`invalid workspace scope '${scopeKey}'`);
          }
          const outputId = decodeURIComponent(parts[0]);
          const desktopId = decodeURIComponent(parts[1]);
          if (UNSAFE_SCOPE_PARTS.has(outputId) || UNSAFE_SCOPE_PARTS.has(desktopId)) {
            throw new Error(`unsafe workspace scope '${scopeKey}'`);
          }
          const canonicalKey = getWorkspaceScopeKey(outputId, desktopId);
          if (canonicalKey !== scopeKey) {
            throw new Error(`non-canonical workspace scope '${scopeKey}'`);
          }
          const raw = scopes[scopeKey];
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error(`workspace scope '${scopeKey}' must be an object`);
          }
          if (Object.keys(raw).some((key) => !["layout", "ratio", "primaryCount"].includes(key))) {
            throw new Error(`workspace scope '${scopeKey}' contains unknown fields`);
          }
          const override = {};
          if (raw.layout !== void 0) {
            const layout = raw.layout === "master-stack" ? "primary-stack" : raw.layout;
            if (typeof layout !== "string" || !VALID_WORKSPACE_LAYOUTS.has(layout)) {
              throw new Error(`invalid layout in workspace scope '${scopeKey}'`);
            }
            override.layout = layout;
          }
          if (raw.ratio !== void 0) {
            if (typeof raw.ratio !== "number" || !Number.isFinite(raw.ratio) || raw.ratio < 0.1 || raw.ratio > 0.9) {
              throw new Error(`invalid ratio in workspace scope '${scopeKey}'`);
            }
            override.ratio = raw.ratio;
          }
          if (raw.primaryCount !== void 0) {
            if (!Number.isInteger(raw.primaryCount) || raw.primaryCount < 0 || raw.primaryCount > 10) {
              throw new Error(`invalid primaryCount in workspace scope '${scopeKey}'`);
            }
            override.primaryCount = raw.primaryCount;
          }
          canonicalScopes[canonicalKey] = override;
        }
        const canonical = this.canonicalWorkspaceLayoutJson(canonicalScopes);
        if (requireCanonicalEncoding) {
          if (canonical !== effectiveSerialized) {
            throw new Error("workspace layout configuration is not canonically serialized");
          }
        }
        this.config.workspaceLayoutsJson = canonical;
        for (const key of Object.keys(canonicalScopes).sort()) {
          this.workspaceLayoutOverrides.set(key, canonicalScopes[key]);
        }
        this.applyWorkspaceLayoutOverrides();
        return true;
      } catch (error) {
        this.workspaceLayoutConfigError = error instanceof Error ? error.message : String(error);
        this.config.workspaceLayoutsJson = '{"version":1,"scopes":{}}';
        this.applyWorkspaceLayoutOverrides();
        return false;
      }
    }
    canonicalWorkspaceLayoutJson(scopes) {
      const orderedScopes = {};
      for (const key of Object.keys(scopes).sort()) {
        const value = scopes[key];
        const orderedValue = {};
        if (value.layout !== void 0) orderedValue.layout = value.layout;
        if (value.ratio !== void 0) orderedValue.ratio = value.ratio;
        if (value.primaryCount !== void 0) orderedValue.primaryCount = value.primaryCount;
        orderedScopes[key] = orderedValue;
      }
      return JSON.stringify({ version: WORKSPACE_LAYOUT_VERSION, scopes: orderedScopes });
    }
    utf8ByteLength(value) {
      let bytes = 0;
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 128) bytes += 1;
        else if (code < 2048) bytes += 2;
        else if (code >= 55296 && code <= 56319 && i + 1 < value.length && value.charCodeAt(i + 1) >= 56320 && value.charCodeAt(i + 1) <= 57343) {
          bytes += 4;
          i++;
        } else bytes += 3;
      }
      return bytes;
    }
    assertNoDuplicateJsonKeys(serialized) {
      let offset = 0;
      const skipWhitespace = () => {
        while (offset < serialized.length && /\s/.test(serialized[offset])) offset++;
      };
      const parseString = () => {
        const start = offset;
        if (serialized[offset] !== '"') throw new Error("invalid JSON string");
        offset++;
        let escaped = false;
        while (offset < serialized.length) {
          const char = serialized[offset++];
          if (escaped) {
            escaped = false;
          } else if (char === "\\") {
            escaped = true;
          } else if (char === '"') {
            return JSON.parse(serialized.slice(start, offset));
          }
        }
        throw new Error("unterminated JSON string");
      };
      const parseValue = () => {
        skipWhitespace();
        if (serialized[offset] === "{") {
          parseObject();
        } else if (serialized[offset] === "[") {
          offset++;
          skipWhitespace();
          if (serialized[offset] === "]") {
            offset++;
            return;
          }
          while (offset < serialized.length) {
            parseValue();
            skipWhitespace();
            if (serialized[offset] === "]") {
              offset++;
              return;
            }
            if (serialized[offset] !== ",") throw new Error("invalid JSON array");
            offset++;
          }
        } else if (serialized[offset] === '"') {
          parseString();
        } else {
          const start = offset;
          while (offset < serialized.length && !/[\s,\]}]/.test(serialized[offset])) offset++;
          if (offset === start) throw new Error("invalid JSON value");
        }
      };
      const parseObject = () => {
        const keys = /* @__PURE__ */ new Set();
        offset++;
        skipWhitespace();
        if (serialized[offset] === "}") {
          offset++;
          return;
        }
        while (offset < serialized.length) {
          skipWhitespace();
          const key = parseString();
          if (keys.has(key)) throw new Error(`duplicate JSON key '${key}'`);
          keys.add(key);
          skipWhitespace();
          if (serialized[offset] !== ":") throw new Error("invalid JSON object");
          offset++;
          parseValue();
          skipWhitespace();
          if (serialized[offset] === "}") {
            offset++;
            return;
          }
          if (serialized[offset] !== ",") throw new Error("invalid JSON object");
          offset++;
        }
      };
      parseValue();
      skipWhitespace();
      if (offset !== serialized.length) throw new Error("trailing JSON content");
    }
    applyWorkspaceLayoutOverrides() {
      for (const ws of this.workspaces.values()) {
        const override = this.workspaceLayoutOverrides.get(ws.scopeKey) || this.workspaceLayoutOverrides.get(getWorkspaceScopeKey("*", ws.desktopId));
        ws.activeLayout = override?.layout || this.config.defaultLayout;
        ws.primaryRegionCount = override?.primaryCount ?? this.config.primaryRegionCount ?? this.config.masterCount;
        ws.primaryRegionRatio = override?.ratio ?? this.config.primaryRegionRatio ?? this.config.masterRatio;
      }
    }
    getWorkspace(outputId, desktopId = "1") {
      const effDeskId = this.getEffectiveDesktopId(desktopId);
      return this.workspaces.get(getWorkspaceScopeKey(outputId, effDeskId));
    }
    getOrCreateScreen(input) {
      let screen = this.screens.get(input.outputId);
      const activeDesktopId = input.activeDesktopId || "1";
      this.getOrCreateWorkspace(input.outputId, activeDesktopId);
      if (!screen) {
        const self = this;
        const newScreen = {
          outputId: input.outputId,
          name: input.name || input.outputId,
          geometry: { ...input.geometry },
          usableArea: { ...input.usableArea },
          activeDesktopId,
          activeActivityId: input.activeActivityId,
          get activeLayout() {
            return self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).activeLayout;
          },
          set activeLayout(l) {
            self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).activeLayout = l;
          },
          get masterCount() {
            return self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionCount;
          },
          set masterCount(c) {
            self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionCount = c;
          },
          get masterRatio() {
            return self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionRatio;
          },
          set masterRatio(r) {
            self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionRatio = r;
          },
          get primaryRegionCount() {
            return self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionCount;
          },
          set primaryRegionCount(c) {
            self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionCount = c;
          },
          get primaryRegionRatio() {
            return self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionRatio;
          },
          set primaryRegionRatio(r) {
            self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionRatio = r;
          },
          get gaps() {
            return self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).gaps;
          },
          set gaps(g) {
            self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).gaps = g;
          },
          _orderedWindowIds: [],
          get orderedWindowIds() {
            return this._orderedWindowIds || [];
          },
          set orderedWindowIds(wids) {
            this._orderedWindowIds = wids;
          },
          get persistentOrder() {
            return self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).orderedSlotWindowIds;
          },
          set persistentOrder(wids) {
            self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).orderedSlotWindowIds = wids;
          },
          dirtyReasons: /* @__PURE__ */ new Set(),
          latestCommittedEpoch: 0
        };
        this.screens.set(input.outputId, newScreen);
        screen = newScreen;
      } else {
        if (input.name) screen.name = input.name;
        screen.geometry = { ...input.geometry };
        screen.usableArea = { ...input.usableArea };
        if (input.activeDesktopId) screen.activeDesktopId = input.activeDesktopId;
        screen.activeActivityId = input.activeActivityId;
      }
      return screen;
    }
    markScreenDirty(outputId, reason) {
      const screen = this.screens.get(outputId);
      if (screen) {
        screen.dirtyReasons.add(reason);
        this.dirtyScreenIds.add(outputId);
      }
      this.pendingReasons.add(reason);
    }
    invalidateAllScreens(reason) {
      for (const screen of this.screens.values()) {
        screen.dirtyReasons.add(reason);
        this.dirtyScreenIds.add(screen.outputId);
      }
      this.pendingReasons.add(reason);
    }
    removeWindowFromOutputWorkspaces(windowId, outputId) {
      for (const ws of this.workspaces.values()) {
        if (ws.outputId !== outputId) continue;
        let idx = ws.orderedSlotWindowIds.indexOf(windowId);
        while (idx !== -1) {
          ws.orderedSlotWindowIds.splice(idx, 1);
          idx = ws.orderedSlotWindowIds.indexOf(windowId);
        }
      }
    }
    addWindowToApplicableWorkspaces(win, outputId = win.outputId, activeDesktopId) {
      const desktopIds = win.desktopIds.length > 0 ? win.desktopIds : [win.desktopId || "1"];
      let targets;
      if (this.config.perDesktopLayout === false) {
        targets = [GLOBAL_DESKTOP_SCOPE];
      } else if (win.onAllDesktops) {
        const screen = this.screens.get(outputId);
        targets = [activeDesktopId || screen?.activeDesktopId || win.desktopId || "1"];
      } else {
        targets = [...new Set(desktopIds)];
      }
      for (const desktopId of targets) {
        const ws = this.getOrCreateWorkspace(outputId, desktopId);
        if (!ws.orderedSlotWindowIds.includes(win.id)) {
          ws.orderedSlotWindowIds.push(win.id);
        }
      }
    }
    rebuildWorkspaceMemberships() {
      for (const ws of this.workspaces.values()) {
        ws.orderedSlotWindowIds = [];
      }
      for (const win of this.windows.values()) {
        this.addWindowToApplicableWorkspaces(win);
      }
    }
    classifyWindow(input, screen) {
      const ruleInput = {
        windowId: input.id,
        resourceClass: input.resourceClass,
        resourceName: input.resourceName,
        appId: input.appId,
        desktopFileName: input.desktopFileName,
        title: input.title,
        caption: input.title,
        windowRole: input.role,
        role: input.role,
        managed: input.managed !== void 0 ? input.managed : true,
        normalWindow: input.normalWindow !== void 0 ? input.normalWindow : true,
        dialog: Boolean(input.dialog),
        transient: Boolean(input.transient),
        fullScreen: Boolean(input.fullScreen),
        noBorder: Boolean(input.noBorder),
        maximizeMode: input.maximizeMode ?? 0,
        minimized: Boolean(input.minimized),
        frameGeometry: input.frameGeometry,
        outputGeometry: input.outputGeometry || screen?.geometry,
        outputUsableArea: input.outputUsableArea || screen?.usableArea,
        desktopWindow: Boolean(input.desktopWindow),
        dock: Boolean(input.dock),
        splash: Boolean(input.splash),
        notification: Boolean(input.notification),
        onScreenDisplay: Boolean(input.onScreenDisplay),
        popupMenu: Boolean(input.popupMenu),
        tooltip: Boolean(input.tooltip),
        specialWindow: Boolean(input.specialWindow)
      };
      const engine = getOrCreateRuleEngine({
        gameWindowPolicy: this.config.gameWindowPolicy,
        userFilterString: this.config.floatFilter,
        customRules: this.config.customRules,
        customGamePatterns: this.config.customGamePatterns
      });
      return engine.classify(ruleInput);
    }
    /**
     * Primary event ingestion entrypoint. Normalizes and updates state.
     */
    ingestEvent(event) {
      this.totalNormalizedEvents++;
      this.traceRecorder.recordEvent(event, this.clock.now());
      switch (event.type) {
        case "WindowDiscovered": {
          const winInput = event.window;
          let outputId = winInput.outputId || "default";
          const desktopId = winInput.desktopId || "1";
          if (!this.screens.has(outputId) && this.screens.size > 0) {
            const screensList = Array.from(this.screens.values()).map((s) => ({
              outputId: s.outputId,
              name: s.name,
              geometry: s.geometry,
              usableArea: s.usableArea
            }));
            outputId = resolveScreenAffinity({
              explicitOutputId: winInput.outputId,
              frameGeometry: winInput.frameGeometry,
              previousOutputId: winInput.outputAffinity,
              screens: screensList
            });
          }
          const screen = this.screens.get(outputId);
          const classification = this.classifyWindow(winInput, screen);
          const tileable = classification.classification === "tiled";
          const geom = winInput.frameGeometry || { x: 0, y: 0, width: 800, height: 600 };
          const deskIds = winInput.desktopIds && winInput.desktopIds.length > 0 ? winInput.desktopIds : [desktopId];
          const isSticky = Boolean(winInput.onAllDesktops);
          const activities = winInput.activities && winInput.activities.length > 0 ? [...winInput.activities] : winInput.activityId ? [winInput.activityId] : [];
          const retained = {
            id: winInput.id,
            resourceClass: winInput.resourceClass || "",
            resourceName: winInput.resourceName || "",
            appId: winInput.appId || "",
            desktopFileName: winInput.desktopFileName || "",
            title: winInput.title || "",
            role: winInput.role || "",
            outputId,
            desktopId,
            desktopIds: [...deskIds],
            onAllDesktops: isSticky,
            activityId: winInput.activityId || (activities[0] || void 0),
            activities,
            minimized: Boolean(winInput.minimized),
            fullScreen: Boolean(winInput.fullScreen),
            noBorder: Boolean(winInput.noBorder),
            maximizeMode: winInput.maximizeMode ?? 0,
            frameGeometry: { ...geom },
            outputGeometry: winInput.outputGeometry,
            classification: classification.classification,
            tileable,
            isManualFloating: Boolean(winInput.isManualFloating),
            isDragging: Boolean(winInput.isDragging),
            lastObservedGeometry: { ...geom },
            lastRequestedGeometry: null,
            lastAppliedTransactionEpoch: 0,
            currentDesiredTiledGeometry: null,
            preMinimizeGeometry: null,
            isPreTiled: Boolean(winInput.isPreTiled),
            outputAffinity: winInput.outputAffinity || outputId
          };
          this.windows.set(winInput.id, retained);
          this.addWindowToApplicableWorkspaces(retained, outputId);
          this.markScreenDirty(outputId, "WindowDiscovered");
          return { dirty: true, affectedScreens: [outputId], isEcho: false };
        }
        case "WindowRemoved": {
          const retained = this.windows.get(event.windowId);
          const outputId = retained ? retained.outputId : void 0;
          this.windows.delete(event.windowId);
          this.inFlightEchoes.delete(event.windowId);
          const affected = [];
          for (const ws of this.workspaces.values()) {
            const idx = ws.orderedSlotWindowIds.indexOf(event.windowId);
            if (idx !== -1) {
              ws.orderedSlotWindowIds.splice(idx, 1);
              if (!affected.includes(ws.outputId)) {
                this.markScreenDirty(ws.outputId, "WindowRemoved");
                affected.push(ws.outputId);
              }
            }
          }
          if (outputId && !affected.includes(outputId)) {
            this.markScreenDirty(outputId, "WindowRemoved");
            affected.push(outputId);
          }
          this.pendingReasons.add("WindowRemoved");
          return { dirty: affected.length > 0, affectedScreens: affected, isEcho: false };
        }
        case "WindowGeometryChanged": {
          const echoCheck = this.checkAndHandleEcho(event.windowId, event.geometry, event.timestamp);
          if (echoCheck.isEcho) {
            return { dirty: false, affectedScreens: [], isEcho: true };
          }
          const win = this.windows.get(event.windowId);
          if (!win) {
            return { dirty: false, affectedScreens: [], isEcho: false };
          }
          win.lastObservedGeometry = { ...event.geometry };
          win.frameGeometry = { ...event.geometry };
          const screen = this.screens.get(win.outputId);
          const prevTileable = win.tileable;
          const prevClass = win.classification;
          const newClassResult = this.classifyWindow({
            id: win.id,
            resourceClass: win.resourceClass,
            title: win.title,
            noBorder: win.noBorder,
            maximizeMode: win.maximizeMode,
            fullScreen: win.fullScreen,
            minimized: win.minimized,
            frameGeometry: event.geometry,
            outputGeometry: screen?.geometry,
            outputUsableArea: screen?.usableArea
          }, screen);
          win.classification = newClassResult.classification;
          win.tileable = newClassResult.classification === "tiled";
          if (prevTileable !== win.tileable || prevClass !== win.classification) {
            this.markScreenDirty(win.outputId, "TileabilityChanged");
            return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
          }
          this.markScreenDirty(win.outputId, "WindowGeometryChanged");
          return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
        }
        case "WindowStateChanged": {
          const win = this.windows.get(event.windowId);
          if (!win) return { dirty: false, affectedScreens: [], isEcho: false };
          const prevTileable = win.tileable;
          const prevClass = win.classification;
          const prevManualFloating = win.isManualFloating;
          const prevMinimized = win.minimized;
          const prevFullScreen = win.fullScreen;
          const prevMaximizeMode = win.maximizeMode;
          let membershipChanged = false;
          if (event.updates.resourceClass !== void 0) win.resourceClass = event.updates.resourceClass;
          if (event.updates.resourceName !== void 0) win.resourceName = event.updates.resourceName;
          if (event.updates.appId !== void 0) win.appId = event.updates.appId;
          if (event.updates.desktopFileName !== void 0) win.desktopFileName = event.updates.desktopFileName;
          if (event.updates.title !== void 0) win.title = event.updates.title;
          if (event.updates.role !== void 0) win.role = event.updates.role;
          if (event.updates.frameGeometry !== void 0) {
            win.frameGeometry = { ...event.updates.frameGeometry };
            win.lastObservedGeometry = { ...event.updates.frameGeometry };
          }
          if (event.updates.minimized !== void 0) {
            if (event.updates.minimized && !win.minimized) {
              win.preMinimizeGeometry = { ...win.frameGeometry };
            }
            win.minimized = event.updates.minimized;
          }
          if (event.updates.fullScreen !== void 0) {
            win.fullScreen = event.updates.fullScreen;
          }
          if (event.updates.noBorder !== void 0) {
            win.noBorder = event.updates.noBorder;
          }
          if (event.updates.maximizeMode !== void 0) {
            win.maximizeMode = event.updates.maximizeMode;
          }
          if (event.updates.isManualFloating !== void 0) {
            win.isManualFloating = event.updates.isManualFloating;
          }
          if (event.updates.isDragging !== void 0) {
            win.isDragging = event.updates.isDragging;
          }
          if (event.updates.isPreTiled !== void 0) {
            win.isPreTiled = event.updates.isPreTiled;
          }
          if (event.updates.outputAffinity !== void 0) {
            win.outputAffinity = event.updates.outputAffinity;
          }
          if (event.updates.onAllDesktops !== void 0 && event.updates.onAllDesktops !== win.onAllDesktops) {
            win.onAllDesktops = event.updates.onAllDesktops;
            membershipChanged = true;
          }
          if (event.updates.desktopIds !== void 0) {
            const nextDesktopIds = [...event.updates.desktopIds];
            if (nextDesktopIds.length !== win.desktopIds.length || nextDesktopIds.some((id) => !win.desktopIds.includes(id))) {
              membershipChanged = true;
            }
            win.desktopIds = nextDesktopIds;
            if (nextDesktopIds.length > 0) win.desktopId = nextDesktopIds[0];
          }
          if (event.updates.activities !== void 0) {
            const nextActivities = [...event.updates.activities];
            win.activities = nextActivities;
            win.activityId = nextActivities[0];
          }
          if (membershipChanged) {
            this.removeWindowFromOutputWorkspaces(win.id, win.outputId);
            this.addWindowToApplicableWorkspaces(win);
          }
          const screen = this.screens.get(win.outputId);
          const newClassResult = this.classifyWindow({
            id: win.id,
            resourceClass: win.resourceClass,
            resourceName: win.resourceName,
            appId: win.appId,
            desktopFileName: win.desktopFileName,
            title: win.title,
            role: win.role,
            noBorder: win.noBorder,
            maximizeMode: win.maximizeMode,
            fullScreen: win.fullScreen,
            minimized: win.minimized,
            frameGeometry: win.frameGeometry,
            outputGeometry: screen?.geometry,
            outputUsableArea: screen?.usableArea
          }, screen);
          win.classification = newClassResult.classification;
          win.tileable = newClassResult.classification === "tiled";
          const layoutAffectingStateChanged = prevTileable !== win.tileable || prevClass !== win.classification || prevManualFloating !== win.isManualFloating || prevMinimized !== win.minimized || prevFullScreen !== win.fullScreen || prevMaximizeMode !== win.maximizeMode || membershipChanged;
          if (layoutAffectingStateChanged) {
            const reason = win.fullScreen ? "WindowFullscreenEntered" : !win.fullScreen && prevClass === "fullscreen" ? "WindowFullscreenExited" : "WindowStateChanged";
            this.markScreenDirty(win.outputId, reason);
            return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
          }
          return { dirty: false, affectedScreens: [], isEcho: false };
        }
        case "WindowMovedOutput": {
          const win = this.windows.get(event.windowId);
          if (win) {
            win.outputId = event.toOutputId;
            win.outputAffinity = event.toOutputId;
          }
          this.removeWindowFromOutputWorkspaces(event.windowId, event.fromOutputId);
          const oldScreen = this.screens.get(event.fromOutputId);
          if (oldScreen) {
            oldScreen.dirtyReasons.add("WindowMovedOutputSource");
            this.dirtyScreenIds.add(oldScreen.outputId);
          }
          if (win) this.addWindowToApplicableWorkspaces(win, event.toOutputId);
          const newScreen = this.screens.get(event.toOutputId);
          if (newScreen) {
            newScreen.dirtyReasons.add("WindowMovedOutputTarget");
            this.dirtyScreenIds.add(newScreen.outputId);
          }
          this.pendingReasons.add("WindowMovedOutput");
          return { dirty: true, affectedScreens: [event.fromOutputId, event.toOutputId], isEcho: false };
        }
        case "WindowMovedDesktop": {
          const win = this.windows.get(event.windowId);
          if (win) {
            const newDeskId = event.toDesktopId;
            win.desktopId = newDeskId;
            win.desktopIds = [newDeskId];
            win.onAllDesktops = false;
            this.removeWindowFromOutputWorkspaces(event.windowId, win.outputId);
            this.addWindowToApplicableWorkspaces(win);
            this.markScreenDirty(win.outputId, "WindowMovedDesktop");
            return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
          }
          return { dirty: false, affectedScreens: [], isEcho: false };
        }
        case "WindowDesktopsChanged": {
          const win = this.windows.get(event.windowId);
          if (!win) return { dirty: false, affectedScreens: [], isEcho: false };
          const newDesks = [...event.desktopIds];
          const newSticky = event.onAllDesktops !== void 0 ? Boolean(event.onAllDesktops) : win.onAllDesktops;
          const unchanged = newSticky === win.onAllDesktops && newDesks.length === win.desktopIds.length && newDesks.every((id) => win.desktopIds.includes(id));
          if (unchanged) return { dirty: false, affectedScreens: [], isEcho: false };
          win.desktopIds = newDesks;
          win.onAllDesktops = newSticky;
          if (newDesks.length > 0) {
            win.desktopId = newDesks[0];
          }
          const activeDesktopId = this.screens.get(win.outputId)?.activeDesktopId || win.desktopId;
          for (const ws of this.workspaces.values()) {
            if (ws.outputId !== win.outputId) continue;
            const inMembership = this.config.perDesktopLayout === false ? ws.desktopId === GLOBAL_DESKTOP_SCOPE : newSticky ? ws.desktopId === activeDesktopId : newDesks.includes(ws.desktopId);
            const idx = ws.orderedSlotWindowIds.indexOf(event.windowId);
            if (inMembership && idx === -1) {
              ws.orderedSlotWindowIds.push(event.windowId);
            } else if (!inMembership && idx !== -1) {
              ws.orderedSlotWindowIds.splice(idx, 1);
            }
          }
          this.addWindowToApplicableWorkspaces(win, win.outputId, activeDesktopId);
          this.markScreenDirty(win.outputId, "WindowDesktopsChanged");
          return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
        }
        case "WindowActivitiesChanged": {
          const win = this.windows.get(event.windowId);
          if (!win) return { dirty: false, affectedScreens: [], isEcho: false };
          const unchanged = event.activities.length === win.activities.length && event.activities.every((id) => win.activities.includes(id));
          if (unchanged) return { dirty: false, affectedScreens: [], isEcho: false };
          win.activities = [...event.activities];
          win.activityId = event.activities.length > 0 ? event.activities[0] : void 0;
          this.markScreenDirty(win.outputId, "WindowActivitiesChanged");
          return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
        }
        case "ScreenDesktopChanged": {
          const screen = this.screens.get(event.outputId);
          if (screen) {
            if (screen.activeDesktopId === event.toDesktopId) {
              return { dirty: false, affectedScreens: [], isEcho: false };
            }
            screen.activeDesktopId = event.toDesktopId;
            for (const win of this.windows.values()) {
              if (win.outputId === event.outputId && win.onAllDesktops) {
                this.removeWindowFromOutputWorkspaces(win.id, event.outputId);
                this.addWindowToApplicableWorkspaces(win, event.outputId, event.toDesktopId);
              }
            }
            this.markScreenDirty(event.outputId, "ScreenDesktopChanged");
            return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
          }
          return { dirty: false, affectedScreens: [], isEcho: false };
        }
        case "ScreenTopologyChanged": {
          const seenIds = /* @__PURE__ */ new Set();
          const affectedIds = /* @__PURE__ */ new Set();
          for (const s of event.screens) {
            seenIds.add(s.outputId);
            const existing = this.screens.get(s.outputId);
            const changed = !existing || existing.name !== (s.name || s.outputId) || !rectEqualsWithTolerance(existing.geometry, s.geometry, 0) || !rectEqualsWithTolerance(existing.usableArea, s.usableArea, 0) || existing.activeDesktopId !== (s.activeDesktopId || "1") || existing.activeActivityId !== s.activeActivityId;
            this.getOrCreateScreen(s);
            if (changed) affectedIds.add(s.outputId);
          }
          for (const win of this.windows.values()) {
            if (win.onAllDesktops && affectedIds.has(win.outputId)) {
              this.removeWindowFromOutputWorkspaces(win.id, win.outputId);
              this.addWindowToApplicableWorkspaces(win);
            }
          }
          for (const existingId of this.screens.keys()) {
            if (!seenIds.has(existingId)) {
              affectedIds.add(existingId);
              this.screens.delete(existingId);
              this.dirtyScreenIds.delete(existingId);
            }
          }
          const remainingScreens = Array.from(this.screens.values()).map((s) => ({
            outputId: s.outputId,
            name: s.name,
            geometry: s.geometry,
            usableArea: s.usableArea
          }));
          if (remainingScreens.length > 0) {
            for (const win of this.windows.values()) {
              if (!this.screens.has(win.outputId)) {
                const oldOutputId = win.outputId;
                const newOutputId = resolveScreenAffinity({
                  explicitOutputId: void 0,
                  frameGeometry: win.frameGeometry,
                  previousOutputId: win.outputAffinity,
                  screens: remainingScreens
                });
                this.removeWindowFromOutputWorkspaces(win.id, oldOutputId);
                win.outputId = newOutputId;
                win.outputAffinity = newOutputId;
                this.addWindowToApplicableWorkspaces(win, newOutputId);
                affectedIds.add(newOutputId);
              }
            }
          }
          for (const [key, ws] of this.workspaces.entries()) {
            if (!seenIds.has(ws.outputId)) this.workspaces.delete(key);
          }
          const liveAffectedIds = Array.from(affectedIds).filter((id) => this.screens.has(id));
          for (const outputId of liveAffectedIds) {
            this.markScreenDirty(outputId, "ScreenTopologyChanged");
          }
          if (affectedIds.size > 0) this.pendingReasons.add("ScreenTopologyChanged");
          return {
            dirty: affectedIds.size > 0,
            affectedScreens: Array.from(affectedIds),
            isEcho: false
          };
        }
        case "ScreenLayoutChanged": {
          const screen = this.screens.get(event.outputId);
          const deskId = event.desktopId || (screen ? screen.activeDesktopId : "1");
          const ws = this.getOrCreateWorkspace(event.outputId, deskId);
          ws.activeLayout = event.layout;
          this.markScreenDirty(event.outputId, "ScreenLayoutChanged");
          return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
        }
        case "WorkspaceLayoutChanged": {
          const ws = this.getOrCreateWorkspace(event.outputId, event.desktopId);
          ws.activeLayout = event.layout;
          this.markScreenDirty(event.outputId, "WorkspaceLayoutChanged");
          return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
        }
        case "ScreenMasterConfigChanged": {
          const screen = this.screens.get(event.outputId);
          const deskId = event.desktopId || (screen ? screen.activeDesktopId : "1");
          const ws = this.getOrCreateWorkspace(event.outputId, deskId);
          if (event.count !== void 0) ws.primaryRegionCount = Math.max(0, event.count);
          if (event.ratio !== void 0) ws.primaryRegionRatio = Math.max(0.1, Math.min(0.9, event.ratio));
          this.markScreenDirty(event.outputId, "ScreenMasterConfigChanged");
          return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
        }
        case "WorkspacePrimaryConfigChanged": {
          const ws = this.getOrCreateWorkspace(event.outputId, event.desktopId);
          if (event.count !== void 0) ws.primaryRegionCount = Math.max(0, event.count);
          if (event.ratio !== void 0) ws.primaryRegionRatio = Math.max(0.1, Math.min(0.9, event.ratio));
          this.markScreenDirty(event.outputId, "WorkspacePrimaryConfigChanged");
          return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
        }
        case "ScreenGapsChanged": {
          const screen = this.screens.get(event.outputId);
          const deskId = event.desktopId || (screen ? screen.activeDesktopId : "1");
          const ws = this.getOrCreateWorkspace(event.outputId, deskId);
          ws.gaps = { ...event.gaps };
          this.markScreenDirty(event.outputId, "ScreenGapsChanged");
          return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
        }
        case "WorkspaceGapsChanged": {
          const ws = this.getOrCreateWorkspace(event.outputId, event.desktopId);
          ws.gaps = { ...event.gaps };
          this.markScreenDirty(event.outputId, "WorkspaceGapsChanged");
          return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
        }
        case "GlobalConfigChanged": {
          this.updateConfig(event.config);
          return { dirty: true, affectedScreens: Array.from(this.screens.keys()), isEcho: false };
        }
        case "WindowSnapCommitted": {
          const win = this.windows.get(event.windowId);
          if (!win) return { dirty: false, affectedScreens: [], isEcho: false };
          const targetScreen = this.screens.get(event.outputId);
          const oldOutputId = win.outputId;
          const isCrossOutput = oldOutputId !== event.outputId;
          const targetDesktopId = win.onAllDesktops ? targetScreen?.activeDesktopId || win.desktopId || "1" : event.desktopId || win.desktopId || "1";
          if (isCrossOutput) {
            this.removeWindowFromOutputWorkspaces(event.windowId, oldOutputId);
          }
          const currentDesktops = win.desktopIds.length > 0 ? win.desktopIds : win.desktopId ? [win.desktopId] : ["1"];
          const isExplicitNewDesktop = Boolean(!win.onAllDesktops && event.desktopId && !currentDesktops.includes(event.desktopId));
          if (isExplicitNewDesktop) {
            this.removeWindowFromOutputWorkspaces(event.windowId, event.outputId);
            win.desktopId = event.desktopId;
            win.desktopIds = [event.desktopId];
          } else if (!win.onAllDesktops && event.desktopId) {
            win.desktopId = event.desktopId;
          } else if (win.onAllDesktops) {
            this.removeWindowFromOutputWorkspaces(event.windowId, event.outputId);
          }
          win.outputId = event.outputId;
          win.outputAffinity = event.outputId;
          win.isDragging = false;
          win.isManualFloating = false;
          win.tileable = true;
          win.classification = "tiled";
          win.currentDesiredTiledGeometry = { ...event.targetRect };
          this.setSavedTiledGeometry(event.windowId, event.targetRect);
          this.addWindowToApplicableWorkspaces(win, event.outputId, targetDesktopId);
          const targetWs = this.getOrCreateWorkspace(event.outputId, targetDesktopId);
          let curIdx = targetWs.orderedSlotWindowIds.indexOf(event.windowId);
          while (curIdx !== -1) {
            targetWs.orderedSlotWindowIds.splice(curIdx, 1);
            curIdx = targetWs.orderedSlotWindowIds.indexOf(event.windowId);
          }
          const boundedSlot = event.slotIndex !== void 0 && event.slotIndex >= 0 ? Math.min(event.slotIndex, targetWs.orderedSlotWindowIds.length) : targetWs.orderedSlotWindowIds.length;
          targetWs.orderedSlotWindowIds.splice(boundedSlot, 0, event.windowId);
          this.markScreenDirty(event.outputId, "WindowSnapCommitted");
          const affected = [event.outputId];
          if (isCrossOutput && oldOutputId) {
            this.markScreenDirty(oldOutputId, "WindowSnapCommittedSource");
            affected.push(oldOutputId);
          }
          return { dirty: true, affectedScreens: affected, isEcho: false };
        }
      }
    }
    /**
     * Geometry echo detection and suppression.
     */
    checkAndHandleEcho(windowId, newGeometry, timestamp = this.clock.now()) {
      const entry = this.inFlightEchoes.get(windowId);
      if (!entry) return { isEcho: false };
      const elapsed = timestamp - entry.timestamp;
      const maxAge = this.config.echoExpiryMs ?? DEFAULT_ECHO_EXPIRY_MS;
      if (elapsed > maxAge) {
        this.inFlightEchoes.delete(windowId);
        return { isEcho: false };
      }
      const tolerance = this.config.geometryTolerancePx ?? DEFAULT_GEOMETRY_TOLERANCE_PX;
      if (rectEqualsWithTolerance(entry.target, newGeometry, tolerance)) {
        this.inFlightEchoes.delete(windowId);
        this.suppressedGeometryEchoes++;
        const win = this.windows.get(windowId);
        if (win) {
          win.lastObservedGeometry = { ...newGeometry };
          win.frameGeometry = { ...newGeometry };
        }
        return { isEcho: true };
      }
      return { isEcho: false };
    }
    /**
     * Records a programmatic geometry assignment to filter its subsequent echo.
     */
    recordCommand(windowId, target, epoch) {
      this.inFlightEchoes.set(windowId, {
        target: { ...target },
        epoch,
        timestamp: this.clock.now()
      });
    }
    /**
     * Clears an in-flight command record if the programmatic geometry assignment failed or was rolled back.
     */
    clearRecordedCommand(windowId) {
      this.inFlightEchoes.delete(windowId);
    }
    /**
     * Determines tileable windows for a screen according to scoped workspace slot persistence.
     */
    getTileableWindowsForScreen(screen) {
      const desktopId = screen.activeDesktopId || "1";
      const ws = this.getOrCreateWorkspace(screen.outputId, desktopId);
      const candidateWins = [];
      for (const win of this.windows.values()) {
        if (win.outputId !== screen.outputId) continue;
        const belongsToDesktop = this.config.perDesktopLayout === false || win.onAllDesktops || (win.desktopIds && win.desktopIds.length > 0 ? win.desktopIds.includes(desktopId) : win.desktopId === desktopId);
        if (!belongsToDesktop) continue;
        const belongsToActivity = !screen.activeActivityId || win.activities.length === 0 || win.activities.includes(screen.activeActivityId);
        if (!belongsToActivity) continue;
        if (!win.tileable) continue;
        if (win.isManualFloating) continue;
        if (this.config.ignoreMinimized && win.minimized) continue;
        if (win.fullScreen) continue;
        if (win.maximizeMode !== 0) continue;
        candidateWins.push(win);
      }
      const ordered = [];
      const remaining = new Set(candidateWins);
      for (const wid of ws.orderedSlotWindowIds) {
        const match = candidateWins.find((w) => w.id === wid);
        if (match) {
          ordered.push(match);
          remaining.delete(match);
        }
      }
      for (const newWin of remaining) {
        ordered.push(newWin);
        if (!ws.orderedSlotWindowIds.includes(newWin.id)) {
          ws.orderedSlotWindowIds.push(newWin.id);
        }
      }
      screen.orderedWindowIds = ordered.map((w) => w.id);
      return ordered;
    }
    /**
     * Executes a coalesced reconciliation pass for dirty screens.
     */
    reconcile(forceScreenId) {
      if (!this.config.enableTiling) {
        this.dirtyScreenIds.clear();
        this.pendingReasons.clear();
        return null;
      }
      const screensToReconcile = [];
      if (forceScreenId) {
        const scr = this.screens.get(forceScreenId);
        if (scr) screensToReconcile.push(scr);
      } else {
        for (const scrId of this.dirtyScreenIds) {
          const scr = this.screens.get(scrId);
          if (scr) screensToReconcile.push(scr);
        }
      }
      if (screensToReconcile.length === 0) {
        return null;
      }
      const startTime = this.clock.now();
      const epoch = ++this.currentEpoch;
      const reasons = Array.from(this.pendingReasons);
      const affectedScreenIds = screensToReconcile.map((s) => s.outputId);
      const operations = [];
      let skippedWrites = 0;
      const tolerance = this.config.geometryTolerancePx ?? DEFAULT_GEOMETRY_TOLERANCE_PX;
      for (const screen of screensToReconcile) {
        if (screen.activeLayout === "floating") {
          screen.dirtyReasons.clear();
          this.dirtyScreenIds.delete(screen.outputId);
          continue;
        }
        const area = screen.usableArea;
        if (area.width <= 0 || area.height <= 0) continue;
        const tileableWindows = this.getTileableWindowsForScreen(screen);
        if (tileableWindows.length === 0) {
          screen.dirtyReasons.clear();
          this.dirtyScreenIds.delete(screen.outputId);
          continue;
        }
        this.totalLayoutComputations++;
        const ids = tileableWindows.map((w) => w.id);
        let solution = /* @__PURE__ */ new Map();
        switch (screen.activeLayout) {
          case "primary-stack":
          case "master-stack":
            solution = solvePrimaryStack(area, ids, screen.gaps, {
              primaryRegionRatio: screen.primaryRegionRatio,
              primaryRegionCount: screen.primaryRegionCount,
              masterRatio: screen.masterRatio,
              masterCount: screen.masterCount
            });
            break;
          case "balanced-grid":
          case "grid":
            solution = solveBalancedGrid(area, ids, screen.gaps);
            break;
          case "binary-split":
          case "bsp": {
            let root = null;
            for (const wid of ids) {
              root = insertWindow(root, wid);
            }
            solution = solveTree(root, area, screen.gaps);
            break;
          }
          case "columns":
            solution = solveLayout("columns", area, ids, screen.gaps);
            break;
          case "rows":
            solution = solveLayout("rows", area, ids, screen.gaps);
            break;
          case "monocle":
            solution = solveLayout("monocle", area, ids, screen.gaps);
            break;
          default:
            solution = solveBalancedGrid(area, ids, screen.gaps);
            break;
        }
        for (const win of tileableWindows) {
          if (win.isDragging) continue;
          const desiredRect = solution.get(win.id);
          if (!desiredRect) continue;
          win.currentDesiredTiledGeometry = { ...desiredRect };
          const observedRect = win.lastObservedGeometry;
          if (rectEqualsWithTolerance(desiredRect, observedRect, tolerance)) {
            skippedWrites++;
            this.skippedIdenticalWrites++;
          } else {
            operations.push({
              windowId: win.id,
              targetRect: { ...desiredRect },
              previousRect: { ...observedRect }
            });
            this.totalGeometryWrites++;
            win.lastRequestedGeometry = { ...desiredRect };
            win.lastAppliedTransactionEpoch = epoch;
          }
        }
        screen.latestCommittedEpoch = epoch;
        screen.dirtyReasons.clear();
        this.dirtyScreenIds.delete(screen.outputId);
      }
      this.pendingReasons.clear();
      this.totalReconciliationTransactions++;
      this.lastTransactionReasons = reasons;
      this.lastAffectedScreenIds = affectedScreenIds;
      const durationMs = this.clock.now() - startTime;
      return {
        epoch,
        reasons,
        affectedScreens: affectedScreenIds,
        operations,
        skippedWrites,
        durationMs
      };
    }
    /**
     * Commits a window into a prospective snap target geometry and screen slot.
     * Produces exactly 1 geometry operation if the window moves or resizes,
     * or skips the write (0 operations) if the window is already at targetRect.
     * Unaffected screens produce 0 writes.
     * Echo suppression is armed solely by the commit boundary when geometry is written.
     */
    applySnapCommit(windowId, outputId, targetRect, slotIndex) {
      this.ingestEvent({
        type: "WindowSnapCommitted",
        windowId,
        outputId,
        targetRect,
        slotIndex
      });
      const win = this.windows.get(windowId);
      if (!win) return null;
      const screen = this.screens.get(outputId);
      if (!screen) return null;
      const tolerance = this.config.geometryTolerancePx ?? DEFAULT_GEOMETRY_TOLERANCE_PX;
      const observedRect = win.lastObservedGeometry;
      if (rectEqualsWithTolerance(targetRect, observedRect, tolerance) || win.lastRequestedGeometry && rectEqualsWithTolerance(targetRect, win.lastRequestedGeometry, tolerance)) {
        this.skippedIdenticalWrites++;
        screen.dirtyReasons.clear();
        this.dirtyScreenIds.delete(outputId);
        return null;
      }
      const epoch = ++this.currentEpoch;
      const op = {
        windowId: win.id,
        targetRect: { ...targetRect },
        previousRect: { ...observedRect }
      };
      this.totalGeometryWrites++;
      win.lastRequestedGeometry = { ...targetRect };
      win.lastAppliedTransactionEpoch = epoch;
      screen.latestCommittedEpoch = epoch;
      screen.dirtyReasons.clear();
      this.dirtyScreenIds.delete(outputId);
      const tx = {
        epoch,
        reasons: ["SnapCommitted"],
        affectedScreens: [outputId],
        operations: [op],
        skippedWrites: 0
      };
      this.totalReconciliationTransactions++;
      this.lastTransactionReasons = ["SnapCommitted"];
      this.lastAffectedScreenIds = [outputId];
      return tx;
    }
    getSavedTiledGeometry(windowId) {
      const win = this.windows.get(windowId);
      return win?.currentDesiredTiledGeometry ? { ...win.currentDesiredTiledGeometry } : null;
    }
    setSavedTiledGeometry(windowId, rect) {
      const win = this.windows.get(windowId);
      if (win) {
        win.currentDesiredTiledGeometry = rect ? { ...rect } : null;
      }
    }
    getPreMinimizeGeometry(windowId) {
      const win = this.windows.get(windowId);
      return win?.preMinimizeGeometry ? { ...win.preMinimizeGeometry } : null;
    }
    setPreMinimizeGeometry(windowId, rect) {
      const win = this.windows.get(windowId);
      if (win) {
        win.preMinimizeGeometry = rect ? { ...rect } : null;
      }
    }
    isPreTiled(windowId) {
      return Boolean(this.windows.get(windowId)?.isPreTiled);
    }
    setPreTiled(windowId, val) {
      const win = this.windows.get(windowId);
      if (win) {
        win.isPreTiled = val;
      }
    }
    getOutputAffinity(windowId) {
      const win = this.windows.get(windowId);
      return win?.outputAffinity || win?.outputId;
    }
    setOutputAffinity(windowId, outputId) {
      const win = this.windows.get(windowId);
      if (win) {
        win.outputAffinity = outputId;
      }
    }
    handleMinimize(windowId, isMinimized, currentGeom) {
      const win = this.windows.get(windowId);
      if (win && isMinimized) {
        win.preMinimizeGeometry = currentGeom ? { ...currentGeom } : { ...win.frameGeometry };
      }
      return this.ingestEvent({
        type: "WindowStateChanged",
        windowId,
        updates: {
          minimized: isMinimized,
          ...currentGeom ? { frameGeometry: currentGeom } : {}
        }
      });
    }
    handleTopologyChange(screens) {
      this.ingestEvent({
        type: "ScreenTopologyChanged",
        screens
      });
      return this.reconcile();
    }
    getClock() {
      return this.clock;
    }
    getTraceRecorder() {
      return this.traceRecorder;
    }
    isManualFloating(windowId) {
      return Boolean(this.windows.get(windowId)?.isManualFloating);
    }
    setManualFloating(windowId, val) {
      return this.ingestEvent({
        type: "WindowStateChanged",
        windowId,
        updates: { isManualFloating: val }
      });
    }
    swapWindowOrder(outputId, forward, desktopId) {
      const screen = this.screens.get(outputId);
      const deskId = desktopId || (screen ? screen.activeDesktopId : "1");
      const ws = this.getOrCreateWorkspace(outputId, deskId);
      if (ws.orderedSlotWindowIds.length < 2) {
        return { dirty: false, affectedScreens: [], isEcho: false };
      }
      const order = [...ws.orderedSlotWindowIds];
      if (forward) {
        const first = order.shift();
        order.push(first);
      } else {
        const last = order.pop();
        order.unshift(last);
      }
      ws.orderedSlotWindowIds = order;
      this.markScreenDirty(outputId, "WindowOrderSwapped");
      return { dirty: true, affectedScreens: [outputId], isEcho: false };
    }
    moveWindowToSlot(windowId, targetSlotIndex) {
      const win = this.windows.get(windowId);
      if (!win) return { dirty: false, affectedScreens: [], isEcho: false };
      const ws = this.getOrCreateWorkspace(win.outputId, win.desktopId);
      const curIdx = ws.orderedSlotWindowIds.indexOf(windowId);
      if (curIdx === -1) return { dirty: false, affectedScreens: [], isEcho: false };
      ws.orderedSlotWindowIds.splice(curIdx, 1);
      const boundedSlot = Math.max(0, Math.min(targetSlotIndex, ws.orderedSlotWindowIds.length));
      ws.orderedSlotWindowIds.splice(boundedSlot, 0, windowId);
      this.markScreenDirty(win.outputId, "WindowSlotMoved");
      return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
    }
    moveWindowToFirstSlot(windowId) {
      return this.moveWindowToSlot(windowId, 0);
    }
    swapWindowSlots(windowIdA, windowIdB) {
      const winA = this.windows.get(windowIdA);
      const winB = this.windows.get(windowIdB);
      if (!winA || !winB || winA.outputId !== winB.outputId || winA.desktopId !== winB.desktopId) {
        return { dirty: false, affectedScreens: [], isEcho: false };
      }
      const ws = this.getOrCreateWorkspace(winA.outputId, winA.desktopId);
      const idxA = ws.orderedSlotWindowIds.indexOf(windowIdA);
      const idxB = ws.orderedSlotWindowIds.indexOf(windowIdB);
      if (idxA === -1 || idxB === -1) {
        return { dirty: false, affectedScreens: [], isEcho: false };
      }
      ws.orderedSlotWindowIds[idxA] = windowIdB;
      ws.orderedSlotWindowIds[idxB] = windowIdA;
      this.markScreenDirty(winA.outputId, "WindowSlotsSwapped");
      return { dirty: true, affectedScreens: [winA.outputId], isEcho: false };
    }
    getDiagnostics() {
      return {
        totalNormalizedEvents: this.totalNormalizedEvents,
        totalReconciliationTransactions: this.totalReconciliationTransactions,
        totalLayoutComputations: this.totalLayoutComputations,
        totalGeometryWrites: this.totalGeometryWrites,
        skippedIdenticalWrites: this.skippedIdenticalWrites,
        suppressedGeometryEchoes: this.suppressedGeometryEchoes,
        lastTransactionReasons: [...this.lastTransactionReasons],
        lastAffectedScreenIds: [...this.lastAffectedScreenIds],
        retainedWindowCount: this.windows.size,
        retainedScreenCount: this.screens.size
      };
    }
  };

  // apps/kwin-adapter/src/snap-zones.ts
  function computeSnapZones(area, gapOuter, gapInner) {
    const go = gapOuter;
    const gi = gapInner;
    const uw = area.width - go * 2;
    const uh = area.height - go * 2;
    const hw = Math.floor((uw - gi) / 2);
    const hh = Math.floor((uh - gi) / 2);
    const zones = [];
    const barW = Math.min(800, Math.floor(uw * 0.6));
    const barX = area.x + Math.floor((area.width - barW) / 2);
    zones.push({
      type: "maximize",
      id: "maximize",
      title: "Full Screen / Maximize",
      badge: "\u{1F5D6} Maximize",
      desc: "Full Working Area",
      slotIndex: -1,
      rect: { x: barX, y: area.y + 10, width: barW, height: 56 },
      targetRect: { x: area.x + go, y: area.y + go, width: uw, height: uh },
      triggerX: barX - 10,
      triggerY: area.y,
      triggerW: barW + 20,
      triggerH: 66
    });
    zones.push({
      type: "half",
      id: "left-half",
      title: "Left Half (Primary)",
      badge: "\u229E Left Split",
      desc: "50% Primary Pane",
      slotIndex: 0,
      rect: { x: area.x + go, y: area.y + go + 70, width: hw, height: uh - 70 },
      targetRect: { x: area.x + go, y: area.y + go, width: hw, height: uh },
      triggerX: area.x,
      triggerY: area.y + 80,
      triggerW: Math.floor(area.width / 2),
      triggerH: area.height - 80
    });
    zones.push({
      type: "half",
      id: "right-half",
      title: "Right Half (Stack)",
      badge: "\u25A5 Right Split",
      desc: "50% Secondary Pane",
      slotIndex: 1,
      rect: { x: area.x + go + hw + gi, y: area.y + go + 70, width: uw - hw - gi, height: uh - 70 },
      targetRect: { x: area.x + go + hw + gi, y: area.y + go, width: uw - hw - gi, height: uh },
      triggerX: area.x + Math.floor(area.width / 2),
      triggerY: area.y + 80,
      triggerW: Math.floor(area.width / 2),
      triggerH: area.height - 80
    });
    zones.push({
      type: "quarter",
      id: "top-left",
      title: "Top-Left Quarter",
      badge: "\u25E4 Top-Left",
      desc: "25% Quadrant",
      slotIndex: 0,
      rect: { x: area.x + go, y: area.y + go + 70, width: hw, height: Math.max(60, hh - 70) },
      targetRect: { x: area.x + go, y: area.y + go, width: hw, height: hh },
      triggerX: area.x,
      triggerY: area.y,
      triggerW: Math.floor(area.width * 0.22),
      triggerH: Math.floor(area.height * 0.32)
    });
    zones.push({
      type: "quarter",
      id: "bottom-left",
      title: "Bottom-Left Quarter",
      badge: "\u25E3 Bottom-Left",
      desc: "25% Quadrant",
      slotIndex: 3,
      rect: { x: area.x + go, y: area.y + go + hh + gi, width: hw, height: uh - hh - gi },
      targetRect: { x: area.x + go, y: area.y + go + hh + gi, width: hw, height: uh - hh - gi },
      triggerX: area.x,
      triggerY: area.y + Math.floor(area.height * 0.68),
      triggerW: Math.floor(area.width * 0.22),
      triggerH: Math.floor(area.height * 0.32)
    });
    zones.push({
      type: "quarter",
      id: "top-right",
      title: "Top-Right Quarter",
      badge: "\u25E5 Top-Right",
      desc: "25% Quadrant",
      slotIndex: 1,
      rect: { x: area.x + go + hw + gi, y: area.y + go + 70, width: uw - hw - gi, height: Math.max(60, hh - 70) },
      targetRect: { x: area.x + go + hw + gi, y: area.y + go, width: uw - hw - gi, height: hh },
      triggerX: area.x + Math.floor(area.width * 0.78),
      triggerY: area.y,
      triggerW: Math.floor(area.width * 0.22),
      triggerH: Math.floor(area.height * 0.32)
    });
    zones.push({
      type: "quarter",
      id: "bottom-right",
      title: "Bottom-Right Quarter",
      badge: "\u25E2 Bottom-Right",
      desc: "25% Quadrant",
      slotIndex: 2,
      rect: { x: area.x + go + hw + gi, y: area.y + go + hh + gi, width: uw - hw - gi, height: uh - hh - gi },
      targetRect: { x: area.x + go + hw + gi, y: area.y + go + hh + gi, width: uw - hw - gi, height: uh - hh - gi },
      triggerX: area.x + Math.floor(area.width * 0.78),
      triggerY: area.y + Math.floor(area.height * 0.68),
      triggerW: Math.floor(area.width * 0.22),
      triggerH: Math.floor(area.height * 0.32)
    });
    return zones;
  }
  function matchSnapZoneHover(zones, cursorPos) {
    if (!cursorPos || zones.length === 0) return -1;
    for (let i = 3; i < zones.length; i++) {
      const qz = zones[i];
      if (cursorPos.x >= qz.triggerX && cursorPos.x < qz.triggerX + qz.triggerW && cursorPos.y >= qz.triggerY && cursorPos.y < qz.triggerY + qz.triggerH) {
        return i;
      }
    }
    if (zones.length > 0) {
      const mz = zones[0];
      if (cursorPos.x >= mz.triggerX && cursorPos.x < mz.triggerX + mz.triggerW && cursorPos.y >= mz.triggerY && cursorPos.y < mz.triggerY + mz.triggerH) {
        return 0;
      }
    }
    if (zones.length > 1) {
      const lz = zones[1];
      if (cursorPos.x >= lz.triggerX && cursorPos.x < lz.triggerX + lz.triggerW && cursorPos.y >= lz.triggerY && cursorPos.y < lz.triggerY + lz.triggerH) {
        return 1;
      }
    }
    if (zones.length > 2) {
      const rz = zones[2];
      if (cursorPos.x >= rz.triggerX && cursorPos.x < rz.triggerX + rz.triggerW && cursorPos.y >= rz.triggerY && cursorPos.y < rz.triggerY + rz.triggerH) {
        return 2;
      }
    }
    return -1;
  }

  // apps/kwin-adapter/src/qml-reconciler-compat.ts
  function stableObjectId(value, fallback = "") {
    if (value === void 0 || value === null) return fallback;
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (value.id !== void 0 && value.id !== null) return String(value.id);
    if (value.name !== void 0 && value.name !== null) return String(value.name);
    return fallback;
  }
  function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  function normalizeCommitGeometry(target, bounds) {
    if (!target) return null;
    const x = finiteNumber(target.x);
    const y = finiteNumber(target.y);
    const width = finiteNumber(target.width);
    const height = finiteNumber(target.height);
    if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
      return null;
    }
    let normalized = {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height))
    };
    if (![normalized.x, normalized.y, normalized.width, normalized.height].every(Number.isSafeInteger)) {
      return null;
    }
    if (bounds) {
      const boundX = finiteNumber(bounds.x);
      const boundY = finiteNumber(bounds.y);
      const boundWidth = finiteNumber(bounds.width);
      const boundHeight = finiteNumber(bounds.height);
      if (boundX === null || boundY === null || boundWidth === null || boundHeight === null || boundWidth <= 0 || boundHeight <= 0) {
        return null;
      }
      const boundedWidth = Math.min(normalized.width, Math.round(boundWidth));
      const boundedHeight = Math.min(normalized.height, Math.round(boundHeight));
      const minX = Math.round(boundX);
      const minY = Math.round(boundY);
      const maxX = Math.round(boundX + boundWidth - boundedWidth);
      const maxY = Math.round(boundY + boundHeight - boundedHeight);
      normalized = {
        x: Math.max(minX, Math.min(maxX, normalized.x)),
        y: Math.max(minY, Math.min(maxY, normalized.y)),
        width: boundedWidth,
        height: boundedHeight
      };
    }
    return normalized;
  }
  function evaluateCommitGeometry(win, targetRect, bounds) {
    if (!win || win.deleted === true || win.managed === false || !win.frameGeometry || !targetRect) {
      return { outcome: "rejected", normalized: null };
    }
    const normalized = normalizeCommitGeometry(targetRect, bounds);
    if (!normalized) {
      return { outcome: "rejected", normalized: null };
    }
    const current = win.frameGeometry;
    if (current.x === normalized.x && current.y === normalized.y && current.width === normalized.width && current.height === normalized.height) {
      return { outcome: "unchanged-valid", normalized };
    }
    return { outcome: "applied", normalized };
  }
  function toNormalizedWindow(w, screen, usableArea) {
    if (!w) return { id: "unknown", managed: false, normalWindow: false };
    const wid = w.internalId ? String(w.internalId) : w.caption ? `${w.caption}_${w.resourceClass || ""}` : w.id || "unknown";
    return {
      id: wid,
      resourceClass: w.resourceClass ? String(w.resourceClass) : "",
      resourceName: w.resourceName ? String(w.resourceName) : "",
      appId: w.appId ? String(w.appId) : "",
      desktopFileName: w.desktopFileName ? String(w.desktopFileName) : "",
      title: w.caption ? String(w.caption) : w.title ? String(w.title) : "",
      role: w.windowRole ? String(w.windowRole) : "",
      outputId: screen?.name ? String(screen.name) : w.output?.name ? String(w.output.name) : "default",
      desktopId: w.desktops && w.desktops.length > 0 ? stableObjectId(w.desktops[0], "1") : stableObjectId(w.desktopId, "1"),
      desktopIds: Array.isArray(w.desktops) ? w.desktops.map((d) => stableObjectId(d)).filter(Boolean) : w.desktopId ? [stableObjectId(w.desktopId)] : ["1"],
      onAllDesktops: Boolean(w.onAllDesktops),
      activityId: w.activities && w.activities.length > 0 ? stableObjectId(w.activities[0]) : void 0,
      activities: Array.isArray(w.activities) ? w.activities.map((a) => stableObjectId(a)).filter(Boolean) : [],
      minimized: Boolean(w.minimized),
      fullScreen: Boolean(w.fullScreen),
      noBorder: Boolean(w.noBorder),
      maximizeMode: typeof w.maximizeMode === "number" ? w.maximizeMode : 0,
      frameGeometry: w.frameGeometry ? {
        x: Number(w.frameGeometry.x || 0),
        y: Number(w.frameGeometry.y || 0),
        width: Number(w.frameGeometry.width || 0),
        height: Number(w.frameGeometry.height || 0)
      } : void 0,
      outputGeometry: screen?.geometry ? {
        x: Number(screen.geometry.x || 0),
        y: Number(screen.geometry.y || 0),
        width: Number(screen.geometry.width || 0),
        height: Number(screen.geometry.height || 0)
      } : void 0,
      outputUsableArea: usableArea ? {
        x: Number(usableArea.x || 0),
        y: Number(usableArea.y || 0),
        width: Number(usableArea.width || 0),
        height: Number(usableArea.height || 0)
      } : void 0,
      managed: w.managed !== void 0 ? Boolean(w.managed) : true,
      normalWindow: w.normalWindow !== void 0 ? Boolean(w.normalWindow) : true,
      dialog: Boolean(w.dialog),
      transient: Boolean(w.transient),
      desktopWindow: Boolean(w.desktopWindow),
      dock: Boolean(w.dock),
      splash: Boolean(w.splash),
      notification: Boolean(w.notification),
      onScreenDisplay: Boolean(w.onScreenDisplay),
      popupMenu: Boolean(w.popupMenu),
      tooltip: Boolean(w.tooltip),
      specialWindow: Boolean(w.specialWindow),
      isManualFloating: Boolean(w.isManualFloating),
      isDragging: Boolean(w.isDragging),
      isPreTiled: Boolean(w.isPreTiled),
      outputAffinity: w.outputAffinity ? String(w.outputAffinity) : void 0
    };
  }
  function toNormalizedScreen(scr, usableArea, activeDesktop, activeActivity) {
    const outputId = scr?.name ? String(scr.name) : "default";
    const geom = scr?.geometry ? {
      x: Number(scr.geometry.x || 0),
      y: Number(scr.geometry.y || 0),
      width: Number(scr.geometry.width || 0),
      height: Number(scr.geometry.height || 0)
    } : { x: 0, y: 0, width: 1920, height: 1080 };
    const area = usableArea ? {
      x: Number(usableArea.x || 0),
      y: Number(usableArea.y || 0),
      width: Number(usableArea.width || 0),
      height: Number(usableArea.height || 0)
    } : geom;
    return {
      outputId,
      name: scr?.name ? String(scr.name) : outputId,
      geometry: geom,
      usableArea: area,
      activeDesktopId: stableObjectId(activeDesktop, "1"),
      activeActivityId: activeActivity === void 0 || activeActivity === null ? void 0 : stableObjectId(activeActivity)
    };
  }
  var activeCoordinator = null;
  function getOrCreateCoordinator(config) {
    if (!activeCoordinator) {
      activeCoordinator = new RuntimeCoordinator(config);
    } else if (config) {
      activeCoordinator.updateConfig(config);
    }
    return activeCoordinator;
  }
  function createCoordinator(config) {
    return new RuntimeCoordinator(config);
  }
  var ReconcilerBridge = {
    createCoordinator,
    getOrCreateCoordinator,
    toNormalizedWindow,
    toNormalizedScreen,
    normalizeCommitGeometry,
    evaluateCommitGeometry,
    resolveScreenAffinity,
    resolveCursorTargetScreen,
    computeSnapZones,
    matchSnapZoneHover,
    pointToRectDistance,
    rectIntersectionArea,
    rectContainsPoint,
    RuntimeCoordinator
  };
  globalThis.ReconcilerModule = ReconcilerBridge;
  globalThis.RuntimeCoordinator = RuntimeCoordinator;
  return __toCommonJS(qml_reconciler_compat_exports);
})();
var ReconcilerBridge = ReconcilerModule.ReconcilerBridge;
var RuntimeCoordinator = ReconcilerModule.RuntimeCoordinator;
