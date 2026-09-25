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
    expect(content).not.toMatch(/\bproperty\s+var\s+currentLayoutList\b/);
    const legacyLayout = "ma" + "ster-stack";
    const legacyPrefix = "ma" + "ster";
    expect(content).not.toMatch(/\bfunction\s+cycleLayout\b/);
    expect(content).not.toMatch(/\bfunction\s+(?:cycleOtherScreenLayout|swapScreenLayouts)\b/);
    const configBlock = content.match(/property\s+var\s+config\s*:\s*\(\{([\s\S]*?)\}\)/)?.[1] || "";
    expect(configBlock).not.toMatch(new RegExp(`\\b${legacyPrefix}(?:Ratio|Count)\\b`));
    expect(content).not.toMatch(new RegExp(`config\\.${legacyPrefix}(?:Ratio|Count)\\s*=`));
    expect(content).toContain('workspaceLayoutsJson: \'{"version":1,"scopes":{}}\'');
    expect(content).toMatch(new RegExp(`readDefLayout\\s*===\\s*"${legacyLayout}"[\\s\\S]*?readDefLayout\\s*=\\s*"balanced-grid"`));
    expect(content).not.toMatch(/\bfunction\s+getActiveLayout\b/);
    expect(content).not.toMatch(/\bfunction\s+setActiveLayout\b/);
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
    // Frame geometry is assigned only through commitWindowGeometry and the windowAnimator
    expect(assignments.length).toBe(4);
    expect(assignments.some((l) => l.includes("Qt.rect(normalized.x, normalized.y, normalized.width, normalized.height)"))).toBe(true);
    expect(assignments.every((l) => l.includes("win.frameGeometry = Qt.rect("))).toBe(true);
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
    const assignIndex = content.indexOf("win.frameGeometry = Qt.rect(", recordIndex);
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

  it("has retired primary ratio and count controls and dead helpers from main.qml", () => {
    expect(content).not.toContain("function adjustMasterRatio");
    expect(content).not.toContain("function adjustMasterCount");
    expect(content).not.toContain("adjustPrimaryRatio");
    expect(content).not.toMatch(/ShortcutHandler[\s\S]*?Tessera: (?:Increase|Decrease) Primary Ratio/);
    expect(content).not.toMatch(/type:\s*"WorkspacePrimaryConfigChanged"/);
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
    expect(content).not.toMatch(/Meta\+Shift\+M/);
  });

  it("configures overlayDialog with correct PlasmaCore.Dialog API and 12-zone rendering", () => {
    // PlasmaCore.Dialog API correctness
    expect(content).toMatch(/mainItem:\s*Item\s*\{\s*id:\s*overlayContainer/);
    expect(content).not.toMatch(/flags:[\s\S]*?Qt\.Popup/);
    expect(content).toMatch(/hideOnWindowDeactivate:\s*false/);
    expect(content).toMatch(/function\s+showOverlay\(w\)\s*\{[\s\S]*?computeZones\(w\);[\s\S]*?overlayActive\s*=\s*true;/);

    // Fallback computes all 12 zones with correct IDs
    const zoneIds = [
      "maximize",
      "left-half",
      "right-half",
      "top-left",
      "bottom-left",
      "top-right",
      "bottom-right",
      "left-pillar",
      "center-pillar",
      "center-top",
      "center-bottom",
      "right-pillar",
    ];
    for (const id of zoneIds) {
      expect(content).toMatch(new RegExp(`id:\\s*"${id}"`));
    }

    // UI repeaters render all 12 zones including pillars 7 to 11
    expect(content).toMatch(/overlayDialog\.snapZones\.length\s*>=\s*12/);
    expect(content).toMatch(/overlayDialog\.snapZones\[7\]/);
    expect(content).toMatch(/overlayDialog\.snapZones\[11\]/);
  });

  it("enforces PlasmaCore.Dialog sizing contract and virtual origin coordinates", () => {
    // 1. PlasmaCore.Dialog must not set explicit width or height properties directly on Dialog
    const dialogHeader = content.match(/PlasmaCore\.Dialog\s*\{\s*id:\s*overlayDialog[\s\S]*?mainItem:\s*Item/)?.[0] || "";
    expect(dialogHeader).not.toMatch(/^\s*(?:width|height)\s*:/m);

    // 2. showOverlay must not imperatively assign dialog width or height
    const showOverlayBlock = content.match(/function\s+showOverlay\(w\)\s*\{([\s\S]*?)\n\s{8}\}/)?.[1] || "";
    expect(showOverlayBlock).not.toMatch(/\b(?:overlayDialog\.)?(?:width|height)\s*=/);
    expect(showOverlayBlock).not.toMatch(/\bset(?:Width|Height)\s*\(/);

    // 3. mainItem must not use anchors.fill: parent (PlasmaCore.Dialog resizes to mainItem; anchors.fill causes 0x0 or size loop)
    const mainItemBlock = content.match(/mainItem:\s*Item\s*\{\s*id:\s*overlayContainer[\s\S]*?Timer\s*\{/)?.[0] || "";
    expect(mainItemBlock).not.toMatch(/anchors\.fill\s*:\s*parent/);

    // 4. mainItem must have explicit virtual dimensions bound to virtualWidth/virtualHeight
    expect(mainItemBlock).toMatch(/width:\s*overlayDialog\.virtualWidth/);
    expect(mainItemBlock).toMatch(/height:\s*overlayDialog\.virtualHeight/);

    // 5. overlayDialog coordinates must bind to virtual origin
    expect(content).toMatch(/x:\s*originX/);
    expect(content).toMatch(/y:\s*originY/);

    // 6. All 4 zone card delegates must translate coordinates relative to overlayDialog.originX and originY
    expect(content).toMatch(/Top Maximize Card[\s\S]*?x:\s*modelData\s*\?\s*\(modelData\.rect\.x\s*-\s*overlayDialog\.originX\)\s*:\s*0/);
    expect(content).toMatch(/Top Maximize Card[\s\S]*?y:\s*modelData\s*\?\s*\(modelData\.rect\.y\s*-\s*overlayDialog\.originY\)\s*:\s*0/);
    expect(content).toMatch(/Split Zones[\s\S]*?x:\s*modelData\s*\?\s*\(modelData\.rect\.x\s*-\s*overlayDialog\.originX\)\s*:\s*0/);
    expect(content).toMatch(/Split Zones[\s\S]*?y:\s*modelData\s*\?\s*\(modelData\.rect\.y\s*-\s*overlayDialog\.originY\)\s*:\s*0/);
    expect(content).toMatch(/Quarters in the 4 Corners[\s\S]*?x:\s*modelData\s*\?\s*\(modelData\.rect\.x\s*-\s*overlayDialog\.originX\)\s*:\s*0/);
    expect(content).toMatch(/Quarters in the 4 Corners[\s\S]*?y:\s*modelData\s*\?\s*\(modelData\.rect\.y\s*-\s*overlayDialog\.originY\)\s*:\s*0/);
    expect(content).toMatch(/3-Pillar Zones[\s\S]*?x:\s*modelData\s*\?\s*\(modelData\.rect\.x\s*-\s*overlayDialog\.originX\)\s*:\s*0/);
    expect(content).toMatch(/3-Pillar Zones[\s\S]*?y:\s*modelData\s*\?\s*\(modelData\.rect\.y\s*-\s*overlayDialog\.originY\)\s*:\s*0/);
  });

  it("enforces pre-mapped click-through overlay architecture and logical active state isolation", () => {
    // 1. overlayDialog must be pre-mapped (visible: true) at component creation
    const dialogHeader = content.match(/PlasmaCore\.Dialog\s*\{\s*id:\s*overlayDialog[\s\S]*?mainItem:\s*Item/)?.[0] || "";
    expect(dialogHeader).toMatch(/visible:\s*true/);
    expect(dialogHeader).toMatch(/outputOnly:\s*true/);
    expect(dialogHeader).toMatch(/type:\s*PlasmaCore\.Dialog\.OnScreenDisplay/);
    expect(dialogHeader).toMatch(/flags:\s*Qt\.BypassWindowManagerHint\s*\|\s*Qt\.FramelessWindowHint/);
    expect(dialogHeader).toMatch(/backgroundHints:\s*PlasmaCore\.Types\.NoBackground/);
    expect(dialogHeader).toMatch(/hideOnWindowDeactivate:\s*false/);
    expect(dialogHeader).toMatch(/property\s+bool\s+overlayActive:\s*false/);

    // 2. showOverlay and hideOverlay must manipulate overlayActive, NOT visible
    const showOverlayBlock = content.match(/function\s+showOverlay\(w\)\s*\{([\s\S]*?)\n\s{8}\}/)?.[1] || "";
    expect(showOverlayBlock).toMatch(/overlayActive\s*=\s*true/);
    expect(showOverlayBlock).not.toMatch(/\bvisible\s*=/);

    const hideOverlayBlock = content.match(/function\s+hideOverlay\(\)\s*\{([\s\S]*?)\n\s{8}\}/)?.[1] || "";
    expect(hideOverlayBlock).toMatch(/overlayActive\s*=\s*false/);
    expect(hideOverlayBlock).not.toMatch(/\bvisible\s*=/);

    // 3. overlayTimer must run on overlayActive, NOT on overlayDialog.visible (prevents runaway polling while pre-mapped)
    const mainItemBlock = content.match(/mainItem:\s*Item\s*\{\s*id:\s*overlayContainer[\s\S]*?Timer\s*\{[\s\S]*?\n\s{12}\}/)?.[0] || "";
    expect(mainItemBlock).toMatch(/running:\s*overlayDialog\.overlayActive/);
    expect(mainItemBlock).not.toMatch(/running:\s*overlayDialog\.visible/);

    // 4. toggleOverlay must branch on overlayActive, NOT on visible (prevents hotkey toggle failure)
    const toggleOverlayBlock = content.match(/function\s+toggleOverlay\(\)\s*\{([\s\S]*?)\n\s{4}\}/)?.[1] || "";
    expect(toggleOverlayBlock).toMatch(/if\s*\(\s*overlayDialog\.overlayActive\s*\)/);
    expect(toggleOverlayBlock).not.toMatch(/if\s*\(\s*overlayDialog\.visible\s*\)/);

    // 5. onMoveResizeStepped must check overlayActive, NOT visible
    const steppedBlock = content.match(/var\s+onMoveResizeStepped\s*=\s*function\(\)\s*\{([\s\S]*?)\n\s{8}\};/)?.[1] || "";
    expect(steppedBlock).toMatch(/overlayDialog\.overlayActive/);
    expect(steppedBlock).not.toMatch(/overlayDialog\.visible/);

    // 6. Visual content must be transparent/disabled when idle
    expect(content).toMatch(/opacity:\s*overlayDialog\.overlayActive\s*\?\s*1\.0\s*:\s*0\.0/);
    expect(content).toMatch(/color:\s*Qt\.rgba\(0,\s*0,\s*0,\s*0\.20\)[\s\S]*?visible:\s*overlayDialog\.overlayActive/);

    // 7. Zone repeaters must gate models on overlayActive
    expect(content).toMatch(/Top Maximize Card[\s\S]*?model:\s*\(overlayDialog\.overlayActive/);
    expect(content).toMatch(/Split Zones[\s\S]*?model:\s*\(overlayDialog\.overlayActive/);
    expect(content).toMatch(/Quarters in the 4 Corners[\s\S]*?model:\s*\(overlayDialog\.overlayActive/);
    expect(content).toMatch(/3-Pillar Zones[\s\S]*?model:\s*\(overlayDialog\.overlayActive/);
  });

  it("regression: fails validation on legacy overlay patterns (size-loop and raw coordinates)", () => {
    function auditOverlayQml(qml: string): { valid: boolean; errors: string[] } {
      const errors: string[] = [];
      const dialogHeader = qml.match(/PlasmaCore\.Dialog\s*\{\s*id:\s*overlayDialog[\s\S]*?(?:mainItem:\s*)?Item\s*\{/)?.[0] || "";
      if (/^\s*(?:width|height)\s*:/m.test(dialogHeader)) {
        errors.push("PlasmaCore.Dialog must not declare width or height properties directly");
      }
      const showOverlayBlock = qml.match(/function\s+showOverlay\(w\)\s*\{([\s\S]*?)\n\s{8}\}/)?.[1] || "";
      if (/\b(?:overlayDialog\.)?(?:width|height)\s*=/.test(showOverlayBlock) || /\bset(?:Width|Height)\s*\(/.test(showOverlayBlock)) {
        errors.push("showOverlay must not assign width or height on PlasmaCore.Dialog");
      }
      const mainItemBlock = qml.match(/(?:mainItem:\s*)?Item\s*\{\s*id:\s*overlayContainer[\s\S]*?Timer\s*\{/)?.[0] || "";
      if (/anchors\.fill\s*:\s*parent/.test(mainItemBlock)) {
        errors.push("overlayContainer must not use anchors.fill: parent");
      }
      if (!/width:\s*overlayDialog\.virtualWidth/.test(mainItemBlock) || !/height:\s*overlayDialog\.virtualHeight/.test(mainItemBlock)) {
        errors.push("overlayContainer must explicitly set width and height to virtual screen dimensions");
      }
      if (!/x:\s*modelData\s*\?\s*\(modelData\.rect\.x\s*-\s*overlayDialog\.originX\)/.test(qml)) {
        errors.push("Card delegates must subtract overlayDialog.originX");
      }
      return { valid: errors.length === 0, errors };
    }

    // 1. Current worktree QML passes audit with zero errors
    const currentAudit = auditOverlayQml(content);
    expect(currentAudit.valid).toBe(true);
    expect(currentAudit.errors).toEqual([]);

    // 2. Legacy source patterns fail audit with all expected structural violations
    const legacyQmlSnippet = `
    PlasmaCore.Dialog {
        id: overlayDialog
        width: Workspace.virtualScreenSize ? Workspace.virtualScreenSize.width : 1920
        height: Workspace.virtualScreenSize ? Workspace.virtualScreenSize.height : 1080
        function showOverlay(w) {
            visible = true;
            setWidth(Workspace.virtualScreenSize.width);
            setHeight(Workspace.virtualScreenSize.height);
            hoveredZoneIndex = -1;
            computeZones(w);
        }
        Item {
            id: overlayContainer
            anchors.fill: parent
            Timer { id: overlayTimer }
            Rectangle {
                x: modelData ? modelData.rect.x : 0
                y: modelData ? modelData.rect.y : 0
            }
        }
    }
    `;
    const legacyAudit = auditOverlayQml(legacyQmlSnippet);
    expect(legacyAudit.valid).toBe(false);
    expect(legacyAudit.errors).toContain("PlasmaCore.Dialog must not declare width or height properties directly");
    expect(legacyAudit.errors).toContain("showOverlay must not assign width or height on PlasmaCore.Dialog");
    expect(legacyAudit.errors).toContain("overlayContainer must not use anchors.fill: parent");
    expect(legacyAudit.errors).toContain("overlayContainer must explicitly set width and height to virtual screen dimensions");
    expect(legacyAudit.errors).toContain("Card delegates must subtract overlayDialog.originX");
  });

  it("distinguishes D-Bus isScriptLoaded registration from runtime QML initialization", () => {
    // Assert documentation and contract consistency:
    // isScriptLoaded flag toggles when KWin's scripting manager registers the script ID,
    // but does NOT prove ECMAScript evaluation or QML root object instantiation.
    const docsTroubleshooting = readFileSync(resolve(__dirname, "../../../docs/TROUBLESHOOTING.md"), "utf8");
    const checklist = readFileSync(resolve(__dirname, "../../../docs/PUBLIC_RELEASE_CHECKLIST.md"), "utf8");

    expect(docsTroubleshooting).toMatch(/isScriptLoaded:\s*true.*fails to initialize the QML root object/);
    expect(checklist).toMatch(/isScriptLoaded.*registration alone does not prove QML evaluation succeeded/);
    expect(checklist).toMatch(/overlay allocation remain(?:s)?\s*(?:\*\*)?NOT PROVEN/);
  });

  it("enforces crash-safe teardown contract in Component.onDestruction without dead Workspace singleton access", () => {
    const destructionBlock = content.match(/Component\.onDestruction\s*:\s*\{([\s\S]*?)\n\s{4}\}/)?.[1] || "";
    expect(destructionBlock).not.toMatch(/\bWorkspace\b/);
    expect(destructionBlock).toMatch(/reconcileTimer\.stop\(\)/);
    expect(destructionBlock).toMatch(/cancelAllAnimations\(false\)/);
    expect(destructionBlock).toMatch(/overlayDialog\.hideOverlay\(\)/);
  });
});
