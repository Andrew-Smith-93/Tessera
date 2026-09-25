"use strict";
var RulesEngineModule = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
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
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // apps/kwin-adapter/src/qml-rules-compat.ts
  var qml_rules_compat_exports = {};
  __export(qml_rules_compat_exports, {
    RuleEngine: () => RuleEngine,
    computeConfigSignature: () => computeConfigSignature,
    getLastRuleValidationErrors: () => getLastRuleValidationErrors,
    getLastValidCustomRules: () => getLastValidCustomRules,
    getOrCreateRuleEngine: () => getOrCreateRuleEngine,
    hasPriorValidCustomRules: () => hasPriorValidCustomRules,
    recordCustomRules: () => recordCustomRules,
    resetRuleEngineState: () => resetRuleEngineState,
    toWindowRuleInput: () => toWindowRuleInput,
    validateCustomRules: () => validateCustomRules
  });

  // packages/rules-engine/src/rules.ts
  var VALID_MATCH_TYPES = ["class", "title", "role", "app"];
  var VALID_RULE_ACTIONS = ["tile", "float", "monocle", "tiled", "floating", "ignored"];
  function validateCustomRules(input) {
    if (input === void 0 || input === null) {
      return { valid: true, rules: [], errors: [] };
    }
    let rawRules = input;
    if (typeof input === "string") {
      const trimmed = input.trim();
      if (trimmed === "" || trimmed === "[]") {
        return { valid: true, rules: [], errors: [] };
      }
      try {
        rawRules = JSON.parse(trimmed);
      } catch (e) {
        return {
          valid: false,
          rules: [],
          errors: [`Malformed JSON syntax: ${(e == null ? void 0 : e.message) || String(e)}`]
        };
      }
    }
    if (!Array.isArray(rawRules)) {
      return {
        valid: false,
        rules: [],
        errors: ["Custom rules must be an array of rule objects"]
      };
    }
    const errors = [];
    const validRules = [];
    for (let i = 0; i < rawRules.length; i++) {
      const item = rawRules[i];
      const prefix = `Rule #${i + 1}`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`${prefix}: must be a non-null object`);
        continue;
      }
      const rec = item;
      if (typeof rec.pattern !== "string" || rec.pattern.trim().length === 0) {
        errors.push(`${prefix}: 'pattern' must be a non-empty string`);
        continue;
      }
      const rawMatchType = typeof rec.matchType === "string" ? rec.matchType.toLowerCase() : "";
      if (!VALID_MATCH_TYPES.includes(rawMatchType)) {
        errors.push(
          `${prefix}: 'matchType' must be one of: ${VALID_MATCH_TYPES.join(", ")} (got ${JSON.stringify(rec.matchType)})`
        );
        continue;
      }
      const rawAction = typeof rec.action === "string" ? rec.action.toLowerCase() : "";
      if (!VALID_RULE_ACTIONS.includes(rawAction)) {
        errors.push(
          `${prefix}: 'action' must be one of: ${VALID_RULE_ACTIONS.join(", ")} (got ${JSON.stringify(rec.action)})`
        );
        continue;
      }
      let isRegex = false;
      if ("isRegex" in rec && rec.isRegex !== void 0) {
        if (typeof rec.isRegex !== "boolean") {
          errors.push(`${prefix}: 'isRegex' must be a boolean`);
          continue;
        }
        isRegex = rec.isRegex;
        if (isRegex) {
          try {
            new RegExp(rec.pattern, "i");
          } catch (e) {
            errors.push(`${prefix}: invalid regular expression '${rec.pattern}': ${(e == null ? void 0 : e.message) || String(e)}`);
            continue;
          }
        }
      }
      const validated = {
        pattern: rec.pattern,
        matchType: rawMatchType,
        action: rawAction
      };
      if (isRegex) {
        validated.isRegex = true;
      }
      if (typeof rec.id === "string" && rec.id) {
        validated.id = rec.id;
      }
      validRules.push(validated);
    }
    if (errors.length > 0) {
      return {
        valid: false,
        rules: [],
        errors
      };
    }
    return {
      valid: true,
      rules: validRules,
      errors: []
    };
  }
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
    var _a, _b;
    if (input.fullScreen === true) return false;
    if (input.noBorder !== true) return false;
    const maxMode = (_a = input.maximizeMode) != null ? _a : 0;
    if (maxMode !== 0) return false;
    const frame = input.frameGeometry;
    const out = (_b = input.outputGeometry) != null ? _b : input.outputUsableArea;
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
  var WindowRuleEngine = class {
    constructor(options = {}) {
      __publicField(this, "userFilterTokens", []);
      __publicField(this, "customRules", []);
      __publicField(this, "gameWindowPolicy", "floating");
      __publicField(this, "customGamePatterns", []);
      this.updateOptions(options);
    }
    updateOptions(options) {
      if (options.userFilterString !== void 0) {
        this.userFilterTokens = options.userFilterString.split(",").map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
      } else if (options.userFilterPatterns !== void 0) {
        const tokens = [];
        for (const p of options.userFilterPatterns) {
          if (typeof p === "string") {
            const parts = p.split(",");
            for (const part of parts) {
              const trimmed = part.trim().toLowerCase();
              if (trimmed.length > 0) {
                tokens.push(trimmed);
              }
            }
          }
        }
        this.userFilterTokens = tokens;
      }
      if (options.customRules !== void 0) {
        if (Array.isArray(options.customRules)) {
          this.customRules = options.customRules.filter(
            (r) => Boolean(r && typeof r === "object" && typeof r.pattern === "string" && r.pattern.trim().length > 0)
          );
        } else {
          const validation = validateCustomRules(options.customRules);
          this.customRules = validation.valid ? validation.rules : [];
        }
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
        if (!rule || typeof rule !== "object" || typeof rule.pattern !== "string" || !rule.pattern) {
          continue;
        }
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
          default:
            continue;
        }
        let matched = false;
        const patLower = rule.pattern.toLowerCase();
        if (rule.isRegex) {
          try {
            const re = new RegExp(rule.pattern, "i");
            matched = re.test(target);
          } catch (e) {
            matched = target.includes(patLower);
          }
        } else {
          matched = target.includes(patLower);
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
      return {
        classification: "tiled",
        reason: "Default tiling fallback",
        source: "fallback"
      };
    }
  };
  /**
   * Default float patterns (retained as an empty frozen array for backward compatibility).
   * Standalone Control Center is retired; implicit floating exceptions are removed.
   */
  __publicField(WindowRuleEngine, "DEFAULT_FLOAT_PATTERNS", Object.freeze([]));
  var WindowClassificationTracker = class {
    constructor() {
      __publicField(this, "classifications", /* @__PURE__ */ new Map());
      __publicField(this, "tileability", /* @__PURE__ */ new Map());
    }
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
    var _a;
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
      outputGeometry: (options == null ? void 0 : options.outputGeometry) || (((_a = w.output) == null ? void 0 : _a.geometry) ? {
        x: Number(w.output.geometry.x || 0),
        y: Number(w.output.geometry.y || 0),
        width: Number(w.output.geometry.width || 0),
        height: Number(w.output.geometry.height || 0)
      } : void 0),
      outputUsableArea: options == null ? void 0 : options.outputUsableArea,
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
  var cachedEngine = null;
  var cachedSignature = "";
  var lastValidCustomRules = [];
  var lastRuleValidationErrors = [];
  var hasPriorValidCustomRulesState = false;
  var tracker = new WindowClassificationTracker();
  function getLastRuleValidationErrors() {
    return [...lastRuleValidationErrors];
  }
  function getLastValidCustomRules() {
    return [...lastValidCustomRules];
  }
  function hasPriorValidCustomRules() {
    return hasPriorValidCustomRulesState && lastValidCustomRules.length > 0;
  }
  function recordCustomRules(customRules) {
    const valResult = validateCustomRules(customRules);
    if (valResult.valid) {
      lastValidCustomRules = valResult.rules;
      if (valResult.rules.length > 0) {
        hasPriorValidCustomRulesState = true;
      } else {
        hasPriorValidCustomRulesState = false;
      }
      lastRuleValidationErrors = [];
    } else {
      lastRuleValidationErrors = valResult.errors;
    }
    return valResult;
  }
  function resetRuleEngineState() {
    cachedEngine = null;
    cachedSignature = "";
    lastValidCustomRules = [];
    lastRuleValidationErrors = [];
    hasPriorValidCustomRulesState = false;
  }
  function computeConfigSignature(options) {
    if (!options) return "default";
    const customRulesStr = typeof options.customRules === "string" ? options.customRules : JSON.stringify(options.customRules || []);
    const filterStr = options.userFilterString || (options.userFilterPatterns ? options.userFilterPatterns.join(",") : "");
    const policyStr = options.gameWindowPolicy || "floating";
    const gamePatsStr = options.customGamePatterns ? options.customGamePatterns.join(",") : "";
    return `${policyStr}|${filterStr}|${customRulesStr}|${gamePatsStr}`;
  }
  function getOrCreateRuleEngine(options) {
    if (options && options.customRules !== void 0) {
      const valResult = validateCustomRules(options.customRules);
      if (valResult.valid) {
        lastValidCustomRules = valResult.rules;
        if (valResult.rules.length > 0) {
          hasPriorValidCustomRulesState = true;
        }
        lastRuleValidationErrors = [];
      } else {
        lastRuleValidationErrors = valResult.errors;
      }
    }
    const effectiveRules = lastValidCustomRules;
    const filterStr = (options == null ? void 0 : options.userFilterString) || ((options == null ? void 0 : options.userFilterPatterns) ? options.userFilterPatterns.join(",") : "");
    const policyStr = (options == null ? void 0 : options.gameWindowPolicy) || "floating";
    const gamePatsStr = (options == null ? void 0 : options.customGamePatterns) ? options.customGamePatterns.join(",") : "";
    const rulesSig = JSON.stringify(effectiveRules);
    const sig = `${policyStr}|${filterStr}|${rulesSig}|${gamePatsStr}`;
    if (!cachedEngine || cachedSignature !== sig) {
      const filterPatterns = (options == null ? void 0 : options.userFilterPatterns) || ((options == null ? void 0 : options.userFilterString) ? [options.userFilterString] : []);
      cachedEngine = new WindowRuleEngine({
        customRules: effectiveRules,
        userFilterPatterns: filterPatterns,
        gameWindowPolicy: (options == null ? void 0 : options.gameWindowPolicy) || "floating",
        customGamePatterns: options == null ? void 0 : options.customGamePatterns
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
      const wid = input.windowId || ((w == null ? void 0 : w.internalId) ? String(w.internalId) : "unknown");
      return tracker.evaluate(wid, result);
    },
    forget(w) {
      const wid = typeof w === "string" ? w : (w == null ? void 0 : w.internalId) ? String(w.internalId) : (w == null ? void 0 : w.windowId) || "";
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
    validateRules(rules) {
      return validateCustomRules(rules);
    },
    getLastValidationErrors() {
      return getLastRuleValidationErrors();
    },
    getLastValidRules() {
      return getLastValidCustomRules();
    },
    hasPriorValidRules() {
      return hasPriorValidCustomRules();
    },
    recordCustomRules(rules) {
      return recordCustomRules(rules);
    },
    resetState() {
      resetRuleEngineState();
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
  return __toCommonJS(qml_rules_compat_exports);
})();
var RuleEngine = RulesEngineModule.RuleEngine;
