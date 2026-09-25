import { describe, it, expect, beforeEach } from "vitest";
import {
  RuleEngine,
  getOrCreateRuleEngine,
  validateCustomRules,
  resetRuleEngineState,
  getLastRuleValidationErrors,
  getLastValidCustomRules
} from "../src/qml-rules-compat.js";

describe("Custom Rules Schema Validation and Runtime Lifecycle", () => {
  beforeEach(() => {
    resetRuleEngineState();
  });

  it("valid apply: applies valid custom rules correctly", () => {
    const validJson = JSON.stringify([
      { matchType: "class", pattern: "gimp", action: "float" },
      { matchType: "title", pattern: "^Important.*", action: "tile", isRegex: true }
    ]);
    const valResult = validateCustomRules(validJson);
    expect(valResult.valid).toBe(true);
    expect(valResult.errors).toHaveLength(0);
    expect(valResult.rules).toHaveLength(2);

    const normalWin = {
      internalId: "win-1",
      managed: true,
      normalWindow: true,
      resourceClass: "gimp",
      title: "GNU Image Manipulation Program"
    };

    const res = RuleEngine.classify(normalWin, { customRules: validJson });
    expect(res.classification).toBe("floating");
    expect(res.source).toBe("user-rule");
    expect(RuleEngine.shouldFloat(normalWin, undefined, validJson)).toBe(true);
  });

  it("input 1: customRules='[null]' does not throw reading matchType and retains last valid rules", () => {
    // 1. Establish valid baseline
    const validJson = JSON.stringify([
      { matchType: "class", pattern: "gimp", action: "float" }
    ]);
    RuleEngine.classify({ managed: true, normalWindow: true }, { customRules: validJson });
    expect(getLastValidCustomRules()).toHaveLength(1);

    // 2. Submit invalid input: [null]
    const invalidInput = "[null]";
    const valResult = validateCustomRules(invalidInput);
    expect(valResult.valid).toBe(false);
    expect(valResult.errors.some(e => e.includes("must be a non-null object"))).toBe(true);

    const testWin = {
      internalId: "win-gimp",
      managed: true,
      normalWindow: true,
      resourceClass: "gimp",
      title: "GIMP Image"
    };

    // Must NOT throw TypeError: Cannot read properties of null (reading 'matchType')
    expect(() => {
      const res = getOrCreateRuleEngine({ customRules: invalidInput }).classify(testWin);
      // Retains last valid rules: gimp is still floating!
      expect(res.classification).toBe("floating");
      expect(res.source).toBe("user-rule");
    }).not.toThrow();

    expect(getLastRuleValidationErrors().length).toBeGreaterThan(0);
    expect(getLastValidCustomRules()).toHaveLength(1);
  });

  it("input 2: [{'matchType':'class','action':'float'}] (missing pattern) does not throw pattern.toLowerCase and retains last valid rules", () => {
    // 1. Establish valid baseline
    const validJson = JSON.stringify([
      { matchType: "class", pattern: "gimp", action: "float" }
    ]);
    RuleEngine.classify({ managed: true, normalWindow: true }, { customRules: validJson });
    expect(getLastValidCustomRules()).toHaveLength(1);

    // 2. Submit invalid input: missing pattern
    const invalidInput = JSON.stringify([{ matchType: "class", action: "float" }]);
    const valResult = validateCustomRules(invalidInput);
    expect(valResult.valid).toBe(false);
    expect(valResult.errors.some(e => e.includes("pattern"))).toBe(true);

    const testWin = {
      internalId: "win-gimp",
      managed: true,
      normalWindow: true,
      resourceClass: "gimp",
      title: "GIMP Image"
    };

    // Must NOT throw TypeError: Cannot read properties of undefined (reading 'toLowerCase')
    expect(() => {
      const res = getOrCreateRuleEngine({ customRules: invalidInput }).classify(testWin);
      // Retains last valid rules
      expect(res.classification).toBe("floating");
      expect(res.source).toBe("user-rule");
    }).not.toThrow();

    expect(getLastRuleValidationErrors().length).toBeGreaterThan(0);
    expect(getLastValidCustomRules()).toHaveLength(1);
  });

  it("input 3: malformed JSON does not drop all rules to [] and retains last valid rules", () => {
    // 1. Establish valid baseline
    const validJson = JSON.stringify([
      { matchType: "class", pattern: "gimp", action: "float" }
    ]);
    RuleEngine.classify({ managed: true, normalWindow: true }, { customRules: validJson });
    expect(getLastValidCustomRules()).toHaveLength(1);

    // 2. Submit malformed JSON: "{"
    const malformedJson = "{";
    const valResult = validateCustomRules(malformedJson);
    expect(valResult.valid).toBe(false);
    expect(valResult.errors.some(e => e.includes("JSON"))).toBe(true);

    const testWin = {
      internalId: "win-gimp",
      managed: true,
      normalWindow: true,
      resourceClass: "gimp"
    };

    // Must NOT silently become [] and drop all rules; must retain last valid rules!
    const res = getOrCreateRuleEngine({ customRules: malformedJson }).classify(testWin);
    expect(res.classification).toBe("floating");
    expect(res.source).toBe("user-rule");
    expect(getLastValidCustomRules()).toHaveLength(1);
  });

  it("valid reset: setting '[]' or [] resets rules to empty", () => {
    // 1. Establish valid baseline
    const validJson = JSON.stringify([
      { matchType: "class", pattern: "gimp", action: "float" }
    ]);
    RuleEngine.classify({ managed: true, normalWindow: true }, { customRules: validJson });
    expect(getLastValidCustomRules()).toHaveLength(1);

    // 2. Valid reset: "[]"
    const resetResult = validateCustomRules("[]");
    expect(resetResult.valid).toBe(true);
    expect(resetResult.rules).toHaveLength(0);

    const testWin = {
      internalId: "win-gimp",
      managed: true,
      normalWindow: true,
      resourceClass: "gimp"
    };

    const res = getOrCreateRuleEngine({ customRules: "[]" }).classify(testWin);
    // After reset, gimp is no longer floated by user-rule; falls back to tiled
    expect(res.classification).toBe("tiled");
    expect(res.source).toBe("fallback");
    expect(getLastValidCustomRules()).toHaveLength(0);
    expect(getLastRuleValidationErrors()).toHaveLength(0);
  });

  it("valid reload: updates to new valid rules cleanly", () => {
    // 1. Baseline
    const firstRule = JSON.stringify([
      { matchType: "class", pattern: "gimp", action: "float" }
    ]);
    RuleEngine.classify({ managed: true, normalWindow: true }, { customRules: firstRule });

    // 2. Reload with second rule
    const secondRule = JSON.stringify([
      { matchType: "title", pattern: "Special Editor", action: "float" }
    ]);
    const testWinGimp = {
      internalId: "win-gimp",
      managed: true,
      normalWindow: true,
      resourceClass: "gimp",
      title: "Gimp"
    };
    const testWinEditor = {
      internalId: "win-editor",
      managed: true,
      normalWindow: true,
      resourceClass: "kate",
      title: "Special Editor - main.c"
    };

    const resGimp = getOrCreateRuleEngine({ customRules: secondRule }).classify(testWinGimp);
    const resEditor = getOrCreateRuleEngine({ customRules: secondRule }).classify(testWinEditor);

    expect(resGimp.classification).toBe("tiled");
    expect(resEditor.classification).toBe("floating");
    expect(resEditor.source).toBe("user-rule");
    expect(getLastValidCustomRules()).toHaveLength(1);
    expect(getLastRuleValidationErrors()).toHaveLength(0);
  });

  it("production regression: coordinator preserves last-valid rules across updateConfig before any window classification", async () => {
    const fs = await import("fs");
    const vm = await import("vm");
    const path = await import("path");
    const reconcilerPath = path.resolve(__dirname, "../../../contents/code/reconciler.js");
    const reconcilerCode = fs.readFileSync(reconcilerPath, "utf8");

    // 1. Fresh VM context simulating KWin runtime
    const ctx: Record<string, any> = {};
    vm.runInNewContext(reconcilerCode, ctx);
    const { ReconcilerBridge } = ctx;

    // 2. createCoordinator({ customRules: valid review-app float rule })
    const validRule = JSON.stringify([{ matchType: "class", pattern: "review-app", action: "float" }]);
    const coordinator = ReconcilerBridge.createCoordinator({
      customRules: validRule,
      enableTiling: true,
      defaultLayout: "balanced-grid"
    });
    expect(coordinator.hasPriorValidCustomRules()).toBe(true);
    expect(coordinator.getLastCustomRuleErrors()).toHaveLength(0);

    // 3. updateConfig({ customRules: '[null]' }) BEFORE ANY WINDOW CLASSIFICATION
    coordinator.updateConfig({ customRules: "[null]" });
    expect(coordinator.getLastCustomRuleErrors().length).toBeGreaterThan(0);
    // Retains prior valid state
    expect(coordinator.hasPriorValidCustomRules()).toBe(true);

    // 4. Now classify normal review-app: MUST return floating!
    const win = {
      internalId: "win-review-1",
      managed: true,
      normalWindow: true,
      resourceClass: "review-app",
      title: "Review Application"
    };
    const res = coordinator.classifyWindow(win);
    expect(res.classification).toBe("floating");
    expect(res.source).toBe("user-rule");

    // 5. Subsequent invalid input 2: missing pattern (still before reset)
    coordinator.updateConfig({ customRules: JSON.stringify([{ matchType: "class", action: "float" }]) });
    const res2 = coordinator.classifyWindow(win);
    expect(res2.classification).toBe("floating");

    // 6. Valid reset: "[]"
    coordinator.updateConfig({ customRules: "[]" });
    expect(coordinator.getLastCustomRuleErrors()).toHaveLength(0);
    expect(coordinator.hasPriorValidCustomRules()).toBe(false);
    const resReset = coordinator.classifyWindow(win);
    expect(resReset.classification).toBe("tiled");

    // 7. Fresh restart with invalid input:
    // Memory cache starts clean, so it safely classifies as default "tiled" without crashing,
    // and distinguishes startup with no prior valid rules.
    const freshCtx: Record<string, any> = {};
    vm.runInNewContext(reconcilerCode, freshCtx);
    const freshCoordinator = freshCtx.ReconcilerBridge.createCoordinator({
      customRules: "[null]",
      enableTiling: true,
      defaultLayout: "balanced-grid"
    });
    expect(freshCoordinator.hasPriorValidCustomRules()).toBe(false);
    expect(freshCoordinator.getLastCustomRuleErrors().length).toBeGreaterThan(0);
    const resFresh = freshCoordinator.classifyWindow(win);
    expect(resFresh.classification).toBe("tiled");
  });
});
