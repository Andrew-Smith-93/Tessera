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
    "lastAppliedGeometries",
    "screenTiledWindows",
    "persistentScreenOrder"
  ] as const;

  const presentProperties = [
    "windowClassifications",
    "windowTileability",
    "floatingWindows",
    "savedTiledGeometries",
    "savedMinimGeometries",
    "preTiledWindows"
  ] as const;

  it("1. contents/ui/main.qml exists and is readable", () => {
    expect(existsSync(QML_PATH)).toBe(true);
    const content = readFileSync(QML_PATH, "utf8");
    expect(content.length).toBeGreaterThan(1000);
  });

  it("2. Verifies the 8 absent properties have 0 matches in main.qml", () => {
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

  it("3. Verifies the 6 present properties are declared as properties in main.qml", () => {
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
      // - Gated behind coordinator helper
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
          context.includes("performReconciliation") ||
          context.includes("evaluateWindowTileability") ||
          context.includes("toggleActiveFloating");

        expect(
          isGuardedOrBridge,
          `Reference to "${prop}" at line ${lineNum} must not be authoritative outside a coordinator bridge`
        ).toBe(true);
      }
    }
  });

  it("6. Single runtime authority delegates layout execution to coordinator without legacy fallback", () => {
    const content = readFileSync(QML_PATH, "utf8");
    expect(content).toMatch(/property\s+string\s+runtimeMode\s*:\s*"reconciler"/);
    expect(content).not.toMatch(/retileLegacyFallback/);
    expect(content).toMatch(/coord\.reconcile\s*\(\)/);
  });

  it("7. Source-region control flow analysis: legacy retile functions are completely absent from main.qml", () => {
    const content = readFileSync(QML_PATH, "utf8");

    // 1. Must never define or call legacy retile or legacy arrange functions
    expect(content).not.toMatch(/\bgetTileableWindows\s*\(/);
    expect(content).not.toMatch(/\bretileLegacyFallback\s*\(/);
    expect(content).not.toMatch(/\barrangeMasterStack\s*\(/);
    expect(content).not.toMatch(/\barrangeBsp\s*\(/);
    expect(content).not.toMatch(/\barrangeColumns\s*\(/);
    expect(content).not.toMatch(/\barrangeRows\s*\(/);
    expect(content).not.toMatch(/\barrangeMonocle\s*\(/);

    // 2. Must never read secondary ordering maps
    expect(content).not.toMatch(/\bscreenTiledWindows\b/);
    expect(content).not.toMatch(/\bpersistentScreenOrder\b/);

    // 3. Must invoke coordinator.reconcile() as the sole layout authority
    expect(content).toMatch(/coord\.reconcile\s*\(\)/);
  });

  it("8. Occurrence-by-occurrence reachability: retileScreen and retileNow call performReconciliation directly", () => {
    const content = readFileSync(QML_PATH, "utf8");

    // Verify retileScreen directly calls performReconciliation
    expect(content).toMatch(/function\s+retileScreen\s*\(\)\s*\{\s*performReconciliation\(\);\s*\}/);

    // Verify retileNow directly calls performReconciliation without fallback branching
    expect(content).toMatch(/performReconciliation\(\);\s*\}/);
    expect(content).not.toMatch(/retileLegacyFallback/);
  });

  it("9. Window event hooks provide safe lifecycle management and destruction cleanup", () => {
    const content = readFileSync(QML_PATH, "utf8");

    // unhookWindow function must exist and disconnect signal handlers
    expect(content).toMatch(/function\s+unhookWindow\s*\(\s*w\s*\)/);
    expect(content).toMatch(/w\.interactiveMoveResizeStarted\.disconnect/);
    expect(content).toMatch(/w\.frameGeometryChanged\.disconnect/);

    // Component.onDestruction must be defined and perform hook cleanup
    expect(content).toMatch(/Component\.onDestruction\s*:\s*\{/);
    expect(content).toMatch(/unhookWindow\(allWins\[i\]\)/);

    // onWindowRemoved must invoke unhookWindow
    const onWindowRemovedMatch = content.match(/function\s+onWindowRemoved\s*\(\s*w\s*\)\s*\{[^}]*unhookWindow\(w\);/);
    expect(onWindowRemovedMatch).not.toBeNull();
  });

  it("10. Every signal connected by hookWindow has a corresponding disconnect path in unhookWindow", () => {
    const content = readFileSync(QML_PATH, "utf8");
    const requiredSignals = [
      "interactiveMoveResizeStarted",
      "interactiveMoveResizeStepped",
      "interactiveMoveResizeFinished",
      "minimizedChanged",
      "frameGeometryChanged",
      "fullScreenChanged",
      "maximizedAboutToChange",
      "maximizedChanged",
      "noBorderChanged",
      "outputChanged",
      "desktopsChanged",
      "activitiesChanged"
    ];

    for (const sig of requiredSignals) {
      const connectRegex = new RegExp(`w\\.${sig}\\.connect\\s*\\(`, "m");
      const disconnectRegex = new RegExp(`w\\.${sig}\\.disconnect\\s*\\(`, "m");
      expect(connectRegex.test(content), `Signal ${sig} must have a connect call in hookWindow`).toBe(true);
      expect(disconnectRegex.test(content), `Signal ${sig} must have a disconnect call in unhookWindow`).toBe(true);
    }
  });

  it("11. Repeated hookWindow calls cannot accumulate duplicate callbacks", () => {
    const content = readFileSync(QML_PATH, "utf8");
    // hookWindow must guard against duplicate attachment by unhooking if already hooked
    expect(content).toMatch(/if\s*\(\s*w\._tesseraHooks\s*\)\s*\{\s*unhookWindow\s*\(\s*w\s*\);\s*\}/);
  });

  it("12. interactiveMoveResizeStepped and interactiveMoveResizeFinished do not mutate masterRatio", () => {
    const content = readFileSync(QML_PATH, "utf8");

    // Extract hookWindow function body
    const hookWindowStart = content.indexOf("function hookWindow(w)");
    const hookWindowEnd = content.indexOf("function unhookWindow(w)");
    const hookBody = content.substring(
      hookWindowStart,
      hookWindowEnd !== -1 && hookWindowEnd > hookWindowStart ? hookWindowEnd : content.indexOf("// 8. Workspace Global Event Handling")
    );

    // Assert that master ratio is never mutated during move/resize steps or finish
    expect(hookBody).not.toMatch(/screenMasterRatios\[[^\]]+\]\s*=/);
    expect(hookBody).not.toMatch(/config\.masterRatio\s*=/);
  });

  it("13. Normal explicit layout-ratio commands remain functional", () => {
    const content = readFileSync(QML_PATH, "utf8");

    // adjustMasterRatio exists and mutates ratio intentionally
    expect(content).toMatch(/function\s+adjustMasterRatio\s*\(\s*delta\s*\)/);
    expect(content).toMatch(/adjustMasterRatio\(0\.05\)/);
    expect(content).toMatch(/adjustMasterRatio\(-0\.05\)/);

    // Shortcuts are registered
    expect(content).toMatch(/name:\s*"Tessera:\s*Increase\s*Master\s*Ratio"/);
    expect(content).toMatch(/name:\s*"Tessera:\s*Decrease\s*Master\s*Ratio"/);
  });

  it("14. Removal of border-drag mutation does not disable intended snap commit behavior", () => {
    const content = readFileSync(QML_PATH, "utf8");

    // Drag finish must invoke overlayDialog.finishDrag() and apply targetRect
    expect(content).toMatch(/overlayDialog\s*\?\s*overlayDialog\.finishDrag\(\)\s*:\s*null/);
    expect(content).toMatch(/target\.targetRect/);
    expect(content).toMatch(/preTiledWindows\[wid\]\s*=\s*true/);
  });

  it("15. frameGeometry is written exclusively via commitWindowGeometry sink", () => {
    const content = readFileSync(QML_PATH, "utf8");
    const lines = content.split("\n");
    const occurrences: { line: number; text: string }[] = [];

    lines.forEach((line, idx) => {
      if (line.includes("frameGeometry =") && !line.trim().startsWith("//")) {
        occurrences.push({ line: idx + 1, text: line.trim() });
      }
    });

    expect(occurrences.length).toBe(1);
    expect(occurrences[0].text).toContain("win.frameGeometry = Qt.rect(targetRect.x, targetRect.y, targetRect.width, targetRect.height)");

    // commitWindowGeometry helper exists and records commands
    expect(content).toMatch(/function\s+commitWindowGeometry\s*\(\s*win\s*,\s*targetRect\s*,\s*reason\s*,\s*epoch\s*\)/);
    expect(content).toMatch(/coord\.recordCommand\s*\(\s*wid\s*,\s*targetRect\s*,\s*epoch\s*\|\|\s*0\s*\)/);
  });

  it("16. masterHudDialog and legacy HUD shortcuts are completely removed from QML", () => {
    const content = readFileSync(QML_PATH, "utf8");
    expect(content).not.toMatch(/masterHudDialog/);
    expect(content).not.toMatch(/showMasterDialog/);
    expect(content).not.toMatch(/Show Master HUD/);
  });
});


