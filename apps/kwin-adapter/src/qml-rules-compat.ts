import {
  WindowRuleEngine,
  WindowClassificationTracker,
  validateCustomRules,
  type WindowRuleInput,
  type WindowClassificationResult,
  type CustomRule,
  type GameWindowPolicy,
  type ClassificationChangeResult,
  type RuleValidationResult
} from "@tessera/rules-engine";
import type { Rect } from "@tessera/protocol";

export { validateCustomRules };

export interface QmlRuleOptions {
  userFilterString?: string;
  userFilterPatterns?: string[];
  customRules?: CustomRule[] | string;
  gameWindowPolicy?: GameWindowPolicy;
  customGamePatterns?: string[];
  outputGeometry?: Rect;
  outputUsableArea?: Rect;
}

export function toWindowRuleInput(w: any, options?: QmlRuleOptions): WindowRuleInput {
  if (!w) return { managed: false };

  // If already normalized WindowRuleInput or KWin Window object
  return {
    windowId: w.internalId ? String(w.internalId) : (w.windowId || ""),
    resourceClass: w.resourceClass ? String(w.resourceClass) : (w.windowClass ? String(w.windowClass) : ""),
    resourceName: w.resourceName ? String(w.resourceName) : "",
    appId: w.appId ? String(w.appId) : "",
    desktopFileName: w.desktopFileName ? String(w.desktopFileName) : "",
    title: w.caption ? String(w.caption) : (w.title ? String(w.title) : ""),
    caption: w.caption ? String(w.caption) : (w.title ? String(w.title) : ""),
    windowRole: w.windowRole ? String(w.windowRole) : (w.role ? String(w.role) : ""),
    role: w.windowRole ? String(w.windowRole) : (w.role ? String(w.role) : ""),
    managed: w.managed !== undefined ? Boolean(w.managed) : (w.isManaged !== undefined ? Boolean(w.isManaged) : true),
    normalWindow: w.normalWindow !== undefined ? Boolean(w.normalWindow) : (w.isNormal !== undefined ? Boolean(w.isNormal) : true),
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
    } : undefined,
    outputGeometry: options?.outputGeometry || (w.output?.geometry ? {
      x: Number(w.output.geometry.x || 0),
      y: Number(w.output.geometry.y || 0),
      width: Number(w.output.geometry.width || 0),
      height: Number(w.output.geometry.height || 0)
    } : undefined),
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

let cachedEngine: WindowRuleEngine | null = null;
let cachedSignature = "";
let lastValidCustomRules: CustomRule[] = [];
let lastRuleValidationErrors: string[] = [];
let hasPriorValidCustomRulesState = false;
const tracker = new WindowClassificationTracker();

export function getLastRuleValidationErrors(): string[] {
  return [...lastRuleValidationErrors];
}

export function getLastValidCustomRules(): CustomRule[] {
  return [...lastValidCustomRules];
}

export function hasPriorValidCustomRules(): boolean {
  return hasPriorValidCustomRulesState && lastValidCustomRules.length > 0;
}

export function recordCustomRules(customRules: unknown): RuleValidationResult {
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

export function resetRuleEngineState(): void {
  cachedEngine = null;
  cachedSignature = "";
  lastValidCustomRules = [];
  lastRuleValidationErrors = [];
  hasPriorValidCustomRulesState = false;
}

export function computeConfigSignature(options?: QmlRuleOptions): string {
  if (!options) return "default";
  const customRulesStr = typeof options.customRules === "string"
    ? options.customRules
    : JSON.stringify(options.customRules || []);
  const filterStr = options.userFilterString || (options.userFilterPatterns ? options.userFilterPatterns.join(",") : "");
  const policyStr = options.gameWindowPolicy || "floating";
  const gamePatsStr = options.customGamePatterns ? options.customGamePatterns.join(",") : "";
  return `${policyStr}|${filterStr}|${customRulesStr}|${gamePatsStr}`;
}

export function getOrCreateRuleEngine(options?: QmlRuleOptions): WindowRuleEngine {
  if (options && options.customRules !== undefined) {
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
  const filterStr = options?.userFilterString || (options?.userFilterPatterns ? options.userFilterPatterns.join(",") : "");
  const policyStr = options?.gameWindowPolicy || "floating";
  const gamePatsStr = options?.customGamePatterns ? options.customGamePatterns.join(",") : "";
  const rulesSig = JSON.stringify(effectiveRules);
  const sig = `${policyStr}|${filterStr}|${rulesSig}|${gamePatsStr}`;

  if (!cachedEngine || cachedSignature !== sig) {
    const filterPatterns = options?.userFilterPatterns || (options?.userFilterString ? [options.userFilterString] : []);
    cachedEngine = new WindowRuleEngine({
      customRules: effectiveRules,
      userFilterPatterns: filterPatterns,
      gameWindowPolicy: options?.gameWindowPolicy || "floating",
      customGamePatterns: options?.customGamePatterns
    });
    cachedSignature = sig;
  }
  return cachedEngine;
}

export const RuleEngine = {
  classify(w: any, options?: QmlRuleOptions): WindowClassificationResult {
    const engine = getOrCreateRuleEngine(options);
    const input = toWindowRuleInput(w, options);
    return engine.classify(input);
  },

  evaluate(w: any, options?: QmlRuleOptions): ClassificationChangeResult {
    const input = toWindowRuleInput(w, options);
    const engine = getOrCreateRuleEngine(options);
    const result = engine.classify(input);
    const wid = input.windowId || (w?.internalId ? String(w.internalId) : "unknown");
    return tracker.evaluate(wid, result);
  },

  forget(w: any): void {
    const wid = typeof w === "string" ? w : (w?.internalId ? String(w.internalId) : (w?.windowId || ""));
    if (wid) {
      tracker.forget(wid);
    }
  },

  shouldFloat(w: any, userFilterString?: string, customRulesJson?: string | CustomRule[], gameWindowPolicy?: GameWindowPolicy): boolean {
    const result = this.classify(w, {
      userFilterString,
      customRules: customRulesJson,
      gameWindowPolicy: gameWindowPolicy || "floating"
    });
    return result.classification === "floating" || result.classification === "fullscreen" || result.classification === "fullscreen-like";
  },

  isIgnored(w: any): boolean {
    const result = this.classify(w);
    return result.classification === "ignored";
  },

  validateRules(rules: unknown): RuleValidationResult {
    return validateCustomRules(rules);
  },

  getLastValidationErrors(): string[] {
    return getLastRuleValidationErrors();
  },

  getLastValidRules(): CustomRule[] {
    return getLastValidCustomRules();
  },

  hasPriorValidRules(): boolean {
    return hasPriorValidCustomRules();
  },

  recordCustomRules(rules: unknown): RuleValidationResult {
    return recordCustomRules(rules);
  },

  resetState(): void {
    resetRuleEngineState();
  },

  defaultFloatPatterns: WindowRuleEngine.DEFAULT_FLOAT_PATTERNS,
  getCachedSignature(): string {
    return cachedSignature;
  },
  clearCache(): void {
    cachedEngine = null;
    cachedSignature = "";
    tracker.clear();
  },
  tracker
};

