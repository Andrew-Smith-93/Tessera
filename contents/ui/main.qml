import QtQuick
import QtQuick.Layouts
import org.kde.kwin
import org.kde.plasma.core as PlasmaCore

import "../code/layouts.js" as LayoutsModule
import "../code/rules.js" as RulesModule
import "../code/reconciler.js" as ReconcilerModule

Item {
    id: root

    // =========================================================================
    // 1. Configuration Properties
    // =========================================================================
    property var config: ({
        enableTiling: true,
        defaultLayout: "master-stack",
        gapInner: 8,
        gapOuter: 10,
        masterRatio: 0.50,
        masterCount: 1,
        perDesktopLayout: true,
        tileNewWindows: true,
        showOsd: true,
        nvidiaDebounceMs: 60,
        smoothResize: false,
        ignoreMinimized: true,
        gameWindowPolicy: "floating",
        floatFilter: "tessera,tessera-settings,tessera_settings.py",
        customRulesJson: "[]",
        desktopLayoutsJson: "{}"
    })

    // =========================================================================
    // 2. State Tracking
    // =========================================================================
    property var desktopLayouts: ({})
    property var floatingWindows: ({})   // windowId -> boolean (manual float)
    property var preTiledWindows: ({})   // windowId -> boolean (single-window snap)
    property var screenTiledWindows: ({}) // screenName -> array of windows
    property var savedTiledGeometries: ({}) // windowId -> Qt.rect
    property var savedMinimGeometries: ({}) // windowId -> Qt.rect
    property var wasDraggingMaximized: ({}) // windowId -> boolean
    property var persistentScreenOrder: ({}) // screenName -> array of windowIds
    property var currentLayoutList: ["master-stack", "bsp", "columns", "rows", "grid", "monocle", "floating"]
    property var windowClassifications: ({}) // windowId -> classification string
    property var windowTileability: ({})     // windowId -> boolean
    property bool isArranging: false
    property var currentDraggingWindow: null

    // Runtime Mode: "reconciler" | "legacy-fallback" (strictly exclusive)
    property string runtimeMode: "reconciler"

    function initRuntimeMode() {
        try {
            var coord = getCoordinator();
            if (coord) {
                runtimeMode = "reconciler";
                log("Runtime mode initialized: reconciler");
                return;
            }
        } catch (e) {
            log("Reconciler initialization failed, falling back to legacy: " + e);
        }
        runtimeMode = "legacy-fallback";
        log("Runtime mode initialized: legacy-fallback");
    }

    function getSavedTiledGeometry(wid) {
        if (coordinator) {
            var g = coordinator.getSavedTiledGeometry(wid);
            if (g) return Qt.rect(g.x, g.y, g.width, g.height);
        }
        return savedTiledGeometries[wid] || null;
    }

    function setSavedTiledGeometry(wid, rect) {
        if (!rect) return;
        savedTiledGeometries[wid] = Qt.rect(rect.x, rect.y, rect.width, rect.height);
        if (coordinator) {
            coordinator.setSavedTiledGeometry(wid, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }
    }

    function getPreMinimizeGeometry(wid) {
        if (coordinator) {
            var g = coordinator.getPreMinimizeGeometry(wid);
            if (g) return Qt.rect(g.x, g.y, g.width, g.height);
        }
        return savedMinimGeometries[wid] || null;
    }

    function setPreMinimizeGeometry(wid, rect) {
        if (!rect) return;
        savedMinimGeometries[wid] = Qt.rect(rect.x, rect.y, rect.width, rect.height);
        if (coordinator) {
            coordinator.setPreMinimizeGeometry(wid, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }
    }

    function log(msg) {
        console.log("[Tessera] " + msg);
    }

    function getWindowId(w) {
        if (!w) return "";
        return w.internalId ? w.internalId.toString() : (w.caption + "_" + (w.resourceClass || ""));
    }

    function getScreenName(scr) {
        return scr ? (scr.name || "default") : "default";
    }

    function getScreenForPos(rect) {
        var screens = Workspace.screens || [Workspace.activeScreen];
        if (!screens || screens.length === 0) return Workspace.activeScreen;
        var cx = rect.x + Math.floor((rect.width || 10) / 2);
        var cy = rect.y + Math.floor((rect.height || 10) / 2);

        if (typeof ReconcilerModule !== "undefined" && ReconcilerModule.resolveCursorTargetScreen) {
            var normScreens = [];
            for (var s = 0; s < screens.length; s++) {
                var scr = screens[s];
                if (!scr) continue;
                var a = Workspace.clientArea(KWin.MaximizeArea, scr, Workspace.currentDesktop);
                normScreens.push(ReconcilerModule.toNormalizedScreen(scr, a));
            }
            if (normScreens.length > 0) {
                var target = ReconcilerModule.resolveCursorTargetScreen(normScreens, { x: cx, y: cy }, getScreenName(Workspace.activeScreen));
                for (var i = 0; i < screens.length; i++) {
                    if (getScreenName(screens[i]) === target.outputId) {
                        return screens[i];
                    }
                }
            }
        }

        for (var i = 0; i < screens.length; i++) {
            var a = Workspace.clientArea(KWin.MaximizeArea, screens[i], Workspace.currentDesktop);
            if (cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height) {
                return screens[i];
            }
        }
        return Workspace.activeScreen || screens[0];
    }

    // =========================================================================
    // 3. Configuration Loading & Real-Time Synchronization
    // =========================================================================
    function loadConfig() {
        config.enableTiling = KWin.readConfig("enableTiling", true);
        config.defaultLayout = KWin.readConfig("defaultLayout", "master-stack");
        config.gapInner = KWin.readConfig("gapInner", 8);
        config.gapOuter = KWin.readConfig("gapOuter", 10);
        config.masterRatio = KWin.readConfig("masterRatio", 0.50);
        config.masterCount = KWin.readConfig("masterCount", 1);
        config.perDesktopLayout = KWin.readConfig("perDesktopLayout", true);
        config.tileNewWindows = KWin.readConfig("tileNewWindows", true);
        config.showOsd = KWin.readConfig("showOsd", true);
        config.nvidiaDebounceMs = KWin.readConfig("nvidiaDebounceMs", 60);
        config.overlayPollingMs = KWin.readConfig("overlayPollingMs", 16);
        config.smoothResize = KWin.readConfig("smoothResize", false);
        config.ignoreMinimized = KWin.readConfig("ignoreMinimized", true);
        config.gameWindowPolicy = KWin.readConfig("gameWindowPolicy", "floating");
        config.floatFilter = KWin.readConfig("floatFilter", "tessera,tessera-settings,tessera_settings.py");
        config.customRulesJson = KWin.readConfig("customRulesJson", "[]");
        config.desktopLayoutsJson = KWin.readConfig("desktopLayoutsJson", "{}");

        try {
            desktopLayouts = JSON.parse(config.desktopLayoutsJson || "{}");
        } catch (e) {
            desktopLayouts = {};
        }

        windowClassifications = {};
        windowTileability = {};

        var allWins = Workspace.stackingOrder || [];
        for (var i = 0; i < allWins.length; i++) {
            hookWindow(allWins[i]);
        }
        if (coordinator) {
            coordinator.updateConfig({
                enableTiling: config.enableTiling,
                defaultLayout: config.defaultLayout,
                gapInner: config.gapInner,
                gapOuter: config.gapOuter,
                masterRatio: config.masterRatio,
                masterCount: config.masterCount,
                ignoreMinimized: config.ignoreMinimized,
                gameWindowPolicy: config.gameWindowPolicy || "floating",
                floatFilter: config.floatFilter,
                customRules: config.customRulesJson
            });
        }

        log("Config reloaded live: gaps=" + config.gapInner + "/" + config.gapOuter + " ratio=" + config.masterRatio + " tiling=" + config.enableTiling);
    }

    // Listen to KWin options.configChanged (fires on org.kde.KWin.reconfigure)
    Connections {
        target: Options
        function onConfigChanged() {
            log("Options.configChanged signal detected!");
            loadConfig();
            retileNow();
        }
    }

    // Native Plasma OSD banner
    DBusCall {
        id: osdCall
        service: "org.kde.plasmashell"
        path: "/org/kde/osdService"
        method: "showText"

        function notify(text, icon) {
            if (!config.showOsd) return;
            arguments = [icon || "preferences-desktop-virtual", "Tessera: " + text];
            call();
        }
    }

    function getCurrentDesktopKey() {
        if (!config.perDesktopLayout) return "global";
        var desk = Workspace.currentDesktop;
        return desk ? (desk.id || desk.name || desk.toString()) : "default";
    }

    property var screenLayouts: ({})      // screenName:desktopKey -> layoutName
    property var screenMasterRatios: ({}) // screenName -> master ratio
    property var screenMasterCounts: ({}) // screenName -> master count

    function getCurrentTargetScreen() {
        // 1. First priority: Screen containing the mouse cursor (where user is physically interacting)
        var curPos = Workspace.cursorPos;
        if (curPos) {
            var mouseScreen = getScreenForPos({x: curPos.x, y: curPos.y, width: 1, height: 1});
            if (mouseScreen) return mouseScreen;
        }
        // 2. Second priority: Screen containing the currently focused active window
        if (Workspace.activeWindow && Workspace.activeWindow.normalWindow) {
            return getScreenForPos(Workspace.activeWindow.frameGeometry);
        }
        // 3. Fallback: Workspace.activeScreen
        return Workspace.activeScreen || (Workspace.screens ? Workspace.screens[0] : null);
    }

    function getLayoutKey(screen) {
        var scr = screen || getCurrentTargetScreen();
        var sName = getScreenName(scr);
        var deskKey = getCurrentDesktopKey();
        return sName + ":" + deskKey;
    }

    function getActiveLayout(screen) {
        var scr = screen || getCurrentTargetScreen();
        var key = getLayoutKey(scr);
        return screenLayouts[key] || desktopLayouts[getCurrentDesktopKey()] || config.defaultLayout || "master-stack";
    }

    function setActiveLayout(layoutName, screen) {
        var scr = screen || getCurrentTargetScreen();
        var key = getLayoutKey(scr);
        screenLayouts[key] = layoutName;
        desktopLayouts[getCurrentDesktopKey()] = layoutName;
        var sLabel = scr ? (scr.name || "Screen") : "Screen";
        osdCall.notify(sLabel + " Layout: " + layoutName.toUpperCase(), "preferences-desktop-virtual");
        retileNow();
    }

    function cycleLayout(forward) {
        var scr = getCurrentTargetScreen();
        var current = getActiveLayout(scr);
        var idx = currentLayoutList.indexOf(current);
        if (idx === -1) idx = 0;

        if (forward) {
            idx = (idx + 1) % currentLayoutList.length;
        } else {
            idx = (idx - 1 + currentLayoutList.length) % currentLayoutList.length;
        }
        setActiveLayout(currentLayoutList[idx], scr);
    }

    // =========================================================================
    // 4. Window Filtering ("Tile Everything Period")
    // =========================================================================
    function isWindowOnCurrentDesktop(w) {
        if (!w) return false;
        if (w.onAllDesktops) return true;
        if (w.desktops && w.desktops.length > 0) {
            for (var i = 0; i < w.desktops.length; i++) {
                if (w.desktops[i] === Workspace.currentDesktop) return true;
            }
            return false;
        }
        return true;
    }

    function evaluateWindowTileability(w) {
        if (!w) return { changed: false, isTileable: false };
        var screen = w.output || getScreenForPos(w.frameGeometry);
        var screenArea = screen ? Workspace.clientArea(KWin.MaximizeArea, screen, Workspace.currentDesktop) : null;
        var result = RulesModule.RuleEngine.classify(w, {
            userFilterString: config.floatFilter,
            customRules: config.customRulesJson,
            gameWindowPolicy: config.gameWindowPolicy || "floating",
            outputGeometry: screen ? screen.geometry : null,
            outputUsableArea: screenArea
        });

        var wid = getWindowId(w);
        var prevClassification = windowClassifications[wid];
        var prevTileable = windowTileability[wid];
        var isTileable = (result.classification === "tiled");

        windowClassifications[wid] = result.classification;
        windowTileability[wid] = isTileable;

        var changed = (prevTileable !== undefined && prevTileable !== isTileable) ||
                      (prevClassification !== undefined && prevClassification !== result.classification);

        return {
            changed: changed,
            isTileable: isTileable,
            classification: result.classification,
            previousClassification: prevClassification,
            result: result
        };
    }

    function checkFilter(w) {
        if (!w) return false;
        var evalRes = evaluateWindowTileability(w);
        return evalRes.isTileable;
    }

    function getTileableWindows(screen) {
        var allWindows = Workspace.stackingOrder || [];
        var tileables = [];
        var sName = getScreenName(screen);

        for (var i = 0; i < allWindows.length; i++) {
            var w = allWindows[i];
            if (!w || !checkFilter(w)) continue;
            if (!isWindowOnCurrentDesktop(w)) continue;

            // Check screen affinity by actual physical center coordinates (never stale w.output)
            var wScreen = getScreenForPos(w.frameGeometry);
            if (sName && getScreenName(wScreen) !== sName) continue;

            var wid = getWindowId(w);
            if (floatingWindows[wid] === true) continue;

            if (config.ignoreMinimized && w.minimized) continue;

            tileables.push(w);
        }

        // Maintain persistent slot order per screen so windows NEVER swap on minimize/restore!
        var persistentOrder = persistentScreenOrder[sName] || [];
        var newOrder = [];

        var activeIds = [];
        for (var a = 0; a < tileables.length; a++) {
            activeIds.push(getWindowId(tileables[a]));
        }

        // 1. Keep existing persistent order for windows that are currently on this screen
        var prunedPersistent = [];
        for (var p = 0; p < persistentOrder.length; p++) {
            var pWid = persistentOrder[p];
            var found = false;
            for (var t = 0; t < tileables.length; t++) {
                if (getWindowId(tileables[t]) === pWid) {
                    newOrder.push(tileables[t]);
                    found = true;
                    break;
                }
            }
            if (found || (savedMinimGeometries[pWid] && getScreenName(getScreenForPos(savedMinimGeometries[pWid])) === sName) || (savedTiledGeometries[pWid] && getScreenName(getScreenForPos(savedTiledGeometries[pWid])) === sName)) {
                prunedPersistent.push(pWid);
            }
        }
        persistentOrder = prunedPersistent;

        // 2. Add any brand-new windows that arrived on this screen
        for (var t2 = 0; t2 < tileables.length; t2++) {
            if (newOrder.indexOf(tileables[t2]) === -1) {
                newOrder.push(tileables[t2]);
                var tWid = getWindowId(tileables[t2]);
                if (persistentOrder.indexOf(tWid) === -1) {
                    persistentOrder.push(tWid);
                }
                // Purge this window from any other screen's persistent list
                for (var oScr in persistentScreenOrder) {
                    if (oScr !== sName) {
                        var oList = persistentScreenOrder[oScr] || [];
                        var oIdx = oList.indexOf(tWid);
                        if (oIdx !== -1) {
                            oList.splice(oIdx, 1);
                            persistentScreenOrder[oScr] = oList;
                        }
                    }
                }
            }
        }

        persistentScreenOrder[sName] = persistentOrder;
        screenTiledWindows[sName] = newOrder;
        return newOrder;
    }

    // =========================================================================
    // 5. Retained Coordinator & Coalesced Reconciliation Pipeline
    // =========================================================================
    property var coordinator: null

    function getCoordinator() {
        if (!coordinator && typeof ReconcilerModule !== "undefined" && ReconcilerModule.ReconcilerBridge) {
            coordinator = ReconcilerModule.ReconcilerBridge.createCoordinator({
                enableTiling: config.enableTiling,
                defaultLayout: config.defaultLayout,
                gapInner: config.gapInner,
                gapOuter: config.gapOuter,
                masterRatio: config.masterRatio,
                masterCount: config.masterCount,
                ignoreMinimized: config.ignoreMinimized,
                gameWindowPolicy: config.gameWindowPolicy || "floating",
                floatFilter: config.floatFilter,
                customRules: config.customRulesJson
            });
        }
        return coordinator;
    }

    Timer {
        id: reconcileTimer
        interval: 0
        repeat: false
        running: false
        onTriggered: {
            performReconciliation();
        }
    }

    function scheduleReconcile(reason, targetScreenName) {
        var coord = getCoordinator();
        if (coord && reason) {
            if (targetScreenName && targetScreenName !== "default") {
                coord.markScreenDirty(targetScreenName, reason);
            } else {
                coord.invalidateAllScreens(reason);
            }
        }
        if (!reconcileTimer.running) {
            reconcileTimer.start();
        }
    }

    function performReconciliation() {
        if (runtimeMode !== "reconciler") {
            if (runtimeMode === "legacy-fallback") {
                retileLegacyFallback();
            }
            return;
        }
        if (!config.enableTiling || isArranging) return;

        var coord = getCoordinator();
        if (!coord) {
            log("Warning: coordinator unavailable in reconciler mode");
            return;
        }

        // 1. Synchronize screen topology with retained state
        var screens = Workspace.screens || [Workspace.activeScreen];
        for (var s = 0; s < screens.length; s++) {
            var scr = screens[s];
            if (!scr) continue;
            var area = Workspace.clientArea(KWin.MaximizeArea, scr, Workspace.currentDesktop);
            if (!area || area.width <= 0 || area.height <= 0) continue;

            var sInput = ReconcilerModule.ReconcilerBridge.toNormalizedScreen(scr, area);
            var activeL = getActiveLayout(scr);
            var sName = getScreenName(scr);
            var effectiveRatio = screenMasterRatios[sName] !== undefined ? screenMasterRatios[sName] : config.masterRatio;
            var effectiveCount = screenMasterCounts[sName] !== undefined ? screenMasterCounts[sName] : config.masterCount;

            var retScr = coord.getOrCreateScreen(sInput);
            retScr.activeLayout = activeL;
            retScr.masterRatio = effectiveRatio;
            retScr.masterCount = effectiveCount;
            retScr.gaps = { inner: config.gapInner, outer: config.gapOuter };
        }

        // 2. Synchronize active windows into coordinator retained records
        var allWins = Workspace.stackingOrder || [];
        for (var wIdx = 0; wIdx < allWins.length; wIdx++) {
            var winObj = allWins[wIdx];
            if (!winObj || !winObj.managed || !winObj.normalWindow) continue;
            var wid = getWindowId(winObj);
            var wScr = winObj.output || getScreenForPos(winObj.frameGeometry);
            var wArea = wScr ? Workspace.clientArea(KWin.MaximizeArea, wScr, Workspace.currentDesktop) : null;
            var normWin = ReconcilerModule.ReconcilerBridge.toNormalizedWindow(winObj, wScr, wArea);
            normWin.isManualFloating = (floatingWindows[wid] === true);
            normWin.isDragging = (winObj === currentDraggingWindow);

            var retained = coord.getRetainedWindow(wid);
            if (!retained) {
                coord.ingestEvent({ type: "WindowDiscovered", window: normWin });
            } else {
                if (normWin.outputId && retained.outputId !== normWin.outputId) {
                    coord.ingestEvent({
                        type: "WindowMovedOutput",
                        windowId: wid,
                        fromOutputId: retained.outputId,
                        toOutputId: normWin.outputId
                    });
                }
                coord.ingestEvent({
                    type: "WindowStateChanged",
                    windowId: wid,
                    updates: {
                        minimized: winObj.minimized,
                        fullScreen: winObj.fullScreen,
                        noBorder: winObj.noBorder,
                        maximizeMode: winObj.maximizeMode,
                        isManualFloating: normWin.isManualFloating,
                        isDragging: normWin.isDragging,
                        frameGeometry: normWin.frameGeometry
                    }
                });
            }
        }

        // 3. Plan and compute reconciliation transaction
        coord.invalidateAllScreens("ReconciliationPass");
        var tx = coord.reconcile();
        if (!tx || tx.operations.length === 0) {
            return;
        }

        var diag = coord.getDiagnostics();
        log("Reconciliation tx: ops=" + tx.operations.length + " reasons=" + (diag.lastTransactionReasons.join(",") || "none") + " outputs=" + (diag.lastAffectedScreenIds.join(",") || "all") + " totalTx=" + diag.totalReconciliationTransactions + " totalWrites=" + diag.totalGeometryWrites + " skippedWrites=" + diag.skippedIdenticalWrites + " suppressedEchoes=" + diag.suppressedGeometryEchoes + " retainedWins=" + diag.retainedWindowCount + " retainedScreens=" + diag.retainedScreenCount);

        // 4. Apply only changed geometries with feedback protection
        isArranging = true;
        try {
            for (var opIdx = 0; opIdx < tx.operations.length; opIdx++) {
                var op = tx.operations[opIdx];
                var targetWin = null;
                for (var f = 0; f < allWins.length; f++) {
                    if (getWindowId(allWins[f]) === op.windowId) {
                        targetWin = allWins[f];
                        break;
                    }
                }
                if (!targetWin) continue;
                if (targetWin === currentDraggingWindow) continue;

                var opWid = op.windowId;
                setSavedTiledGeometry(opWid, op.targetRect);

                if (targetWin.maximizeMode !== 0) {
                    continue;
                }

                if (allWins.length === 1 && preTiledWindows[opWid] === true) {
                    continue;
                }

                targetWin.frameGeometry = Qt.rect(op.targetRect.x, op.targetRect.y, op.targetRect.width, op.targetRect.height);
            }
        } catch (err) {
            log("Reconciliation error: " + err);
        } finally {
            isArranging = false;
        }
    }

    function retileNow(targetScreenName) {
        var coord = getCoordinator();
        if (coord) {
            if (targetScreenName && targetScreenName !== "default") {
                coord.markScreenDirty(targetScreenName, "RetileNow");
            } else {
                coord.invalidateAllScreens("RetileNow");
            }
        }
        if (reconcileTimer.running) {
            reconcileTimer.stop();
        }
        if (runtimeMode === "reconciler") {
            performReconciliation();
        } else {
            retileLegacyFallback();
        }
    }

    function retileLegacyFallback() {
        if (runtimeMode !== "legacy-fallback") return;
        if (!config.enableTiling || isArranging) return;
        isArranging = true;
        try {
            var screens = Workspace.screens || [Workspace.activeScreen];
            for (var s = 0; s < screens.length; s++) {
                var screen = screens[s];
                if (!screen) continue;
                var area = Workspace.clientArea(KWin.MaximizeArea, screen, Workspace.currentDesktop);
                if (!area || area.width <= 0 || area.height <= 0) continue;
                var layoutName = getActiveLayout(screen);
                if (layoutName === "floating") continue;
                var windows = getTileableWindows(screen);
                if (windows.length === 0) continue;

                var sName = getScreenName(screen);
                var effectiveRatio = screenMasterRatios[sName] !== undefined ? screenMasterRatios[sName] : config.masterRatio;
                var effectiveCount = screenMasterCounts[sName] !== undefined ? screenMasterCounts[sName] : config.masterCount;
                var options = {
                    gapInner: config.gapInner,
                    gapOuter: config.gapOuter,
                    masterRatio: effectiveRatio,
                    masterCount: effectiveCount
                };

                var rects = LayoutsModule.Layouts.masterStack(area, windows.length, options);
                for (var w = 0; w < windows.length && w < rects.length; w++) {
                    var win = windows[w];
                    var r = rects[w];
                    if (win === currentDraggingWindow) continue;
                    var wid = getWindowId(win);
                    savedTiledGeometries[wid] = Qt.rect(r.x, r.y, r.width, r.height);
                    if (win.maximizeMode !== 0) continue;
                    win.frameGeometry = Qt.rect(r.x, r.y, r.width, r.height);
                }
            }
        } finally {
            isArranging = false;
        }
    }

    // =========================================================================
    // 6. KZones-Style Visual Snap Overlay (PlasmaCore.Dialog)
    // =========================================================================
    PlasmaCore.Dialog {
        id: overlayDialog

        title: "Tessera Snap Overlay"
        location: PlasmaCore.Types.Desktop
        type: PlasmaCore.Dialog.OnScreenDisplay
        backgroundHints: PlasmaCore.Types.NoBackground
        flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
        hideOnWindowDeactivate: true
        visible: false
        outputOnly: true
        opacity: 1
        width: Workspace.virtualScreenSize ? Workspace.virtualScreenSize.width : 1920
        height: Workspace.virtualScreenSize ? Workspace.virtualScreenSize.height : 1080

        property var snapZones: []
        property int hoveredZoneIndex: -1
        property var activeScreenGeom: Qt.rect(0, 0, 1920, 1080)

        function showOverlay(w) {
            visible = true;
            setWidth(Workspace.virtualScreenSize.width);
            setHeight(Workspace.virtualScreenSize.height);
            hoveredZoneIndex = -1;
            computeZones(w);
        }

        function hideOverlay() {
            visible = false;
            hoveredZoneIndex = -1;
            snapZones = [];
        }

        function computeZones(w) {
            var screen = w ? (w.output || getScreenForPos(w.frameGeometry)) : Workspace.activeScreen;
            computeZonesForScreen(screen);
        }

        function computeZonesForScreen(screen) {
            var scr = screen || Workspace.activeScreen;
            var area = Workspace.clientArea(KWin.MaximizeArea, scr, Workspace.currentDesktop);
            activeScreenGeom = area;

            if (typeof ReconcilerModule !== "undefined" && ReconcilerModule.computeSnapZones) {
                snapZones = ReconcilerModule.computeSnapZones(area, config.gapOuter, config.gapInner);
                return;
            }

            var go = config.gapOuter;
            var gi = config.gapInner;
            var uw = area.width - (go * 2);
            var uh = area.height - (go * 2);
            var hw = Math.floor((uw - gi) / 2);
            var hh = Math.floor((uh - gi) / 2);

            var zones = [];

            // 1. Top Maximize Bar Card
            var barW = Math.min(800, Math.floor(uw * 0.6));
            var barX = area.x + Math.floor((area.width - barW) / 2);
            zones.push({
                type: "maximize",
                id: "maximize",
                title: "Full Screen / Maximize",
                badge: "🗖 Maximize",
                desc: "Full Working Area",
                slotIndex: -1,
                rect: { x: barX, y: area.y + 10, width: barW, height: 56 },
                targetRect: { x: area.x + go, y: area.y + go, width: uw, height: uh },
                // Scoped trigger bounds: only triggers over the actual Maximize card at top-center
                triggerX: barX - 10,
                triggerY: area.y,
                triggerW: barW + 20,
                triggerH: 66
            });

            // 2. Left Half (Master Slot)
            zones.push({
                type: "half",
                id: "left-half",
                title: "Left Half (Master)",
                badge: "⊞ Left Split",
                desc: "50% Primary Pane",
                slotIndex: 0,
                rect: { x: area.x + go, y: area.y + go + 70, width: hw, height: uh - 70 },
                targetRect: { x: area.x + go, y: area.y + go, width: hw, height: uh },
                triggerX: area.x,
                triggerY: area.y + 80,
                triggerW: Math.floor(area.width / 2),
                triggerH: area.height - 80
            });

            // 3. Right Half (Stack Slot)
            zones.push({
                type: "half",
                id: "right-half",
                title: "Right Half (Stack)",
                badge: "▥ Right Split",
                desc: "50% Secondary Pane",
                slotIndex: 1,
                rect: { x: area.x + go + hw + gi, y: area.y + go + 70, width: uw - hw - gi, height: uh - 70 },
                targetRect: { x: area.x + go + hw + gi, y: area.y + go, width: uw - hw - gi, height: uh },
                triggerX: area.x + Math.floor(area.width / 2),
                triggerY: area.y + 80,
                triggerW: Math.floor(area.width / 2),
                triggerH: area.height - 80
            });

            // 4. Top-Left Quarter
            zones.push({
                type: "quarter",
                id: "top-left",
                title: "Top-Left Quarter",
                badge: "◤ Top-Left",
                desc: "25% Quadrant",
                slotIndex: 0,
                rect: { x: area.x + go, y: area.y + go + 70, width: hw, height: Math.max(60, hh - 70) },
                targetRect: { x: area.x + go, y: area.y + go, width: hw, height: hh },
                triggerX: area.x,
                triggerY: area.y,
                triggerW: Math.floor(area.width * 0.22),
                triggerH: Math.floor(area.height * 0.32)
            });

            // 5. Bottom-Left Quarter
            zones.push({
                type: "quarter",
                id: "bottom-left",
                title: "Bottom-Left Quarter",
                badge: "◣ Bottom-Left",
                desc: "25% Quadrant",
                slotIndex: 0,
                rect: { x: area.x + go, y: area.y + go + hh + gi, width: hw, height: uh - hh - gi },
                targetRect: { x: area.x + go, y: area.y + go + hh + gi, width: hw, height: uh - hh - gi },
                triggerX: area.x,
                triggerY: area.y + Math.floor(area.height * 0.68),
                triggerW: Math.floor(area.width * 0.22),
                triggerH: Math.floor(area.height * 0.32)
            });

            // 6. Top-Right Quarter
            zones.push({
                type: "quarter",
                id: "top-right",
                title: "Top-Right Quarter",
                badge: "◥ Top-Right",
                desc: "25% Quadrant",
                slotIndex: 1,
                rect: { x: area.x + go + hw + gi, y: area.y + go + 70, width: uw - hw - gi, height: Math.max(60, hh - 70) },
                targetRect: { x: area.x + go + hw + gi, y: area.y + go, width: uw - hw - gi, height: hh },
                triggerX: area.x + Math.floor(area.width * 0.78),
                triggerY: area.y,
                triggerW: Math.floor(area.width * 0.22),
                triggerH: Math.floor(area.height * 0.32)
            });

            // 7. Bottom-Right Quarter
            zones.push({
                type: "quarter",
                id: "bottom-right",
                title: "Bottom-Right Quarter",
                badge: "◢ Bottom-Right",
                desc: "25% Quadrant",
                slotIndex: 1,
                rect: { x: area.x + go + hw + gi, y: area.y + go + hh + gi, width: uw - hw - gi, height: uh - hh - gi },
                targetRect: { x: area.x + go + hw + gi, y: area.y + go + hh + gi, width: uw - hw - gi, height: uh - hh - gi },
                triggerX: area.x + Math.floor(area.width * 0.78),
                triggerY: area.y + Math.floor(area.height * 0.68),
                triggerW: Math.floor(area.width * 0.22),
                triggerH: Math.floor(area.height * 0.32)
            });

            snapZones = zones;
        }

        function updateHover(cursorPos) {
            if (!cursorPos) return;

            var curScreen = getScreenForPos({x: cursorPos.x, y: cursorPos.y, width: 1, height: 1});
            var curArea = Workspace.clientArea(KWin.MaximizeArea, curScreen, Workspace.currentDesktop);
            if (curArea && activeScreenGeom && (curArea.x !== activeScreenGeom.x || curArea.y !== activeScreenGeom.y)) {
                computeZonesForScreen(curScreen);
            }

            var matchedIndex = -1;
            if (typeof ReconcilerModule !== "undefined" && ReconcilerModule.matchSnapZoneHover) {
                matchedIndex = ReconcilerModule.matchSnapZoneHover(snapZones, cursorPos);
            } else {
                // 1. Check corner quarters first (higher priority in corners)
                for (var i = 3; i < snapZones.length; i++) {
                    var qz = snapZones[i];
                    if (cursorPos.x >= qz.triggerX && cursorPos.x < qz.triggerX + qz.triggerW &&
                        cursorPos.y >= qz.triggerY && cursorPos.y < qz.triggerY + qz.triggerH) {
                        matchedIndex = i;
                        break;
                    }
                }

                // 2. Check top maximize bar
                if (matchedIndex === -1 && snapZones.length > 0) {
                    var mz = snapZones[0];
                    if (cursorPos.x >= mz.triggerX && cursorPos.x < mz.triggerX + mz.triggerW &&
                        cursorPos.y >= mz.triggerY && cursorPos.y < mz.triggerY + mz.triggerH) {
                        matchedIndex = 0;
                    }
                }

                // 3. Check Left/Right halves
                if (matchedIndex === -1) {
                    if (snapZones.length > 1) {
                        var lz = snapZones[1];
                        if (cursorPos.x >= lz.triggerX && cursorPos.x < lz.triggerX + lz.triggerW &&
                            cursorPos.y >= lz.triggerY && cursorPos.y < lz.triggerY + lz.triggerH) {
                            matchedIndex = 1;
                        }
                    }
                    if (snapZones.length > 2 && matchedIndex === -1) {
                        var rz = snapZones[2];
                        if (cursorPos.x >= rz.triggerX && cursorPos.x < rz.triggerX + rz.triggerW &&
                            cursorPos.y >= rz.triggerY && cursorPos.y < rz.triggerY + rz.triggerH) {
                            matchedIndex = 2;
                        }
                    }
                }
            }

            if (matchedIndex !== hoveredZoneIndex) {
                hoveredZoneIndex = matchedIndex;
                if (currentDraggingWindow && matchedIndex !== -1) {
                    previewProspectiveLayout(currentDraggingWindow, snapZones[matchedIndex]);
                }
            }
        }

        function finishDrag() {
            if (hoveredZoneIndex >= 0 && hoveredZoneIndex < snapZones.length) {
                return snapZones[hoveredZoneIndex];
            }
            return null;
        }

        // Live preview of prospective window layout
        function previewProspectiveLayout(draggedWin, targetZone) {
            if (!draggedWin || !targetZone || isArranging) return;
            var scr = draggedWin.output || getScreenForPos(draggedWin.frameGeometry);
            var tiled = getTileableWindows(scr);
            if (tiled.length <= 1) return;

            var area = activeScreenGeom;
            var go = config.gapOuter;
            var gi = config.gapInner;
            var uw = area.width - (go * 2);
            var uh = area.height - (go * 2);
            var hw = Math.floor((uw - gi) / 2);

            for (var i = 0; i < tiled.length; i++) {
                var other = tiled[i];
                if (other === draggedWin) continue;

                if (targetZone.id === "left-half") {
                    // dragged window will take left half; other window previews on right half
                    other.frameGeometry = Qt.rect(area.x + go + hw + gi, area.y + go, uw - hw - gi, uh);
                } else if (targetZone.id === "right-half") {
                    // dragged window will take right half; other window previews on left half
                    other.frameGeometry = Qt.rect(area.x + go, area.y + go, hw, uh);
                }
            }
        }

        // =====================================================================
        // Overlay Visual Representation (Exact LiveDesktopPreview Styling)
        // =====================================================================
        Item {
            id: overlayContainer
            anchors.fill: parent

            // Cursor tracking & snap refresh rate (16ms = smooth 60 FPS)
            Timer {
                id: overlayTimer
                interval: config.overlayPollingMs || 16
                running: overlayDialog.visible
                repeat: true
                onTriggered: {
                    overlayDialog.updateHover(Workspace.cursorPos);
                }
            }

            // Subtle dark scrim so zone cards have punchy contrast
            Rectangle {
                anchors.fill: parent
                color: Qt.rgba(0, 0, 0, 0.20)
            }

            // Top Maximize Card
            Repeater {
                model: [overlayDialog.snapZones.length > 0 ? overlayDialog.snapZones[0] : null]

                delegate: Rectangle {
                    visible: modelData !== null
                    x: modelData ? modelData.rect.x : 0
                    y: modelData ? modelData.rect.y : 0
                    width: modelData ? modelData.rect.width : 0
                    height: modelData ? modelData.rect.height : 0
                    radius: 8

                    property bool isHovered: overlayDialog.hoveredZoneIndex === 0

                    color: isHovered ? Qt.rgba(0.11, 0.40, 0.56, 0.85) : Qt.rgba(0.09, 0.11, 0.14, 0.75)
                    border.color: isHovered ? "#3daee9" : Qt.rgba(0.31, 0.34, 0.38, 0.6)
                    border.width: isHovered ? 3 : 2

                    RowLayout {
                        anchors.centerIn: parent
                        spacing: 16

                        Text {
                            text: modelData ? modelData.badge : ""
                            color: isHovered ? "#ffffff" : "#3daee9"
                            font.bold: true
                            font.pixelSize: isHovered ? 18 : 15
                        }

                        Text {
                            text: isHovered ? "✓ Release to Maximize Window" : (modelData ? modelData.desc : "")
                            color: isHovered ? "#ffffff" : "#a0a6ad"
                            font.pixelSize: 12
                            font.bold: isHovered
                        }
                    }
                }
            }

            // Split Zones (Left Half & Right Half)
            Repeater {
                model: (overlayDialog.snapZones.length >= 3) ? [overlayDialog.snapZones[1], overlayDialog.snapZones[2]] : []

                delegate: Rectangle {
                    property int zoneIdx: index + 1
                    property bool isHovered: overlayDialog.hoveredZoneIndex === zoneIdx

                    x: modelData ? modelData.rect.x : 0
                    y: modelData ? modelData.rect.y : 0
                    width: modelData ? modelData.rect.width : 0
                    height: modelData ? modelData.rect.height : 0
                    radius: 8

                    color: isHovered ? Qt.rgba(0.11, 0.40, 0.56, 0.65) : Qt.rgba(0.09, 0.11, 0.14, 0.60)
                    border.color: isHovered ? "#3daee9" : Qt.rgba(0.31, 0.34, 0.38, 0.5)
                    border.width: isHovered ? 3 : 2

                    // Miniature Titlebar at top (LiveDesktopPreview aesthetic)
                    Rectangle {
                        anchors.top: parent.top
                        anchors.left: parent.left
                        anchors.right: parent.right
                        height: 26
                        color: isHovered ? Qt.rgba(0.24, 0.68, 0.91, 0.35) : Qt.rgba(0, 0, 0, 0.4)
                        topLeftRadius: 7
                        topRightRadius: 7

                        Text {
                            anchors.left: parent.left
                            anchors.leftMargin: 12
                            anchors.verticalCenter: parent.verticalCenter
                            text: modelData ? modelData.title : ""
                            color: isHovered ? "#ffffff" : "#a0a6ad"
                            font.bold: true
                            font.pixelSize: 11
                        }
                    }

                    // Centered Badge
                    Column {
                        anchors.centerIn: parent
                        spacing: 8

                        Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: modelData ? modelData.badge : ""
                            color: isHovered ? "#ffffff" : "#3daee9"
                            font.bold: true
                            font.pixelSize: isHovered ? 24 : 18
                        }

                        Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: isHovered ? "✓ Release to Snap Here" : (modelData ? modelData.desc : "")
                            color: isHovered ? "#3daee9" : "#6c757d"
                            font.pixelSize: 12
                            font.bold: isHovered
                        }
                    }
                }
            }

            // Quarters in the 4 Corners (Rendered with glow when hovered)
            Repeater {
                model: (overlayDialog.snapZones.length >= 7) ? [overlayDialog.snapZones[3], overlayDialog.snapZones[4], overlayDialog.snapZones[5], overlayDialog.snapZones[6]] : []

                delegate: Rectangle {
                    property int quarterIdx: index + 3
                    property bool isHovered: overlayDialog.hoveredZoneIndex === quarterIdx

                    visible: isHovered // Subtle, lights up with glowing border and fill when corner is hovered
                    x: modelData ? modelData.rect.x : 0
                    y: modelData ? modelData.rect.y : 0
                    width: modelData ? modelData.rect.width : 0
                    height: modelData ? modelData.rect.height : 0
                    radius: 8

                    color: Qt.rgba(0.11, 0.40, 0.56, 0.75)
                    border.color: "#3daee9"
                    border.width: 3

                    Rectangle {
                        anchors.top: parent.top
                        anchors.left: parent.left
                        anchors.right: parent.right
                        height: 24
                        color: Qt.rgba(0.24, 0.68, 0.91, 0.4)
                        topLeftRadius: 7
                        topRightRadius: 7

                        Text {
                            anchors.left: parent.left
                            anchors.leftMargin: 10
                            anchors.verticalCenter: parent.verticalCenter
                            text: modelData ? modelData.title : ""
                            color: "#ffffff"
                            font.bold: true
                            font.pixelSize: 11
                        }
                    }

                    Column {
                        anchors.centerIn: parent
                        spacing: 6

                        Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: modelData ? modelData.badge : ""
                            color: "#ffffff"
                            font.bold: true
                            font.pixelSize: 20
                        }

                        Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: "✓ Release to Snap Quarter"
                            color: "#3daee9"
                            font.pixelSize: 12
                            font.bold: true
                        }
                    }
                }
            }
        }
    }

    // =========================================================================
    // 6b. Live Master Windows & Screen Configuration HUD (Testing & On-The-Fly)
    // =========================================================================
    PlasmaCore.Dialog {
        id: masterHudDialog

        title: "Tessera Master Configuration"
        location: PlasmaCore.Types.Desktop
        type: PlasmaCore.Dialog.OnScreenDisplay
        backgroundHints: PlasmaCore.Types.NoBackground
        flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
        hideOnWindowDeactivate: false
        visible: false
        outputOnly: true
        width: 440
        height: 220

        property string screenLabel: "Screen"
        property int masterCountVal: 1
        property string layoutVal: "MASTER-STACK"
        property var targetArea: Qt.rect(0, 0, 1920, 1080)

        function popup(scr, count) {
            var targetScr = scr || getCurrentTargetScreen();
            var sName = getScreenName(targetScr);
            var area = Workspace.clientArea(KWin.MaximizeArea, targetScr, Workspace.currentDesktop);
            targetArea = area;
            screenLabel = sName;
            masterCountVal = count;
            layoutVal = getActiveLayout(targetScr).toUpperCase();

            x = area.x + Math.floor((area.width - width) / 2);
            y = area.y + Math.floor((area.height - height) / 2);
            visible = true;

            hudDismissTimer.restart();
        }

        mainItem: Rectangle {
            id: hudRootRect
            implicitWidth: 440
            implicitHeight: 220
            radius: 12
            color: Qt.rgba(0.09, 0.11, 0.14, 0.95)
            border.color: "#3daee9"
            border.width: 2

            Timer {
                id: hudDismissTimer
                interval: 2400
                repeat: false
                onTriggered: masterHudDialog.visible = false
            }

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 16
                spacing: 10

                // Header with Screen Name and Layout
                RowLayout {
                    Layout.fillWidth: true
                    Text {
                        text: "🖥️ " + masterHudDialog.screenLabel
                        color: "#3daee9"
                        font.bold: true
                        font.pixelSize: 16
                    }
                    Item { Layout.fillWidth: true }
                    Rectangle {
                        color: Qt.rgba(0.24, 0.68, 0.91, 0.25)
                        radius: 4
                        implicitWidth: layoutText.implicitWidth + 12
                        implicitHeight: 22
                        Text {
                            id: layoutText
                            anchors.centerIn: parent
                            text: masterHudDialog.layoutVal
                            color: "#ffffff"
                            font.bold: true
                            font.pixelSize: 11
                        }
                    }
                }

                // Master Count Value
                RowLayout {
                    Layout.alignment: Qt.AlignHCenter
                    spacing: 10
                    Text {
                        text: "Master Windows:"
                        color: "#cfd6df"
                        font.pixelSize: 15
                    }
                    Rectangle {
                        color: "#3daee9"
                        radius: 6
                        implicitWidth: masterHudDialog.masterCountVal === 0 ? 120 : 36
                        implicitHeight: 28
                        Text {
                            anchors.centerIn: parent
                            text: masterHudDialog.masterCountVal === 0 ? "0 (Balanced Grid)" : masterHudDialog.masterCountVal.toString()
                            color: "#000000"
                            font.bold: true
                            font.pixelSize: masterHudDialog.masterCountVal === 0 ? 11 : 18
                        }
                    }
                }

                // Mini Layout Preview Diagram (Master-Stack when masterCount > 0)
                RowLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    spacing: 8
                    visible: masterHudDialog.masterCountVal > 0

                    // Master column box
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        color: Qt.rgba(0.24, 0.68, 0.91, 0.20)
                        border.color: "#3daee9"
                        border.width: 1
                        radius: 6

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 4
                            spacing: 4
                            Repeater {
                                model: Math.min(4, masterHudDialog.masterCountVal)
                                delegate: Rectangle {
                                    Layout.fillWidth: true
                                    Layout.fillHeight: true
                                    color: Qt.rgba(0.24, 0.68, 0.91, 0.40)
                                    radius: 3
                                    Text {
                                        anchors.centerIn: parent
                                        text: "Master " + (index + 1)
                                        color: "#ffffff"
                                        font.pixelSize: 10
                                        font.bold: true
                                    }
                                }
                            }
                        }
                    }

                    // Stack column box
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        color: Qt.rgba(1, 1, 1, 0.06)
                        border.color: Qt.rgba(1, 1, 1, 0.15)
                        border.width: 1
                        radius: 6
                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 4
                            spacing: 4
                            Repeater {
                                model: 2
                                delegate: Rectangle {
                                    Layout.fillWidth: true
                                    Layout.fillHeight: true
                                    color: Qt.rgba(1, 1, 1, 0.10)
                                    radius: 3
                                    Text {
                                        anchors.centerIn: parent
                                        text: "Stack " + (index + 1)
                                        color: "#80ffffff"
                                        font.pixelSize: 10
                                    }
                                }
                            }
                        }
                    }
                }

                // Balanced Grid Preview Diagram (Shown when 0 masters)
                RowLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    spacing: 8
                    visible: masterHudDialog.masterCountVal === 0

                    // Left End: 2 horizontal splits
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        color: Qt.rgba(0.24, 0.68, 0.91, 0.15)
                        border.color: "#3daee9"
                        border.width: 1
                        radius: 6
                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 4
                            spacing: 4
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                color: Qt.rgba(0.24, 0.68, 0.91, 0.35)
                                radius: 3
                                Text { anchors.centerIn: parent; text: "1 (Left Top)"; color: "#ffffff"; font.pixelSize: 9; font.bold: true }
                            }
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                color: Qt.rgba(0.24, 0.68, 0.91, 0.35)
                                radius: 3
                                Text { anchors.centerIn: parent; text: "2 (Left Btm)"; color: "#ffffff"; font.pixelSize: 9; font.bold: true }
                            }
                        }
                    }

                    // Center Stack / Column
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        color: Qt.rgba(0.24, 0.68, 0.91, 0.25)
                        border.color: "#3daee9"
                        border.width: 1
                        radius: 6
                        Text { anchors.centerIn: parent; text: "3 (Center Stack)"; color: "#3daee9"; font.pixelSize: 10; font.bold: true }
                    }

                    // Right End: 2 horizontal splits
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        color: Qt.rgba(0.24, 0.68, 0.91, 0.15)
                        border.color: "#3daee9"
                        border.width: 1
                        radius: 6
                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 4
                            spacing: 4
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                color: Qt.rgba(0.24, 0.68, 0.91, 0.35)
                                radius: 3
                                Text { anchors.centerIn: parent; text: "4 (Right Top)"; color: "#ffffff"; font.pixelSize: 9; font.bold: true }
                            }
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                color: Qt.rgba(0.24, 0.68, 0.91, 0.35)
                                radius: 3
                                Text { anchors.centerIn: parent; text: "5 (Right Btm)"; color: "#ffffff"; font.pixelSize: 9; font.bold: true }
                            }
                        }
                    }
                }

                Text {
                    Layout.alignment: Qt.AlignHCenter
                    text: "Ctrl+Shift+I (Increase) / Ctrl+Shift+O (Decrease)"
                    color: "#8090a0"
                    font.pixelSize: 10
                }
            }
        }
    }

    // =========================================================================
    // 7. Window Event Hooks
    // =========================================================================
    function unhookWindow(w) {
        if (!w || !w._tesseraHooks) return;
        try {
            var h = w._tesseraHooks;
            if (w.interactiveMoveResizeStarted && h.started) w.interactiveMoveResizeStarted.disconnect(h.started);
            if (w.interactiveMoveResizeStepped && h.stepped) w.interactiveMoveResizeStepped.disconnect(h.stepped);
            if (w.interactiveMoveResizeFinished && h.finished) w.interactiveMoveResizeFinished.disconnect(h.finished);
            if (w.minimizedChanged && h.minimized) w.minimizedChanged.disconnect(h.minimized);
            if (w.frameGeometryChanged && h.geom) w.frameGeometryChanged.disconnect(h.geom);
            if (w.fullScreenChanged && h.fullScreen) w.fullScreenChanged.disconnect(h.fullScreen);
            if (w.maximizedAboutToChange && h.maxAbout) w.maximizedAboutToChange.disconnect(h.maxAbout);
            if (w.maximizedChanged && h.maxChanged) w.maximizedChanged.disconnect(h.maxChanged);
            if (w.noBorderChanged && h.noBorder) w.noBorderChanged.disconnect(h.noBorder);
            if (w.outputChanged && h.output) w.outputChanged.disconnect(h.output);
        } catch (e) {
            // Ignore if already disconnected or window destroyed
        }
        delete w._tesseraHooks;
        delete w._tesseraHooked;
    }

    function hookWindow(w) {
        if (!w || !w.managed || !w.normalWindow) return;
        if (w._tesseraHooks) {
            unhookWindow(w);
        }
        w._tesseraHooked = true;

        var hooks = {};

        var onMoveResizeStarted = function() {
            if (!root || !root.coordinator) return;
            if (w.move && checkFilter(w)) {
                currentDraggingWindow = w;
                var wid = getWindowId(w);
                if (w.maximizeMode !== 0) {
                    wasDraggingMaximized[wid] = true;
                    if (typeof w.setMaximize === "function") {
                        w.setMaximize(false, false);
                    }
                    var curPos = Workspace.cursorPos;
                    var targetW = 800;
                    var targetH = 600;
                    var saved = getSavedTiledGeometry(wid);
                    if (saved && saved.width > 100) {
                        targetW = saved.width;
                        targetH = saved.height;
                    }
                    var newX = Math.round(curPos.x - (targetW / 2));
                    var newY = Math.max(0, curPos.y - 15);
                    w.frameGeometry = Qt.rect(newX, newY, targetW, targetH);
                } else {
                    wasDraggingMaximized[wid] = false;
                }
                log("Drag started: " + w.caption + (wasDraggingMaximized[wid] ? " (from maximized)" : ""));
                if (overlayDialog) overlayDialog.showOverlay(w);
            }
        };

        var onMoveResizeStepped = function() {
            if (!root || !root.coordinator) return;
            if (overlayDialog && overlayDialog.visible && currentDraggingWindow === w) {
                overlayDialog.updateHover(Workspace.cursorPos);
            }
        };

        var onMoveResizeFinished = function() {
            if (!root || !root.coordinator) return;
            if (currentDraggingWindow === w) {
                log("Drag finished: " + w.caption);
                var wid = getWindowId(w);
                var target = overlayDialog ? overlayDialog.finishDrag() : null;
                if (target) {
                    if (target.type === "maximize") {
                        if (typeof w.setMaximize === "function") {
                            w.setMaximize(true, true);
                        }
                        delete preTiledWindows[wid];
                        floatingWindows[wid] = false;
                        if (coordinator) {
                            coordinator.setManualFloating(wid, false);
                        }
                        osdCall.notify("Maximized", "preferences-system-windows");
                    } else {
                        if (typeof w.setMaximize === "function") {
                            w.setMaximize(false, false);
                        }
                        w.frameGeometry = Qt.rect(target.targetRect.x, target.targetRect.y, target.targetRect.width, target.targetRect.height);
                        preTiledWindows[wid] = true;
                        floatingWindows[wid] = false;
                        if (coordinator) {
                            coordinator.setManualFloating(wid, false);
                        }

                        // Update window order on this screen
                        var scr = getScreenForPos(target.targetRect);
                        var sName = getScreenName(scr);
                        var currentWins = screenTiledWindows[sName] || [];
                        var list = [];
                        for (var k = 0; k < currentWins.length; k++) {
                            if (currentWins[k] !== w) list.push(currentWins[k]);
                        }
                        if (target.slotIndex === 0) {
                            list.unshift(w);
                        } else {
                            list.push(w);
                        }
                        screenTiledWindows[sName] = list;

                        // Keep persistentScreenOrder in sync
                        var pOrder = persistentScreenOrder[sName] || [];
                        var newPOrder = [];
                        for (var pi = 0; pi < pOrder.length; pi++) {
                            if (pOrder[pi] !== wid) newPOrder.push(pOrder[pi]);
                        }
                        if (target.slotIndex === 0) {
                            newPOrder.unshift(wid);
                        } else {
                            newPOrder.push(wid);
                        }
                        persistentScreenOrder[sName] = newPOrder;

                        // Purge wid from any other screens' persistent order
                        for (var oScr in persistentScreenOrder) {
                            if (oScr !== sName) {
                                var oList = persistentScreenOrder[oScr] || [];
                                var oIdx = oList.indexOf(wid);
                                if (oIdx !== -1) {
                                    oList.splice(oIdx, 1);
                                    persistentScreenOrder[oScr] = oList;
                                }
                            }
                        }

                        setSavedTiledGeometry(wid, target.targetRect);

                        osdCall.notify("Snapped: " + target.title, "preferences-system-windows");
                    }
                } else {
                    // Dropped outside any snap zone
                    var dropScr = getScreenForPos(w.frameGeometry);
                    var dropSName = getScreenName(dropScr);
                    for (var oScr2 in persistentScreenOrder) {
                        if (oScr2 !== dropSName) {
                            var oList2 = persistentScreenOrder[oScr2] || [];
                            var oIdx2 = oList2.indexOf(wid);
                            if (oIdx2 !== -1) {
                                oList2.splice(oIdx2, 1);
                                persistentScreenOrder[oScr2] = oList2;
                            }
                        }
                    }
                    if (wasDraggingMaximized[wid]) {
                        floatingWindows[wid] = false;
                        if (coordinator) {
                            coordinator.setManualFloating(wid, false);
                        }
                        delete preTiledWindows[wid];
                    }
                }
                delete wasDraggingMaximized[wid];
                if (overlayDialog) overlayDialog.hideOverlay();
                currentDraggingWindow = null;
                retileNow();
            }
        };

        var onMinimizedChanged = function() {
            if (!root || !root.coordinator) return;
            var wid = getWindowId(w);
            if (w.minimized) {
                setPreMinimizeGeometry(wid, w.frameGeometry);
            } else {
                // Window was restored from minimize!
                // Restore its saved tiled slot geometry immediately
                var g = getSavedTiledGeometry(wid);
                if (g) {
                    w.frameGeometry = Qt.rect(g.x, g.y, g.width, g.height);
                }
            }
            var coord = getCoordinator();
            if (coord) {
                coord.handleMinimize(wid, w.minimized, {
                    x: w.frameGeometry.x,
                    y: w.frameGeometry.y,
                    width: w.frameGeometry.width,
                    height: w.frameGeometry.height
                });
            }
            retileNow();
        };

        var onFrameGeometryChanged = function() {
            if (!root || !root.coordinator || isArranging) return;
            var wid = getWindowId(w);
            var coord = getCoordinator();
            if (coord) {
                var echoCheck = coord.checkAndHandleEcho(wid, {
                    x: w.frameGeometry.x,
                    y: w.frameGeometry.y,
                    width: w.frameGeometry.width,
                    height: w.frameGeometry.height
                });
                if (echoCheck.isEcho) {
                    return;
                }
            }
            scheduleReconcile("WindowGeometryChanged");
        };

        var onFullScreenChanged = function() {
            if (!root || !root.coordinator || isArranging) return;
            var evalRes = evaluateWindowTileability(w);
            if (evalRes.changed) {
                scheduleReconcile(w.fullScreen ? "WindowFullscreenEntered" : "WindowFullscreenExited");
            }
        };

        var onMaximizedAboutToChange = function(mode) {
            if (!root || !root.coordinator || isArranging) return;
            var wid = getWindowId(w);
            if (mode === 0) {
                floatingWindows[wid] = false;
                delete preTiledWindows[wid];
            }
        };

        var onMaximizedChanged = function() {
            if (!root || !root.coordinator || isArranging) return;
            var wid = getWindowId(w);
            if (w.maximizeMode === 0) {
                floatingWindows[wid] = false;
                delete preTiledWindows[wid];
                var target = getSavedTiledGeometry(wid);
                if (target) {
                    w.frameGeometry = Qt.rect(target.x, target.y, target.width, target.height);
                }
            }
            var evalRes = evaluateWindowTileability(w);
            if (evalRes.changed) {
                scheduleReconcile("WindowMaximizedChanged");
            }
        };

        var onNoBorderChanged = function() {
            if (!root || !root.coordinator || isArranging) return;
            var evalRes = evaluateWindowTileability(w);
            if (evalRes.changed) {
                scheduleReconcile("WindowNoBorderChanged");
            }
        };

        var onOutputChanged = function() {
            if (!root || !root.coordinator || isArranging) return;
            scheduleReconcile("WindowOutputChanged");
        };

        if (w.interactiveMoveResizeStarted) {
            hooks.started = onMoveResizeStarted;
            w.interactiveMoveResizeStarted.connect(onMoveResizeStarted);
        }
        if (w.interactiveMoveResizeStepped) {
            hooks.stepped = onMoveResizeStepped;
            w.interactiveMoveResizeStepped.connect(onMoveResizeStepped);
        }
        if (w.interactiveMoveResizeFinished) {
            hooks.finished = onMoveResizeFinished;
            w.interactiveMoveResizeFinished.connect(onMoveResizeFinished);
        }
        if (w.minimizedChanged) {
            hooks.minimized = onMinimizedChanged;
            w.minimizedChanged.connect(onMinimizedChanged);
        }
        if (w.frameGeometryChanged) {
            hooks.geom = onFrameGeometryChanged;
            w.frameGeometryChanged.connect(onFrameGeometryChanged);
        }
        if (w.fullScreenChanged) {
            hooks.fullScreen = onFullScreenChanged;
            w.fullScreenChanged.connect(onFullScreenChanged);
        }
        if (w.maximizedAboutToChange) {
            hooks.maxAbout = onMaximizedAboutToChange;
            w.maximizedAboutToChange.connect(onMaximizedAboutToChange);
        }
        if (w.maximizedChanged) {
            hooks.maxChanged = onMaximizedChanged;
            w.maximizedChanged.connect(onMaximizedChanged);
        }
        if (w.noBorderChanged) {
            hooks.noBorder = onNoBorderChanged;
            w.noBorderChanged.connect(onNoBorderChanged);
        }
        if (w.outputChanged) {
            hooks.output = onOutputChanged;
            w.outputChanged.connect(onOutputChanged);
        }

        w._tesseraHooks = hooks;
    }

    // =========================================================================
    // 8. Workspace Global Event Handling & Cooperative Unmaximize
    // =========================================================================
    Connections {
        target: Workspace

        function onWindowActivated(activeWin) {
            // Keep window activation clean without forcefully crushing maximized windows
        }

        function onWindowAdded(w) {
            if (!w || !w.normalWindow || !w.managed) return;
            hookWindow(w);

            if (config.tileNewWindows) {
                var scr = w.output || getScreenForPos(w.frameGeometry);
                var area = scr ? Workspace.clientArea(KWin.MaximizeArea, scr, Workspace.currentDesktop) : null;
                var coord = getCoordinator();
                if (coord) {
                    coord.ingestEvent({
                        type: "WindowDiscovered",
                        window: ReconcilerModule.ReconcilerBridge.toNormalizedWindow(w, scr, area)
                    });
                }
                scheduleReconcile("WindowAdded");
            }
        }

        function onWindowRemoved(w) {
            if (!w) return;
            unhookWindow(w);
            var wid = getWindowId(w);
            delete floatingWindows[wid];
            delete preTiledWindows[wid];
            delete savedTiledGeometries[wid];
            delete savedMinimGeometries[wid];
            delete wasDraggingMaximized[wid];
            delete windowClassifications[wid];
            delete windowTileability[wid];
            RulesModule.RuleEngine.forget(wid);

            var coord = getCoordinator();
            if (coord) {
                coord.setSavedTiledGeometry(wid, null);
                coord.setPreMinimizeGeometry(wid, null);
                coord.ingestEvent({ type: "WindowRemoved", windowId: wid });
            }

            if (runtimeMode === "legacy-fallback") {
                // Remove from persistentScreenOrder across all screens
                for (var sName in persistentScreenOrder) {
                    var pList = persistentScreenOrder[sName] || [];
                    var filtered = [];
                    for (var i = 0; i < pList.length; i++) {
                        if (pList[i] !== wid) filtered.push(pList[i]);
                    }
                    persistentScreenOrder[sName] = filtered;
                }
            }

            scheduleReconcile("WindowRemoved");
        }

        function onCurrentDesktopChanged() {
            scheduleReconcile("DesktopChanged");
        }

        function onScreensChanged() {
            scheduleReconcile("ScreensChanged");
        }
    }

    // =========================================================================
    // 9. Window Actions & Keyboard Navigation
    // =========================================================================
    function toggleTiling() {
        config.enableTiling = !config.enableTiling;
        osdCall.notify(config.enableTiling ? "Tiling Enabled" : "Tiling Disabled", "preferences-desktop-virtual");
        if (config.enableTiling) {
            retileNow();
        }
    }

    function toggleActiveFloating() {
        var w = Workspace.activeWindow;
        if (!w) return;

        var wid = getWindowId(w);
        var currentlyFloating = floatingWindows[wid] === true;
        floatingWindows[wid] = !currentlyFloating;
        delete preTiledWindows[wid];
        log("toggleActiveFloating: " + (w.caption || wid) + " -> " + (floatingWindows[wid] ? "floating" : "tiled"));

        var coord = getCoordinator();
        if (coord) {
            coord.setManualFloating(wid, floatingWindows[wid]);
        }

        osdCall.notify(floatingWindows[wid] ? "Window Floating" : "Window Tiled", "preferences-system-windows");
        retileNow();
    }

    function focusWindow(forward) {
        var windows = getTileableWindows(Workspace.activeScreen);
        if (windows.length <= 1) return;

        var currentIdx = windows.indexOf(Workspace.activeWindow);
        if (currentIdx === -1) {
            Workspace.activeWindow = windows[0];
            return;
        }

        var nextIdx = forward ? ((currentIdx + 1) % windows.length) : ((currentIdx - 1 + windows.length) % windows.length);
        Workspace.activeWindow = windows[nextIdx];
    }

    function swapWindow(forward) {
        var s = Workspace.activeScreen;
        var sName = getScreenName(s);
        var windows = screenTiledWindows[sName] || getTileableWindows(s);
        if (windows.length <= 1) return;

        var currentIdx = windows.indexOf(Workspace.activeWindow);
        if (currentIdx === -1) return;

        var targetIdx = forward ? ((currentIdx + 1) % windows.length) : ((currentIdx - 1 + windows.length) % windows.length);

        var temp = windows[currentIdx];
        windows[currentIdx] = windows[targetIdx];
        windows[targetIdx] = temp;
        screenTiledWindows[sName] = windows;

        // Keep persistentScreenOrder in sync with the swap!
        var newPOrder = [];
        for (var i = 0; i < windows.length; i++) {
            newPOrder.push(getWindowId(windows[i]));
        }
        persistentScreenOrder[sName] = newPOrder;

        retileNow();
    }

    function adjustMasterRatio(delta) {
        var scr = getCurrentTargetScreen();
        var sName = getScreenName(scr);

        var currentRatio = screenMasterRatios[sName] !== undefined ? screenMasterRatios[sName] : config.masterRatio;
        var newRatio = Math.max(0.2, Math.min(0.8, currentRatio + delta));
        newRatio = Math.round(newRatio * 100) / 100;
        screenMasterRatios[sName] = newRatio;

        osdCall.notify(sName + " Master Ratio: " + Math.round(newRatio * 100) + "%", "preferences-desktop-virtual");
        retileNow();
    }

    function adjustMasterCount(delta) {
        var scr = getCurrentTargetScreen();
        var sName = getScreenName(scr);

        var currentCount = screenMasterCounts[sName] !== undefined ? screenMasterCounts[sName] : config.masterCount;
        var newCount = Math.max(0, currentCount + delta);
        screenMasterCounts[sName] = newCount;

        log("adjustMasterCount delta=" + delta + " target=" + sName + " newCount=" + newCount);
        masterHudDialog.popup(scr, newCount);
        retileNow();
    }

    function showMasterDialog(targetScreen) {
        var scr = targetScreen || getCurrentTargetScreen();
        var sName = getScreenName(scr);
        var curCount = screenMasterCounts[sName] !== undefined ? screenMasterCounts[sName] : config.masterCount;
        log("showMasterDialog target=" + sName + " curCount=" + curCount);
        masterHudDialog.popup(scr, curCount);
    }

    function toggleOverlay() {
        if (overlayDialog.visible) {
            overlayDialog.hideOverlay();
        } else {
            overlayDialog.showOverlay(Workspace.activeWindow);
        }
    }

    function moveWindowToNextScreen(forward) {
        var w = Workspace.activeWindow;
        if (!w || !w.normalWindow) return;

        var screens = Workspace.screens || [];
        if (screens.length <= 1) {
            osdCall.notify("Single Display Setup", "preferences-desktop-display");
            return;
        }

        var currentScreen = getScreenForPos(w.frameGeometry);
        var currentIdx = screens.indexOf(currentScreen);
        if (currentIdx === -1) currentIdx = 0;

        var nextIdx = forward !== false ? ((currentIdx + 1) % screens.length) : ((currentIdx - 1 + screens.length) % screens.length);
        var targetScreen = screens[nextIdx];

        var fromName = getScreenName(currentScreen);
        var toName = getScreenName(targetScreen);
        var wid = getWindowId(w);

        if (runtimeMode === "legacy-fallback") {
            // Remove from old screen's persistent order
            var oldList = persistentScreenOrder[fromName] || [];
            var cleanList = [];
            for (var i = 0; i < oldList.length; i++) {
                if (oldList[i] !== wid) cleanList.push(oldList[i]);
            }
            persistentScreenOrder[fromName] = cleanList;

            // Add to new screen's persistent order
            var newList = persistentScreenOrder[toName] || [];
            if (newList.indexOf(wid) === -1) {
                newList.push(wid);
            }
            persistentScreenOrder[toName] = newList;
        }

        var toArea = Workspace.clientArea(KWin.MaximizeArea, targetScreen, Workspace.currentDesktop);
        var curW = Math.min(w.frameGeometry.width, toArea.width - (config.gapOuter * 2));
        var curH = Math.min(w.frameGeometry.height, toArea.height - (config.gapOuter * 2));
        var newX = toArea.x + Math.floor((toArea.width - curW) / 2);
        var newY = toArea.y + Math.floor((toArea.height - curH) / 2);
        w.frameGeometry = Qt.rect(newX, newY, curW, curH);

        osdCall.notify("Window Moved to " + toName, "preferences-desktop-display");
        retileNow();
    }

    function cycleOtherScreenLayout() {
        var screens = Workspace.screens || [];
        if (screens.length <= 1) return;

        var currentScreen = getCurrentTargetScreen();
        var currentIdx = screens.indexOf(currentScreen);
        if (currentIdx === -1) currentIdx = 0;

        var targetScreen = screens[(currentIdx + 1) % screens.length];
        var sName = getScreenName(targetScreen);

        var current = getActiveLayout(targetScreen);
        var idx = currentLayoutList.indexOf(current);
        if (idx === -1) idx = 0;
        idx = (idx + 1) % currentLayoutList.length;
        var nextLayout = currentLayoutList[idx];

        var key = getLayoutKey(targetScreen);
        screenLayouts[key] = nextLayout;

        osdCall.notify(sName + " Layout: " + nextLayout.toUpperCase(), "preferences-desktop-virtual");
        retileNow();
    }

    function swapScreenLayouts() {
        var screens = Workspace.screens || [];
        if (screens.length < 2) return;

        var s0Name = getScreenName(screens[0]);
        var s1Name = getScreenName(screens[1]);
        var deskKey = getCurrentDesktopKey();

        var key0 = s0Name + ":" + deskKey;
        var key1 = s1Name + ":" + deskKey;

        var l0 = screenLayouts[key0] || desktopLayouts[deskKey] || config.defaultLayout;
        var l1 = screenLayouts[key1] || desktopLayouts[deskKey] || config.defaultLayout;

        screenLayouts[key0] = l1;
        screenLayouts[key1] = l0;

        var r0 = screenMasterRatios[s0Name] || config.masterRatio;
        var r1 = screenMasterRatios[s1Name] || config.masterRatio;
        screenMasterRatios[s0Name] = r1;
        screenMasterRatios[s1Name] = r0;

        osdCall.notify("Swapped Layouts: " + s0Name + " ↔ " + s1Name, "preferences-desktop-display");
        retileNow();
    }

    // =========================================================================
    // 10. Global Keyboard Shortcuts (100% Ctrl-Based, Left-Hand Optimized)
    // =========================================================================

    ShortcutHandler {
        name: "Tessera: Toggle Zone Overlay"
        text: "Tessera: Toggle Zone Overlay"
        sequence: "Ctrl+Shift+C"
        onActivated: root.toggleOverlay()
    }

    ShortcutHandler {
        name: "Tessera: Next Layout"
        text: "Tessera: Next Layout"
        sequence: "Ctrl+Space"
        onActivated: root.cycleLayout(true)
    }

    ShortcutHandler {
        name: "Tessera: Previous Layout"
        text: "Tessera: Previous Layout"
        sequence: "Ctrl+Shift+Space"
        onActivated: root.cycleLayout(false)
    }

    ShortcutHandler {
        name: "Tessera: Toggle Tiling"
        text: "Tessera: Toggle Tiling"
        sequence: "Ctrl+Shift+T"
        onActivated: root.toggleTiling()
    }

    ShortcutHandler {
        name: "Tessera: Toggle Window Floating"
        text: "Tessera: Toggle Window Floating"
        sequence: "Ctrl+Shift+F"
        onActivated: root.toggleActiveFloating()
    }

    ShortcutHandler {
        name: "Tessera: Toggle Window Floating (Meta)"
        text: "Tessera: Toggle Window Floating (Meta Alternative)"
        sequence: "Meta+Shift+F"
        onActivated: root.toggleActiveFloating()
    }

    // Left-Hand Directional Navigation (WASD)
    ShortcutHandler {
        name: "Tessera: Focus Left Window"
        text: "Tessera: Focus Left Window"
        sequence: "Ctrl+Shift+A"
        onActivated: root.focusWindow(false)
    }

    ShortcutHandler {
        name: "Tessera: Focus Right Window"
        text: "Tessera: Focus Right Window"
        sequence: "Ctrl+Shift+D"
        onActivated: root.focusWindow(true)
    }

    ShortcutHandler {
        name: "Tessera: Focus Up Window"
        text: "Tessera: Focus Up Window"
        sequence: "Ctrl+Shift+W"
        onActivated: root.focusWindow(false)
    }

    ShortcutHandler {
        name: "Tessera: Focus Down Window"
        text: "Tessera: Focus Down Window"
        sequence: "Ctrl+Shift+S"
        onActivated: root.focusWindow(true)
    }

    ShortcutHandler {
        name: "Tessera: Swap Left Window"
        text: "Tessera: Swap Left Window"
        sequence: "Ctrl+Shift+Q"
        onActivated: root.swapWindow(false)
    }

    ShortcutHandler {
        name: "Tessera: Swap Right Window"
        text: "Tessera: Swap Right Window"
        sequence: "Ctrl+Shift+E"
        onActivated: root.swapWindow(true)
    }

    ShortcutHandler {
        name: "Tessera: Focus Next Window"
        text: "Tessera: Focus Next Window"
        sequence: "Ctrl+Shift+J"
        onActivated: root.focusWindow(true)
    }

    ShortcutHandler {
        name: "Tessera: Focus Previous Window"
        text: "Tessera: Focus Previous Window"
        sequence: "Ctrl+Shift+K"
        onActivated: root.focusWindow(false)
    }

    ShortcutHandler {
        name: "Tessera: Swap Window Forward"
        text: "Tessera: Swap Window Forward"
        sequence: "Ctrl+Alt+J"
        onActivated: root.swapWindow(true)
    }

    ShortcutHandler {
        name: "Tessera: Swap Window Backward"
        text: "Tessera: Swap Window Backward"
        sequence: "Ctrl+Alt+K"
        onActivated: root.swapWindow(false)
    }

    ShortcutHandler {
        name: "Tessera: Increase Master Ratio"
        text: "Tessera: Increase Master Ratio"
        sequence: "Ctrl+Shift+L"
        onActivated: root.adjustMasterRatio(0.05)
    }

    ShortcutHandler {
        name: "Tessera: Decrease Master Ratio"
        text: "Tessera: Decrease Master Ratio"
        sequence: "Ctrl+Shift+H"
        onActivated: root.adjustMasterRatio(-0.05)
    }

    ShortcutHandler {
        name: "Tessera: Increase Master Count"
        text: "Tessera: Increase Master Count"
        sequence: "Ctrl+Shift+I"
        onActivated: root.adjustMasterCount(1)
    }

    ShortcutHandler {
        name: "Tessera: Decrease Master Count"
        text: "Tessera: Decrease Master Count"
        sequence: "Ctrl+Shift+O"
        onActivated: root.adjustMasterCount(-1)
    }

    ShortcutHandler {
        name: "Tessera: Retile Current Workspace"
        text: "Tessera: Retile Current Workspace"
        sequence: "Ctrl+Shift+R"
        onActivated: {
            root.loadConfig();
            root.retileNow();
        }
    }

    // Screen Switching & Cross-Monitor Actions (Left-Hand Accessible)
    ShortcutHandler {
        name: "Tessera: Move Window to Next Screen"
        text: "Tessera: Move Window to Next Screen"
        sequence: "Ctrl+Shift+Z"
        onActivated: root.moveWindowToNextScreen(true)
    }

    ShortcutHandler {
        name: "Tessera: Cycle Layout on Other Screen"
        text: "Tessera: Cycle Layout on Other Screen"
        sequence: "Ctrl+Shift+X"
        onActivated: root.cycleOtherScreenLayout()
    }

    ShortcutHandler {
        name: "Tessera: Swap Screen Layouts"
        text: "Tessera: Swap Screen Layouts"
        sequence: "Ctrl+Alt+X"
        onActivated: root.swapScreenLayouts()
    }

    ShortcutHandler {
        name: "Tessera: Show Master HUD"
        text: "Tessera: Show Master HUD"
        sequence: "Ctrl+Shift+M"
        onActivated: root.showMasterDialog()
    }

    Component.onCompleted: {
        log("Tessera Declarative Extension loaded with KZones-Style Visual Snap Overlay");
        loadConfig();
        initRuntimeMode();
        retileNow();
    }

    Component.onDestruction: {
        log("Tessera unloading: cleaning up window hooks");
        var allWins = Workspace.stackingOrder || [];
        for (var i = 0; i < allWins.length; i++) {
            unhookWindow(allWins[i]);
        }
    }
}
