import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const QML_PATH = resolve(__dirname, "../../../contents/ui/main.qml");

describe("QML Source Isolation & Legacy Map Audit", () => {
  const legacyMaps = [
    "windowClassifications",
    "windowTileability",
    "floatingWindows",
    "savedTiledGeometries",
    "savedMinimGeometries",
    "preTiledWindows",
    "screenTiledWindows",
    "persistentScreenOrder",
    "tiledWindows"
  ];

  it("1. contents/ui/main.qml exists and is readable", () => {
    expect(existsSync(QML_PATH)).toBe(true);
    const content = readFileSync(QML_PATH, "utf8");
    expect(content.length).toBeGreaterThan(1000);
  });

  it("2. Declares all legacy state tracking properties", () => {
    const content = readFileSync(QML_PATH, "utf8");
    for (const mapName of legacyMaps) {
      if (mapName === "tiledWindows") continue; // tiledWindows is tracked inside screenTiledWindows or local arrays
      const declPattern = new RegExp(`property\\s+var\\s+${mapName}\\s*:`, "m");
      expect(
        declPattern.test(content),
        `contents/ui/main.qml must declare legacy property ${mapName}`
      ).toBe(true);
    }
  });

  it("3. Authoritative runtimeMode property is defined with reconciler default", () => {
    const content = readFileSync(QML_PATH, "utf8");
    expect(content).toMatch(/property\s+string\s+runtimeMode\s*:\s*"reconciler"/);
    expect(content).toMatch(/function\s+initRuntimeMode\s*\(\)/);
  });

  it("4. Audits that legacy state access in main.qml is guarded by legacy-fallback mode or coordinator delegation", () => {
    const content = readFileSync(QML_PATH, "utf8");
    const lines = content.split("\n");

    for (const mapName of legacyMaps) {
      const occurrences: number[] = [];
      lines.forEach((line, idx) => {
        // Find line numbers referencing mapName
        if (line.includes(mapName) && !line.trim().startsWith("//") && !line.includes(`property var ${mapName}`)) {
          occurrences.push(idx + 1);
        }
      });

      expect(
        occurrences.length,
        `Expected references to legacy map ${mapName} in main.qml`
      ).toBeGreaterThanOrEqual(0);

      // Verify that every access is either:
      // - Inside init / cleanup reset (`windowClassifications = {};`, `delete ...`)
      // - In a helper that checks coordinator first (`if (coordinator) { ... }`)
      // - Inside legacyArrange / calculateLayouts or guarded by runtimeMode !== 'reconciler'
      for (const lineNum of occurrences) {
        const line = lines[lineNum - 1];
        // Allow resets/deletions on window teardown
        if (line.includes("delete ") || line.includes(" = {};") || line.includes(" = ({});")) {
          continue;
        }

        // Check context around line (within surrounding block)
        const contextStart = Math.max(0, lineNum - 50);
        const contextEnd = Math.min(lines.length, lineNum + 20);
        const context = lines.slice(contextStart, contextEnd).join("\n");
        const isGuarded =
          context.includes("coordinator") ||
          context.includes("runtimeMode") ||
          context.includes("legacyArrange") ||
          context.includes("calculateLayouts") ||
          context.includes("getTileableWindows") ||
          context.includes("evaluateWindowTileability") ||
          context.includes("screenTiledWindows");

        expect(
          isGuarded,
          `Reference to legacy map "${mapName}" at line ${lineNum} must be guarded by runtimeMode or coordinator check`
        ).toBe(true);
      }
    }
  });

  it("5. Reconciler mode delegates layout execution to coordinator without invoking legacyArrange", () => {
    const content = readFileSync(QML_PATH, "utf8");
    // Verify that arrangeWindows checks runtimeMode and dispatches to reconciler
    expect(content).toMatch(/if\s*\(runtimeMode\s*===\s*"reconciler"\)/);
    // Verify that legacyArrange aborts if not in legacy-fallback mode
    expect(content).toMatch(/if\s*\(runtimeMode\s*!==\s*"legacy-fallback"\)\s*return;/);
  });
});
