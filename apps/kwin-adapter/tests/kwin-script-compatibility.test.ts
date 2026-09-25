import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const BRIDGE_FILES = [
  resolve(__dirname, "../../../contents/code/layouts.js"),
  resolve(__dirname, "../../../contents/code/rules.js"),
  resolve(__dirname, "../../../contents/code/reconciler.js"),
];

const ESBUILD_CONFIG_PATH = resolve(__dirname, "../esbuild.config.mjs");

interface AstFeatures {
  propertyDeclarations: number;
  classStaticBlocks: number;
  privateIdentifiers: number;
  classes: number;
  spreadAssignments: number;
  optionalChaining: number;
  nullishCoalescing: number;
}

function analyzeSourceFeatures(sourceText: string, fileName: string): AstFeatures {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const features: AstFeatures = {
    propertyDeclarations: 0,
    classStaticBlocks: 0,
    privateIdentifiers: 0,
    classes: 0,
    spreadAssignments: 0,
    optionalChaining: 0,
    nullishCoalescing: 0,
  };

  function visit(node: ts.Node): void {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      features.classes++;
    }
    if (ts.isPropertyDeclaration(node)) {
      features.propertyDeclarations++;
    }
    if (ts.isClassStaticBlockDeclaration(node)) {
      features.classStaticBlocks++;
    }
    if (ts.isPrivateIdentifier(node)) {
      features.privateIdentifiers++;
    }
    if (ts.isSpreadAssignment(node)) {
      features.spreadAssignments++;
    }
    if (node.questionDotToken) {
      features.optionalChaining++;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      features.nullishCoalescing++;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return features;
}

describe("KWin Qt Quick QML JavaScript Engine Compatibility Gate", () => {
  it("proves the AST visitor accurately detects unlowered post-ES2016 features on synthetic probe code", () => {
    const probeCode = `
      class ProbeTarget {
        instanceField = "unsupported-in-kwin-qml";
        static staticField = 42;
        method() {
          const obj = { ...this };
          const opt = this?.instanceField;
          const nullish = opt ?? "default";
          return nullish;
        }
      }
    `;
    const probeFeatures = analyzeSourceFeatures(probeCode, "probe.ts");
    expect(probeFeatures.classes).toBe(1);
    expect(probeFeatures.propertyDeclarations).toBe(2);
    expect(probeFeatures.spreadAssignments).toBe(1);
    expect(probeFeatures.optionalChaining).toBe(1);
    expect(probeFeatures.nullishCoalescing).toBe(1);
    expect(probeFeatures.privateIdentifiers).toBe(0);
    expect(probeFeatures.classStaticBlocks).toBe(0);
  });

  it("enforces esbuild configuration targets es2016 or lower for all QML bridge bundles", () => {
    expect(existsSync(ESBUILD_CONFIG_PATH)).toBe(true);
    const esbuildConfig = readFileSync(ESBUILD_CONFIG_PATH, "utf8");

    // Must not target es2020 or es2022, which emit unlowered object spread or class fields that Qt Quick QML rejects
    expect(esbuildConfig).not.toMatch(/target:\s*["'](?:es2020|es2022)["']/);

    // Must explicitly target es2016 across all bridges
    const targetMatches = esbuildConfig.match(/target:\s*["']es2016["']/g);
    expect(targetMatches).not.toBeNull();
    expect(targetMatches!.length).toBe(3);
  });

  for (const filePath of BRIDGE_FILES) {
    const basename = filePath.split("/").pop()!;

    it(`guarantees ${basename} contains 0 unlowered class fields, object spreads, or post-ES2016 syntax for KWin QML host`, () => {
      expect(existsSync(filePath), `${basename} must exist in contents/code/`).toBe(true);
      const content = readFileSync(filePath, "utf8");
      expect(content.length, `${basename} must not be empty`).toBeGreaterThan(0);

      const features = analyzeSourceFeatures(content, basename);

      // Qt Quick QML JavaScript host (ECMAScript 7th edition / ES2016) rejects:
      // - PropertyDeclaration (class fields, ES2022) with "Expected token '('"
      // - SpreadAssignment (object spread, ES2018) with "Unexpected token '...'"
      // - OptionalChain (?.), NullishCoalescing (??), ClassStaticBlock, PrivateIdentifier
      expect(
        features.propertyDeclarations,
        `${basename} contains ${features.propertyDeclarations} unlowered PropertyDeclaration (class field) nodes incompatible with Qt Quick QML`,
      ).toBe(0);

      expect(
        features.spreadAssignments,
        `${basename} contains ${features.spreadAssignments} unlowered SpreadAssignment (object spread) nodes incompatible with Qt Quick QML`,
      ).toBe(0);

      expect(
        features.optionalChaining,
        `${basename} contains ${features.optionalChaining} unlowered OptionalChain (?.) nodes incompatible with Qt Quick QML`,
      ).toBe(0);

      expect(
        features.nullishCoalescing,
        `${basename} contains ${features.nullishCoalescing} unlowered NullishCoalescing (??) nodes incompatible with Qt Quick QML`,
      ).toBe(0);

      expect(
        features.privateIdentifiers,
        `${basename} contains ${features.privateIdentifiers} PrivateIdentifier nodes incompatible with Qt Quick QML`,
      ).toBe(0);

      expect(
        features.classStaticBlocks,
        `${basename} contains ${features.classStaticBlocks} ClassStaticBlockDeclaration nodes incompatible with Qt Quick QML`,
      ).toBe(0);
    });
  }

  function createIsolatedKWinVmContext(): vm.Context {
    // Isolated sandbox with NO host Object/Array/builtins injected
    const context = vm.createContext({
      console,
    });

    // Explicitly unset post-ES2016 methods and forbid globalThis to emulate KWin's Qt Quick QML JS engine
    vm.runInContext(`
      delete Array.prototype.flatMap;
      delete Array.prototype.flat;
      delete Object.getOwnPropertyDescriptors;
      Object.defineProperty(this, "globalThis", {
        get() {
          throw new ReferenceError("globalThis is not defined");
        },
        configurable: true,
      });
    `, context);

    return context;
  }

  it("guarantees all bridge bundles execute cleanly in an isolated VM environment without globalThis, flatMap, or getOwnPropertyDescriptors", () => {
    const bridgeExpectations: Record<string, string[]> = {
      "layouts.js": ["LayoutsModule", "Layouts"],
      "rules.js": ["RulesEngineModule", "RuleEngine"],
      "reconciler.js": ["ReconcilerModule", "ReconcilerBridge", "RuntimeCoordinator"],
    };

    for (const filePath of BRIDGE_FILES) {
      const basename = filePath.split("/").pop()!;
      const expected = bridgeExpectations[basename];
      const code = readFileSync(filePath, "utf8");

      const context = createIsolatedKWinVmContext();

      expect(() => {
        vm.runInContext(code, context);
      }).not.toThrow();

      for (const exp of expected) {
        expect(context[exp], `${basename} must export ${exp} to global scope`).toBeDefined();
      }
    }
  });

  it("proves negative controls fail in the isolated VM context (old flatMap, missing Object.getOwnPropertyDescriptors, globalThis)", () => {
    const context = createIsolatedKWinVmContext();

    // 1. Array.prototype.flatMap is truly absent and old flatMap call fails with TypeError
    expect(vm.runInContext("typeof Array.prototype.flatMap", context)).toBe("undefined");
    let flatMapError: any = null;
    try {
      vm.runInContext(`
        const options = { userFilterPatterns: ["tessera,tessera-settings", "tessera_settings.py"] };
        options.userFilterPatterns.flatMap(p => p.split(","));
      `, context);
    } catch (err: any) {
      flatMapError = err;
    }
    expect(flatMapError).not.toBeNull();
    expect(flatMapError.name).toBe("TypeError");
    expect(flatMapError.message).toMatch(/flatMap is not a function/);

    // 2. Object.getOwnPropertyDescriptors is truly absent and direct call fails with TypeError
    expect(vm.runInContext("typeof Object.getOwnPropertyDescriptors", context)).toBe("undefined");
    let getDescsError: any = null;
    try {
      vm.runInContext(`
        Object.getOwnPropertyDescriptors({ a: 1 });
      `, context);
    } catch (err: any) {
      getDescsError = err;
    }
    expect(getDescsError).not.toBeNull();
    expect(getDescsError.name).toBe("TypeError");
    expect(getDescsError.message).toMatch(/getOwnPropertyDescriptors is not a function/);

    // 3. globalThis throws ReferenceError
    let globalThisError: any = null;
    try {
      vm.runInContext("globalThis.foo = 1;", context);
    } catch (err: any) {
      globalThisError = err;
    }
    expect(globalThisError).not.toBeNull();
    expect(globalThisError.name).toBe("ReferenceError");
    expect(globalThisError.message).toMatch(/globalThis is not defined/);
  });

  it("executes RuleEngine option update and classification in an isolated Qt-like VM environment where Array.prototype.flatMap and globalThis are absent", () => {
    const rulesCode = readFileSync(resolve(__dirname, "../../../contents/code/rules.js"), "utf8");
    const context = createIsolatedKWinVmContext();
    vm.runInContext(rulesCode, context);

    const ruleEngine = (context as any).RuleEngine;
    expect(ruleEngine).toBeDefined();

    // Verify RuleEngine.classify handles comma-separated userFilterPatterns correctly without relying on native flatMap
    const result = ruleEngine.classify(
      { resourceClass: "tessera-settings", normalWindow: true, managed: true },
      { userFilterPatterns: ["tessera,tessera-settings", "tessera_settings.py"] }
    );
    expect(result.classification).toBe("floating");
    expect(result.source).toBe("user-rule");

    const shouldFloat = ruleEngine.shouldFloat(
      { resourceClass: "tessera-settings", normalWindow: true, managed: true },
      "tessera,tessera-settings,tessera_settings.py"
    );
    expect(shouldFloat).toBe(true);
  });

  it("instantiates RuntimeCoordinator and updates floatFilter in an isolated Qt-like VM environment without flatMap and globalThis", () => {
    const reconcilerCode = readFileSync(resolve(__dirname, "../../../contents/code/reconciler.js"), "utf8");
    const context = createIsolatedKWinVmContext();
    vm.runInContext(reconcilerCode, context);

    const reconcilerBridge = (context as any).ReconcilerBridge;
    expect(reconcilerBridge).toBeDefined();

    // Emulate main.qml getCoordinator() creation with default settings
    const coordinator = reconcilerBridge.createCoordinator({
      enableTiling: true,
      defaultLayout: "monocle",
      gapInner: 8,
      gapOuter: 8,
      primaryRegionRatio: 0.55,
      primaryRegionCount: 1,
      perDesktopLayout: false,
      ignoreMinimized: true,
      gameWindowPolicy: "floating",
      floatFilter: "tessera,tessera-settings,tessera_settings.py",
      customRules: "[]",
      workspaceLayoutsJson: "{}"
    });
    expect(coordinator).toBeDefined();

    // Verify config update triggers option update without errors
    expect(() => {
      coordinator.updateConfig({
        floatFilter: "test-app,other-tool,tessera_settings.py"
      });
    }).not.toThrow();

    // Verify reconcile executes cleanly
    expect(() => {
      const tx = coordinator.reconcile();
      expect(tx).toBeNull();
    }).not.toThrow();
  });

  it("verifies bridges contain zero __spreadProps, zero __getOwnPropDescs, and zero post-ES2016 builtins", () => {
    for (const filePath of BRIDGE_FILES) {
      const basename = filePath.split("/").pop()!;
      const code = readFileSync(filePath, "utf8");

      // Verify no unlowered/unsupported spread helpers
      expect(code.includes("__spreadProps"), `${basename} must not contain __spreadProps helper`).toBe(false);
      expect(code.includes("__getOwnPropDescs"), `${basename} must not contain __getOwnPropDescs helper`).toBe(false);

      // Verify no direct globalThis references
      expect(code.includes("globalThis"), `${basename} must not contain globalThis references`).toBe(false);
    }
  });
});
