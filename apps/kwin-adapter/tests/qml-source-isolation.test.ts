import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const QML_PATH = resolve(__dirname, "../../../contents/ui/main.qml");
const content = readFileSync(QML_PATH, "utf8");

describe("QML source isolation and runtime authority", () => {
  const removedShadowMaps = [
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
    "lastAppliedGeometries",
  ] as const;

  it("uses the retained coordinator as the sole runtime authority", () => {
    expect(existsSync(QML_PATH)).toBe(true);
    expect(content).toMatch(/property\s+string\s+runtimeMode\s*:\s*"reconciler"/);
    expect(content).toMatch(/ReconcilerBridge\.createCoordinator/);
    expect(content).toMatch(/coord\.reconcile\s*\(\)/);
    expect(content).not.toMatch(/\.handleEvent\s*\(/);
    expect(content).not.toMatch(/invalidateAllScreens\("ReconciliationPass"\)/);
    expect(content).not.toMatch(/RulesModule/);
    for (const property of removedShadowMaps) {
      expect(content, `${property} must not survive as QML shadow authority`).not.toMatch(
        new RegExp(`\\b${property}\\b`),
      );
    }
  });

  it("contains no competing legacy retiler or layout executor", () => {
    expect(content).not.toMatch(/\bretileLegacyFallback\s*\(/);
    expect(content).not.toMatch(/\bgetTileableWindows\s*\(/);
    expect(content).not.toMatch(/\barrange(?:MasterStack|Bsp|Columns|Rows|Monocle)\s*\(/);
  });

  it("passes the complete canonical configuration into coordinator creation and updates", () => {
    const requiredKeys = [
      "defaultLayout",
      "gapInner",
      "gapOuter",
      "primaryRegionRatio",
      "primaryRegionCount",
      "perDesktopLayout",
      "ignoreMinimized",
      "gameWindowPolicy",
      "floatFilter",
      "customRules",
      "workspaceLayoutsJson",
    ];
    for (const key of requiredKeys) {
      expect(content).toContain(`${key}:`);
    }

    // Active defaults and layout lists must be canonical
    expect(content).toMatch(/defaultLayout:\s*"balanced-grid"/);
    expect(content).toMatch(/property\s+var\s+currentLayoutList:\s*\["balanced-grid",\s*"primary-stack",\s*"binary-split",\s*"columns",\s*"rows",\s*"monocle",\s*"floating"\]/);
    const legacyLayout = "ma" + "ster-stack";
    const legacyPrefix = "ma" + "ster";
    const layoutListLine = content.split("\n").find((line) => line.includes("property var currentLayoutList")) || "";
    expect(layoutListLine).not.toMatch(new RegExp(`"${legacyLayout}"|"(?:bsp|grid)"`));
    const configBlock = content.match(/property\s+var\s+config\s*:\s*\(\{([\s\S]*?)\}\)/)?.[1] || "";
    expect(configBlock).not.toMatch(new RegExp(`\\b${legacyPrefix}(?:Ratio|Count)\\b`));
    expect(content).not.toMatch(new RegExp(`config\\.${legacyPrefix}(?:Ratio|Count)\\s*=`));
    expect(content).toContain('workspaceLayoutsJson: \'{"version":1,"scopes":{}}\'');
    expect(content).toMatch(new RegExp(`readDefLayout\\s*===\\s*"${legacyLayout}"[\\s\\S]*?readDefLayout\\s*=\\s*"primary-stack"`));
    expect(content).toMatch(/function\s+getActiveLayout[\s\S]*?\|\|\s*"balanced-grid"/);
    expect(content).not.toMatch(new RegExp(`function\\s+getActiveLayout[\\s\\S]*?\\|\\|\\s*"${legacyLayout}"`));
  });

  it("uses the configured reconcile debounce interval", () => {
    expect(content).toMatch(/id:\s*reconcileTimer[\s\S]*?interval:\s*Math\.max\(0,\s*config\.reconcileDebounceMs\s*\|\|\s*0\)/);
  });

  it("synchronizes topology and active desktop state through normalized events", () => {
    expect(content).toMatch(/type:\s*"ScreenTopologyChanged"/);
    expect(content).toMatch(/type:\s*"ScreenDesktopChanged"/);
    expect(content).toMatch(/toNormalizedScreen\(scr,\s*area,\s*Workspace\.currentDesktop,\s*Workspace\.currentActivity\)/);
    expect(content).toMatch(/type:\s*"WindowDesktopsChanged"/);
    expect(content).toMatch(/type:\s*"WindowActivitiesChanged"/);

    // Factored topology synchronization helper must be called from performReconciliation and onScreensChanged
    expect(content).toMatch(/function\s+synchronizeScreenTopology\(coord\)\s*\{[\s\S]*?coord\.ingestEvent\(\{\s*type:\s*"ScreenTopologyChanged"/);
    expect(content).toMatch(/function\s+performReconciliation\(\)\s*\{[\s\S]*?synchronizeScreenTopology\(coord\)/);
    expect(content).toMatch(/function\s+onScreensChanged\(\)\s*\{[\s\S]*?synchronizeScreenTopology\(coord\)/);
    // Direct getOrCreateScreen alone without ScreenTopologyChanged inside performReconciliation cannot pass
    const reconBody = content.match(/function\s+performReconciliation\(\)\s*\{([\s\S]*?)\n\s{4}function\s+retileScreen/)?.[1] || "";
    expect(reconBody).not.toMatch(/for\s*\([^)]*screens\.length[^)]*\)[\s\S]*?coord\.getOrCreateScreen/);
  });

  it("writes frameGeometry only through the guarded normalization sink", () => {
    const assignments = content
      .split("\n")
      .filter((line) => line.includes("frameGeometry =") && !line.trim().startsWith("//"));
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toContain(
      "win.frameGeometry = Qt.rect(normalized.x, normalized.y, normalized.width, normalized.height)",
    );
    expect(content).toMatch(/function\s+commitWindowGeometry\s*\(/);
    expect(content).toMatch(/ReconcilerModule\.ReconcilerBridge\.evaluateCommitGeometry\(win,\s*targetRect,\s*bounds\)/);
    expect(content).toMatch(/coord\.recordCommand\(wid,\s*normalized,/);
    expect(content).toMatch(/outcome:\s*"applied"/);
    expect(content).toMatch(/outcome:\s*"unchanged-valid"/);
    expect(content).toMatch(/outcome:\s*"rejected"/);

    // Target-derived bounds: resolves bounds from getScreenForPos(targetRect) first
    expect(content).toMatch(/var\s+targetScr\s*=\s*getScreenForPos\(targetRect\)/);
    // Coordinator absence fails closed
    expect(content).toMatch(/var\s+coord\s*=\s*getCoordinator\(\);\s*if\s*\(!coord\)\s*\{\s*return\s*\{\s*outcome:\s*"rejected",\s*normalized:\s*null\s*\};\s*\}/);

    // Verify recordCommand occurs strictly before frameGeometry assignment
    const recordIndex = content.indexOf("coord.recordCommand(wid, normalized");
    const assignIndex = content.indexOf("win.frameGeometry = Qt.rect(");
    expect(recordIndex).toBeGreaterThan(0);
    expect(assignIndex).toBeGreaterThan(recordIndex);

    // Verify catch block rolls back the recorded command
    expect(content).toMatch(/catch\s*\(\s*err\s*\)\s*\{[\s\S]*?coord\.clearRecordedCommand\s*\(\s*wid\s*\)/);
  });

  it("ensures preview paths remain strictly write-free without frameGeometry assignment", () => {
    const previewFunctionMatch = content.match(/function\s+previewProspectiveLayout[\s\S]*?\n\s{4}\}/);
    expect(previewFunctionMatch).not.toBeNull();
    const previewBody = previewFunctionMatch![0];
    expect(previewBody).not.toContain("frameGeometry =");
    expect(previewBody).not.toContain("commitWindowGeometry");
  });

  it("guards snap and screen move logical commits against rejected geometry outcome and consumes normalized rectangle", () => {
    expect(content).toMatch(/var\s+snapResult\s*=\s*commitWindowGeometry\(w,\s*target\.targetRect,\s*"snap_drop"\);[\s\S]*?if\s*\(\s*snapResult\.outcome\s*!==\s*"rejected"\s*&&\s*snapResult\.normalized\s*\)/);
    expect(content).toMatch(/WindowSnapCommitted[\s\S]*?targetRect:\s*\{[\s\S]*?x:\s*snapResult\.normalized\.x/);
    expect(content).toMatch(/setSavedTiledGeometry\(wid,\s*snapResult\.normalized\)/);
    expect(content).toMatch(/var\s+moveResult\s*=\s*commitWindowGeometry\(w,\s*\{[\s\S]*?\},\s*"move_screen"\);[\s\S]*?if\s*\(\s*moveResult\.outcome\s*!==\s*"rejected"\s*\)/);
    expect(content).toMatch(/var\s+reconResult\s*=\s*commitWindowGeometry\(targetWin,\s*op\.targetRect,\s*"reconciliation",\s*op\.epoch\);[\s\S]*?if\s*\(\s*reconResult\.outcome\s*!==\s*"rejected"\s*&&\s*reconResult\.normalized\s*\)/);
    expect(content).toMatch(/setSavedTiledGeometry\(opWid,\s*reconResult\.normalized\)/);

    // Coordinator isPreTiled/setPreTiled authority preserves single-window snap
    expect(content).toMatch(/snapResult\.outcome\s*!==\s*"rejected"[\s\S]*?coordinator\.setPreTiled\(wid,\s*true\)/);
    expect(content).toMatch(/onMaximizedChanged[\s\S]*?coord\.setPreTiled\(wid,\s*false\)/);
    expect(content).toMatch(/toggleActiveFloating[\s\S]*?coord\.setPreTiled\(wid,\s*false\)/);
    expect(content).toMatch(/reconResult\.outcome\s*!==\s*"rejected"[\s\S]*?coord\.setPreTiled\(opWid,\s*false\)/);
    expect(content).toMatch(/if\s*\(\s*allWins\.length\s*===\s*1\s*&&\s*coord\.isPreTiled\(opWid\)\s*\)\s*\{\s*continue;\s*\}/);
  });

  it("uses canonical primary configuration event field names and bounds", () => {
    expect(content).toMatch(/type:\s*"WorkspacePrimaryConfigChanged"[\s\S]*?ratio:\s*newRatio/);
    expect(content).toMatch(/type:\s*"WorkspacePrimaryConfigChanged"[\s\S]*?count:\s*newCount/);
    expect(content).not.toMatch(/type:\s*"WorkspacePrimaryConfigChanged"[\s\S]{0,180}primaryRegion(?:Ratio|Count):/);
    expect(content).toContain("Math.max(0.1, Math.min(0.9, currentRatio + delta))");
    expect(content).toContain("Math.max(0, Math.min(10, currentCount + delta))");
  });

  it("has symmetric hook lifecycle cleanup", () => {
    const signals = [
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
      "activitiesChanged",
    ];
    for (const signal of signals) {
      expect(content).toMatch(new RegExp(`w\\.${signal}\\.connect\\s*\\(`));
      expect(content).toMatch(new RegExp(`w\\.${signal}\\.disconnect\\s*\\(`));
    }
    expect(content).toMatch(/function\s+onWindowRemoved\s*\([^)]*\)\s*\{[\s\S]*?unhookWindow\(w\)/);
    expect(content).toMatch(/Component\.onDestruction\s*:/);
  });

  it("keeps removed HUD and duplicate alternative shortcuts absent", () => {
    expect(content).not.toMatch(/masterHudDialog|showMasterDialog|Show Master HUD/);
    expect(content).not.toMatch(/Meta\+Shift\+F/);
  });
});
