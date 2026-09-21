import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const QML_PATH = resolve(__dirname, "../../../contents/ui/main.qml");

describe("QML Source Isolation & Legacy Map Audit", () => {
  // The exact 14 properties mandated by Phase 5 Correction Gate
  const exactFourteenProperties = [
    "windowClassifications",
    "windowTileability",
    "floatingWindows",
    "savedTiledGeometries",
    "savedMinimGeometries",
    "preTiledWindows",
    "screenTiledWindows",
    "persistentScreenOrder",
    "tiledWindows",
    "minimizedWindows",
    "windowScreenAffinity",
    "managedWindows",
    "virtualScreenGeometries",
    "lastAppliedGeometries"
  ] as const;

  const absentProperties = [
    "tiledWindows",
    "minimizedWindows",
    "windowScreenAffinity",
    "managedWindows",
    "virtualScreenGeometries",
    "lastAppliedGeometries"
  ] as const;

  const presentProperties = [
    "windowClassifications",
    "windowTileability",
    "floatingWindows",
    "savedTiledGeometries",
    "savedMinimGeometries",
    "preTiledWindows",
    "screenTiledWindows",
    "persistentScreenOrder"
  ] as const;

  it("1. contents/ui/main.qml exists and is readable", () => {
    expect(existsSync(QML_PATH)).toBe(true);
    const content = readFileSync(QML_PATH, "utf8");
    expect(content.length).toBeGreaterThan(1000);
  });

  it("2. Verifies the 6 absent properties have 0 matches in main.qml", () => {
    const content = readFileSync(QML_PATH, "utf8");
    for (const prop of absentProperties) {
      const regex = new RegExp(`\\b${prop}\\b`, "g");
      const matches = content.match(regex);
      expect(
        matches,
        `Property "${prop}" must be completely absent from contents/ui/main.qml`
      ).toBeNull();
    }
  });

  it("3. Verifies the 8 present properties are declared as properties in main.qml", () => {
    const content = readFileSync(QML_PATH, "utf8");
    for (const prop of presentProperties) {
      const declPattern = new RegExp(`property\\s+var\\s+${prop}\\s*:`, "m");
      expect(
        declPattern.test(content),
        `contents/ui/main.qml must declare property ${prop}`
      ).toBe(true);
    }
  });

  it("4. Authoritative runtimeMode property is defined with reconciler default", () => {
    const content = readFileSync(QML_PATH, "utf8");
    expect(content).toMatch(/property\s+string\s+runtimeMode\s*:\s*"reconciler"/);
    expect(content).toMatch(/function\s+initRuntimeMode\s*\(\)/);
  });

  it("5. Audits that no legacy property is authoritative in reconciler mode", () => {
    const content = readFileSync(QML_PATH, "utf8");
    const lines = content.split("\n");

    for (const prop of presentProperties) {
      const occurrences: number[] = [];
      lines.forEach((line, idx) => {
        if (line.includes(prop) && !line.trim().startsWith("//") && !line.includes(`property var ${prop}`)) {
          occurrences.push(idx + 1);
        }
      });

      expect(occurrences.length).toBeGreaterThan(0);

      // Verify each occurrence is either:
      // - Property initialization / cleanup (`prop = {};`, `delete prop[wid];`)
      // - Bridge to coordinator input (`normWin.isManualFloating = (floatingWindows[wid] === true);`)
      // - Transaction operation result cache (`savedTiledGeometries[wid] = ...`)
      // - Single-window snap preview guard (`preTiledWindows[opWid] === true`)
      // - Gated behind legacy fallback or helper
      for (const lineNum of occurrences) {
        const line = lines[lineNum - 1];
        if (line.includes("delete ") || line.includes(" = {};") || line.includes(" = ({});")) {
          continue;
        }

        const contextStart = Math.max(0, lineNum - 100);
        const contextEnd = Math.min(lines.length, lineNum + 30);
        const context = lines.slice(contextStart, contextEnd).join("\n");
        const isGuardedOrBridge =
          context.includes("coordinator") ||
          context.includes("runtimeMode") ||
          context.includes("retileLegacyFallback") ||
          context.includes("performReconciliation") ||
          context.includes("evaluateWindowTileability") ||
          context.includes("getTileableWindows") ||
          context.includes("toggleFloating");

        expect(
          isGuardedOrBridge,
          `Reference to "${prop}" at line ${lineNum} must not be authoritative outside a coordinator bridge or legacy fallback`
        ).toBe(true);
      }
    }
  });

  it("6. Reconciler mode delegates layout execution to coordinator without invoking legacyArrange", () => {
    const content = readFileSync(QML_PATH, "utf8");
    expect(content).toMatch(/if\s*\(runtimeMode\s*===\s*"reconciler"\)/);
    expect(content).toMatch(/if\s*\(runtimeMode\s*!==\s*"legacy-fallback"\)\s*return;/);
  });
});
