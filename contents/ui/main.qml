import QtQuick
import QtQuick.Layouts
import org.kde.kwin
import org.kde.plasma.core as PlasmaCore

import "../code/reconciler.js" as ReconcilerModule

Item {
    id: root

    // =========================================================================
    // 1. Configuration Properties
    // =========================================================================
    property var config: ({
        enableTiling: true,
        defaultLayout: "balanced-grid",
        gapInner: 8,
        gapOuter: 10,
        primaryRegionRatio: 0.50,
        primaryRegionCount: 1,
        reconcileDebounceMs: 60,
        perDesktopLayout: true,
        tileNewWindows: true,
        showOsd: true,
        smoothResize: false,
        ignoreMinimized: true,
        gameWindowPolicy: "floating",
        floatFilter: "tessera,tessera-settings,tessera_settings.py",
        customRulesJson: "[]",
        workspaceLayoutsJson: '{"version":1,"scopes":{}}'
    })

    // =========================================================================
    // 2. State Tracking
    // =========================================================================
    property var wasDraggingMaximized: ({}) // windowId -> boolean
    property var currentLayoutList: ["balanced-grid", "primary-stack", "binary-split", "columns", "rows", "monocle", "floating"]
    property bool isArranging: false
    property var currentDraggingWindow: null

    // Runtime Mode: "reconciler" (single runtime authority)
    property string runtimeMode: "reconciler"

    function initRuntimeMode() {
        runtimeMode = "reconciler";
        log("Runtime mode initialized: reconciler (single authority)");
    }

    function getSavedTiledGeometry(wid) {
        var coord = getCoordinator();
        if (coord) {
            var g = coord.getSavedTiledGeometry(wid);
            if (g) return Qt.rect(g.x, g.y, g.width, g.height);
        }
        return null;
    }

    function setSavedTiledGeometry(wid, rect) {
        if (!rect) return;
        var coord = getCoordinator();
        if (coord) {
            coord.setSavedTiledGeometry(wid, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }
    }

    function getPreMinimizeGeometry(wid) {
        var coord = getCoordinator();
        if (coord) {
            var g = coord.getPreMinimizeGeometry(wid);
            if (g) return Qt.rect(g.x, g.y, g.width, g.height);
        }
        return null;
    }

    function setPreMinimizeGeometry(wid, rect) {
        if (!rect) return;
        var coord = getCoordinator();
        if (coord) {
            coord.setPreMinimizeGeometry(wid, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
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
        var readDefLayout = KWin.readConfig("defaultLayout", "balanced-grid");
        if (readDefLayout === "master-stack") {
            readDefLayout = "primary-stack";
        }
        config.defaultLayout = readDefLayout || "balanced-grid";
        config.gapInner = KWin.readConfig("gapInner", 8);
        config.gapOuter = KWin.readConfig("gapOuter", 10);
        config.primaryRegionRatio = KWin.readConfig("primaryRegionRatio", KWin.readConfig("masterRatio", 0.50));
        config.primaryRegionCount = KWin.readConfig("primaryRegionCount", KWin.readConfig("masterCount", 1));
        config.reconcileDebounceMs = KWin.readConfig("reconcileDebounceMs", KWin.readConfig("nvidiaDebounceMs", 60));
        config.perDesktopLayout = KWin.readConfig("perDesktopLayout", true);
        config.tileNewWindows = KWin.readConfig("tileNewWindows", true);
        config.showOsd = KWin.readConfig("showOsd", true);
        config.smoothResize = KWin.readConfig("smoothResize", false);
        config.ignoreMinimized = KWin.readConfig("ignoreMinimized", true);
        config.gameWindowPolicy = KWin.readConfig("gameWindowPolicy", "floating");
        config.floatFilter = KWin.readConfig("floatFilter", "tessera,tessera-settings,tessera_settings.py");
        config.customRulesJson = KWin.readConfig("customRulesJson", "[]");
        config.workspaceLayoutsJson = KWin.readConfig("workspaceLayoutsJson", '{"version":1,"scopes":{}}');

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
                primaryRegionRatio: config.primaryRegionRatio,
                primaryRegionCount: config.primaryRegionCount,
                perDesktopLayout: config.perDesktopLayout,
                ignoreMinimized: config.ignoreMinimized,
                gameWindowPolicy: config.gameWindowPolicy || "floating",
                floatFilter: config.floatFilter,
                customRules: config.customRulesJson,
                workspaceLayoutsJson: config.workspaceLayoutsJson
            });
        }

        log("Config reloaded live: gaps=" + config.gapInner + "/" + config.gapOuter + " ratio=" + config.primaryRegionRatio + " tiling=" + config.enableTiling);
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
        var sName = getScreenName(scr);
        var deskKey = getCurrentDesktopKey();
        var coord = getCoordinator();
        if (coord) {
            var ws = coord.getOrCreateWorkspace(sName, deskKey);
            return ws.activeLayout || config.defaultLayout || "balanced-grid";
        }
        return config.defaultLayout || "balanced-grid";
    }

    function setActiveLayout(layoutName, screen) {
        var scr = screen || getCurrentTargetScreen();
        var sName = getScreenName(scr);
        var deskKey = getCurrentDesktopKey();
        var coord = getCoordinator();
        if (coord) {
            coord.ingestEvent({
                type: "WorkspaceLayoutChanged",
                outputId: sName,
                desktopId: deskKey,
                layout: layoutName
            });
        }
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

    function checkFilter(w) {
        if (!w) return false;
        var coord = getCoordinator();
        if (coord) {
            var ret = coord.getRetainedWindow(getWindowId(w));
            if (ret) return ret.tileable;
        }
        return true;
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
                primaryRegionRatio: config.primaryRegionRatio,
                primaryRegionCount: config.primaryRegionCount,
                perDesktopLayout: config.perDesktopLayout,
                ignoreMinimized: config.ignoreMinimized,
                gameWindowPolicy: config.gameWindowPolicy || "floating",
                floatFilter: config.floatFilter,
                customRules: config.customRulesJson,
                workspaceLayoutsJson: config.workspaceLayoutsJson
            });
        }
        return coordinator;
    }

    Timer {
        id: reconcileTimer
        interval: Math.max(0, config.reconcileDebounceMs || 0)
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

    function commitWindowGeometry(win, targetRect, reason, epoch) {
        if (!win || !targetRect) return { outcome: "rejected", normalized: null };

        var coord = getCoordinator();
        if (!coord) {
            return { outcome: "rejected", normalized: null };
        }

        var targetScr = getScreenForPos(targetRect) || win.output || (win.frameGeometry ? getScreenForPos(win.frameGeometry) : null);
        var bounds = targetScr ? Workspace.clientArea(KWin.MaximizeArea, targetScr, Workspace.currentDesktop) : null;
        var evalResult = ReconcilerModule.ReconcilerBridge.evaluateCommitGeometry(win, targetRect, bounds);
        if (evalResult.outcome === "rejected") {
            return { outcome: "rejected", normalized: null };
        }
        if (evalResult.outcome === "unchanged-valid") {
            return { outcome: "unchanged-valid", normalized: evalResult.normalized };
        }

        var normalized = evalResult.normalized;
        var wid = getWindowId(win);
        try {
            coord.recordCommand(wid, normalized, epoch || 0);
            win.frameGeometry = Qt.rect(normalized.x, normalized.y, normalized.width, normalized.height);
            return { outcome: "applied", normalized: normalized };
        } catch (err) {
            coord.clearRecordedCommand(wid);
            return { outcome: "rejected", normalized: null };
        }
    }

    function synchronizeScreenTopology(coord) {
        if (!coord) return;
        var screens = Workspace.screens || [Workspace.activeScreen];
        var normScreens = [];
        for (var s = 0; s < screens.length; s++) {
            var scr = screens[s];
            if (!scr) continue;
            var area = Workspace.clientArea(KWin.MaximizeArea, scr, Workspace.currentDesktop);
            if (!area || area.width <= 0 || area.height <= 0) continue;
            normScreens.push(ReconcilerModule.ReconcilerBridge.toNormalizedScreen(scr, area, Workspace.currentDesktop, Workspace.currentActivity));
        }
        coord.ingestEvent({
            type: "ScreenTopologyChanged",
            screens: normScreens
        });
        for (var i = 0; i < normScreens.length; i++) {
            var retScr = coord.getOrCreateScreen(normScreens[i]);
            if (retScr) {
                retScr.gaps = { inner: config.gapInner, outer: config.gapOuter };
            }
        }
    }

    function performReconciliation() {
        if (!config.enableTiling || isArranging) return;

        var coord = getCoordinator();
        if (!coord) {
            log("Warning: coordinator unavailable in reconciler mode");
            return;
        }

        // 1. Synchronize screen topology with coordinator
        synchronizeScreenTopology(coord);

        // 2. Synchronize active windows into coordinator retained records
        var allWins = Workspace.stackingOrder || [];
        for (var wIdx = 0; wIdx < allWins.length; wIdx++) {
            var winObj = allWins[wIdx];
            if (!winObj || !winObj.managed || !winObj.normalWindow) continue;
            var wid = getWindowId(winObj);
            var wScr = winObj.output || getScreenForPos(winObj.frameGeometry);
            var wArea = wScr ? Workspace.clientArea(KWin.MaximizeArea, wScr, Workspace.currentDesktop) : null;
            var normWin = ReconcilerModule.ReconcilerBridge.toNormalizedWindow(winObj, wScr, wArea);
            normWin.isManualFloating = coord.isManualFloating(wid);
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
        var tx = coord.reconcile();
        if (!tx || tx.operations.length === 0) {
            return;
        }

        var diag = coord.getDiagnostics();
        log("Reconciliation tx: ops=" + tx.operations.length + " reasons=" + (diag.lastTransactionReasons.join(",") || "none") + " totalTx=" + diag.totalReconciliationTransactions + " totalWrites=" + diag.totalGeometryWrites + " skippedWrites=" + diag.skippedIdenticalWrites + " suppressedEchoes=" + diag.suppressedGeometryEchoes + " retainedWins=" + diag.retainedWindowCount + " retainedScreens=" + diag.retainedScreenCount);

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

                if (targetWin.maximizeMode !== 0) {
                    continue;
                }

                var opWid = op.windowId;
                if (allWins.length === 1 && coord.isPreTiled(opWid)) {
                    continue;
                }

                var reconResult = commitWindowGeometry(targetWin, op.targetRect, "reconciliation", op.epoch);
                if (reconResult.outcome !== "rejected" && reconResult.normalized) {
                    setSavedTiledGeometry(opWid, reconResult.normalized);
                    coord.setPreTiled(opWid, false);
                }
            }
        } catch (err) {
            log("Reconciliation error: internal_failure");
        } finally {
            isArranging = false;
        }
    }

    function retileScreen() {
        performReconciliation();
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
        performReconciliation();
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

            // 2. Left Half (Primary Slot)
            zones.push({
                type: "half",
                id: "left-half",
                title: "Left Half (Primary)",
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
                slotIndex: 3,
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
                slotIndex: 2,
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
            // The visual snap overlay card clearly indicates the target placement.
            // Windows are reconciled authoritatively by the coordinator on commit.
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
            if (w.desktopsChanged && h.desktops) w.desktopsChanged.disconnect(h.desktops);
            if (w.activitiesChanged && h.activities) w.activitiesChanged.disconnect(h.activities);
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
                    commitWindowGeometry(w, { x: newX, y: newY, width: targetW, height: targetH }, "drag_start");
                } else {
                    wasDraggingMaximized[wid] = false;
                }
                var isFromMaximized = !!wasDraggingMaximized[wid];
                log("Drag started" + (isFromMaximized ? " (from maximized)" : ""));
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
                log("Drag finished");
                var wid = getWindowId(w);
                var target = overlayDialog ? overlayDialog.finishDrag() : null;
                if (target) {
                    if (target.type === "maximize") {
                        if (typeof w.setMaximize === "function") {
                            w.setMaximize(true, true);
                        }
                        if (coordinator) {
                            coordinator.setManualFloating(wid, false);
                        }
                        osdCall.notify("Maximized", "preferences-system-windows");
                    } else {
                        if (typeof w.setMaximize === "function") {
                            w.setMaximize(false, false);
                        }
                        var snapResult = commitWindowGeometry(w, target.targetRect, "snap_drop");
                        if (snapResult.outcome !== "rejected" && snapResult.normalized) {
                            if (coordinator) {
                                coordinator.setManualFloating(wid, false);
                                coordinator.setPreTiled(wid, true);
                            }

                            var scr = getScreenForPos(target.targetRect);
                            var sName = getScreenName(scr);
                            var coord = getCoordinator();
                            if (coord) {
                                coord.ingestEvent({
                                    type: "WindowSnapCommitted",
                                    windowId: wid,
                                    outputId: sName,
                                    targetRect: {
                                        x: snapResult.normalized.x,
                                        y: snapResult.normalized.y,
                                        width: snapResult.normalized.width,
                                        height: snapResult.normalized.height
                                    },
                                    slotIndex: target.slotIndex,
                                    desktopId: getCurrentDesktopKey()
                                });
                            }

                            setSavedTiledGeometry(wid, snapResult.normalized);

                            osdCall.notify("Snapped: " + target.title, "preferences-system-windows");
                        }
                    }
                } else {
                    // Dropped outside any snap zone
                    if (wasDraggingMaximized[wid]) {
                        if (coordinator) {
                            coordinator.setManualFloating(wid, false);
                        }
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
                    var unminResult = commitWindowGeometry(w, g, "unminimize");
                    if (unminResult.outcome !== "rejected" && unminResult.normalized) {
                        setSavedTiledGeometry(wid, unminResult.normalized);
                    }
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
            var wid = getWindowId(w);
            var coord = getCoordinator();
            if (coord) {
                coord.ingestEvent({
                    type: "WindowStateChanged",
                    windowId: wid,
                    updates: { fullScreen: Boolean(w.fullScreen) }
                });
            }
            scheduleReconcile(w.fullScreen ? "WindowFullscreenEntered" : "WindowFullscreenExited");
        };

        var onMaximizedAboutToChange = function(mode) {
            // Coordinator maintains window state authority
        };

        var onMaximizedChanged = function() {
            if (!root || !root.coordinator || isArranging) return;
            var wid = getWindowId(w);
            var coord = getCoordinator();
            if (coord) {
                coord.setPreTiled(wid, false);
            }
            if (w.maximizeMode === 0) {
                if (coord) {
                    coord.setManualFloating(wid, false);
                }
                var target = getSavedTiledGeometry(wid);
                if (target) {
                    var unmaxResult = commitWindowGeometry(w, target, "unmaximize");
                    if (unmaxResult.outcome !== "rejected" && unmaxResult.normalized) {
                        setSavedTiledGeometry(wid, unmaxResult.normalized);
                    }
                }
            }
            if (coord) {
                coord.ingestEvent({
                    type: "WindowStateChanged",
                    windowId: wid,
                    updates: { maximizeMode: w.maximizeMode }
                });
            }
            scheduleReconcile("WindowMaximizedChanged");
        };

        var onNoBorderChanged = function() {
            if (!root || !root.coordinator || isArranging) return;
            var wid = getWindowId(w);
            var coord = getCoordinator();
            if (coord) {
                coord.ingestEvent({
                    type: "WindowStateChanged",
                    windowId: wid,
                    updates: { noBorder: Boolean(w.noBorder) }
                });
            }
            scheduleReconcile("WindowNoBorderChanged");
        };

        var onOutputChanged = function() {
            if (!root || !root.coordinator || isArranging) return;
            scheduleReconcile("WindowOutputChanged");
        };

        var onDesktopsChanged = function() {
            if (!root || !root.coordinator || isArranging) return;
            var wid = getWindowId(w);
            var coord = getCoordinator();
            if (coord) {
                var dIds = [];
                if (w.desktops) {
                    for (var dIdx = 0; dIdx < w.desktops.length; dIdx++) {
                        dIds.push(w.desktops[dIdx].id || String(w.desktops[dIdx]));
                    }
                }
                coord.ingestEvent({
                    type: "WindowDesktopsChanged",
                    windowId: wid,
                    desktopIds: dIds,
                    onAllDesktops: (w.onAllDesktops === true)
                });
            }
            scheduleReconcile("WindowDesktopsChanged");
        };

        var onActivitiesChanged = function() {
            if (!root || !root.coordinator || isArranging) return;
            var wid = getWindowId(w);
            var coord = getCoordinator();
            if (coord) {
                var acts = [];
                if (w.activities) {
                    for (var aIdx = 0; aIdx < w.activities.length; aIdx++) {
                        acts.push(String(w.activities[aIdx]));
                    }
                }
                coord.ingestEvent({
                    type: "WindowActivitiesChanged",
                    windowId: wid,
                    activities: acts
                });
            }
            scheduleReconcile("WindowActivitiesChanged");
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
        if (w.desktopsChanged) {
            hooks.desktops = onDesktopsChanged;
            w.desktopsChanged.connect(onDesktopsChanged);
        }
        if (w.activitiesChanged) {
            hooks.activities = onActivitiesChanged;
            w.activitiesChanged.connect(onActivitiesChanged);
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
            delete wasDraggingMaximized[wid];

            var coord = getCoordinator();
            if (coord) {
                coord.setSavedTiledGeometry(wid, null);
                coord.setPreMinimizeGeometry(wid, null);
                coord.setPreTiled(wid, false);
                coord.ingestEvent({ type: "WindowRemoved", windowId: wid });
            }

            scheduleReconcile("WindowRemoved");
        }

        function onCurrentDesktopChanged() {
            var coord = getCoordinator();
            if (coord) {
                var deskKey = getCurrentDesktopKey();
                var screens = Workspace.screens || [Workspace.activeScreen];
                for (var s = 0; s < screens.length; s++) {
                    var scr = screens[s];
                    if (!scr) continue;
                    var sName = getScreenName(scr);
                    coord.ingestEvent({
                        type: "ScreenDesktopChanged",
                        outputId: sName,
                        toDesktopId: deskKey
                    });
                }
            }
            scheduleReconcile("DesktopChanged");
        }

        function onScreensChanged() {
            var coord = getCoordinator();
            if (coord) {
                synchronizeScreenTopology(coord);
            }
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
        var coord = getCoordinator();
        var currentlyFloating = coord ? coord.isManualFloating(wid) : false;
        var nextFloating = !currentlyFloating;

        var coordAfter = false;
        if (coord) {
            coord.setManualFloating(wid, nextFloating);
            if (nextFloating) {
                coord.setPreTiled(wid, false);
            }
            coordAfter = coord.isManualFloating(wid);
        }

        log("manual floating: " + currentlyFloating + " -> " + nextFloating + ", coordinator: " + currentlyFloating + " -> " + coordAfter);

        osdCall.notify(nextFloating ? "Window Floating" : "Window Tiled", "preferences-system-windows");
        retileNow();
    }

    function focusWindow(forward) {
        var s = Workspace.activeScreen;
        var sName = getScreenName(s);
        var deskKey = getCurrentDesktopKey();
        var coord = getCoordinator();
        if (!coord) return;

        var ws = coord.getOrCreateWorkspace(sName, deskKey);
        var order = ws.orderedSlotWindowIds || [];
        if (order.length <= 1) return;

        var curWin = Workspace.activeWindow;
        var curWid = curWin ? getWindowId(curWin) : null;
        var currentIdx = curWid ? order.indexOf(curWid) : -1;
        if (currentIdx === -1) currentIdx = 0;

        var nextIdx = forward ? ((currentIdx + 1) % order.length) : ((currentIdx - 1 + order.length) % order.length);
        var nextWid = order[nextIdx];

        var allWins = Workspace.stackingOrder || [];
        for (var i = 0; i < allWins.length; i++) {
            if (getWindowId(allWins[i]) === nextWid) {
                Workspace.activeWindow = allWins[i];
                return;
            }
        }
    }

    function swapWindow(forward) {
        var s = Workspace.activeScreen;
        var sName = getScreenName(s);
        var deskKey = getCurrentDesktopKey();
        var coord = getCoordinator();
        if (!coord) return;

        var ws = coord.getOrCreateWorkspace(sName, deskKey);
        var order = ws.orderedSlotWindowIds || [];
        if (order.length <= 1) return;

        var curWin = Workspace.activeWindow;
        if (!curWin) return;
        var curWid = getWindowId(curWin);
        var currentIdx = order.indexOf(curWid);
        if (currentIdx === -1) return;

        var targetIdx = forward ? ((currentIdx + 1) % order.length) : ((currentIdx - 1 + order.length) % order.length);
        var targetWid = order[targetIdx];

        coord.swapWindowSlots(curWid, targetWid);
        retileNow();
    }

    function adjustMasterRatio(delta) {
        var scr = getCurrentTargetScreen();
        var sName = getScreenName(scr);
        var deskKey = getCurrentDesktopKey();
        var coord = getCoordinator();
        var currentRatio = config.primaryRegionRatio;
        if (coord) {
            var ws = coord.getOrCreateWorkspace(sName, deskKey);
            currentRatio = ws.primaryRegionRatio;
        }

        var newRatio = Math.max(0.1, Math.min(0.9, currentRatio + delta));
        newRatio = Math.round(newRatio * 100) / 100;
        if (coord) {
            coord.ingestEvent({
                type: "WorkspacePrimaryConfigChanged",
                outputId: sName,
                desktopId: deskKey,
                ratio: newRatio
            });
        }

        osdCall.notify(sName + " Primary Ratio: " + Math.round(newRatio * 100) + "%", "preferences-desktop-virtual");
        retileNow();
    }

    function adjustMasterCount(delta) {
        var scr = getCurrentTargetScreen();
        var sName = getScreenName(scr);
        var deskKey = getCurrentDesktopKey();
        var coord = getCoordinator();
        var currentCount = config.primaryRegionCount;
        if (coord) {
            var ws = coord.getOrCreateWorkspace(sName, deskKey);
            currentCount = ws.primaryRegionCount;
        }

        var newCount = Math.max(0, Math.min(10, currentCount + delta));
        if (coord) {
            coord.ingestEvent({
                type: "WorkspacePrimaryConfigChanged",
                outputId: sName,
                desktopId: deskKey,
                count: newCount
            });
        }

        log("adjustPrimaryCount delta=" + delta + " newCount=" + newCount);
        osdCall.notify(sName + " Primary Regions: " + newCount, "preferences-system-windows");
        retileNow();
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

        var toName = getScreenName(targetScreen);

        var toArea = Workspace.clientArea(KWin.MaximizeArea, targetScreen, Workspace.currentDesktop);
        var curW = Math.min(w.frameGeometry.width, toArea.width - (config.gapOuter * 2));
        var curH = Math.min(w.frameGeometry.height, toArea.height - (config.gapOuter * 2));
        var newX = toArea.x + Math.floor((toArea.width - curW) / 2);
        var newY = toArea.y + Math.floor((toArea.height - curH) / 2);
        var moveResult = commitWindowGeometry(w, { x: newX, y: newY, width: curW, height: curH }, "move_screen");
        if (moveResult.outcome !== "rejected") {
            osdCall.notify("Window Moved to " + toName, "preferences-desktop-display");
            retileNow();
        }
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

        setActiveLayout(nextLayout, targetScreen);
    }

    function swapScreenLayouts() {
        var screens = Workspace.screens || [];
        if (screens.length < 2) return;

        var s0Name = getScreenName(screens[0]);
        var s1Name = getScreenName(screens[1]);
        var deskKey = getCurrentDesktopKey();
        var coord = getCoordinator();
        if (!coord) return;

        var ws0 = coord.getOrCreateWorkspace(s0Name, deskKey);
        var ws1 = coord.getOrCreateWorkspace(s1Name, deskKey);

        var l0 = ws0.activeLayout;
        var l1 = ws1.activeLayout;
        var r0 = ws0.primaryRegionRatio;
        var r1 = ws1.primaryRegionRatio;
        var c0 = ws0.primaryRegionCount;
        var c1 = ws1.primaryRegionCount;

        coord.ingestEvent({
            type: "WorkspaceLayoutChanged",
            outputId: s0Name,
            desktopId: deskKey,
            layout: l1
        });
        coord.ingestEvent({
            type: "WorkspaceLayoutChanged",
            outputId: s1Name,
            desktopId: deskKey,
            layout: l0
        });
        coord.ingestEvent({
            type: "WorkspacePrimaryConfigChanged",
            outputId: s0Name,
            desktopId: deskKey,
            ratio: r1,
            count: c1
        });
        coord.ingestEvent({
            type: "WorkspacePrimaryConfigChanged",
            outputId: s1Name,
            desktopId: deskKey,
            ratio: r0,
            count: c0
        });

        osdCall.notify("Swapped Layouts: " + s0Name + " ↔ " + s1Name, "preferences-desktop-display");
        retileNow();
    }

    // =========================================================================
    // 10. Global Keyboard Shortcuts (100% Ctrl-Based, Left-Hand Optimized)
    // =========================================================================

    ShortcutHandler {
        name: "Tessera: Toggle Zone Overlay"
        text: "Toggle Zone Overlay (KZones-Style)"
        sequence: "Ctrl+Shift+C"
        onActivated: root.toggleOverlay()
    }

    ShortcutHandler {
        name: "Tessera: Next Layout"
        text: "Cycle to Next Layout"
        sequence: "Ctrl+Space"
        onActivated: root.cycleLayout(true)
    }

    ShortcutHandler {
        name: "Tessera: Previous Layout"
        text: "Cycle to Previous Layout"
        sequence: "Ctrl+Shift+Space"
        onActivated: root.cycleLayout(false)
    }

    ShortcutHandler {
        name: "Tessera: Toggle Tiling"
        text: "Toggle Tiling Globally"
        sequence: "Ctrl+Shift+T"
        onActivated: root.toggleTiling()
    }

    ShortcutHandler {
        name: "Tessera: Toggle Window Floating"
        text: "Toggle Active Window Floating"
        sequence: "Ctrl+Shift+F"
        onActivated: root.toggleActiveFloating()
    }

    // Left-Hand Directional Navigation (WASD)
    ShortcutHandler {
        name: "Tessera: Focus Left Window"
        text: "Focus Left Window (WASD)"
        sequence: "Ctrl+Shift+A"
        onActivated: root.focusWindow(false)
    }

    ShortcutHandler {
        name: "Tessera: Focus Right Window"
        text: "Focus Right Window (WASD)"
        sequence: "Ctrl+Shift+D"
        onActivated: root.focusWindow(true)
    }

    ShortcutHandler {
        name: "Tessera: Focus Up Window"
        text: "Focus Up Window (WASD)"
        sequence: "Ctrl+Shift+W"
        onActivated: root.focusWindow(false)
    }

    ShortcutHandler {
        name: "Tessera: Focus Down Window"
        text: "Focus Down Window (WASD)"
        sequence: "Ctrl+Shift+S"
        onActivated: root.focusWindow(true)
    }

    ShortcutHandler {
        name: "Tessera: Swap Left Window"
        text: "Swap Window Left (Counter-Clockwise)"
        sequence: "Ctrl+Shift+Q"
        onActivated: root.swapWindow(false)
    }

    ShortcutHandler {
        name: "Tessera: Swap Right Window"
        text: "Swap Window Right (Clockwise)"
        sequence: "Ctrl+Shift+E"
        onActivated: root.swapWindow(true)
    }

    ShortcutHandler {
        name: "Tessera: Focus Next Window"
        text: "Focus Next Window (Vim)"
        sequence: "Ctrl+Shift+J"
        onActivated: root.focusWindow(true)
    }

    ShortcutHandler {
        name: "Tessera: Focus Previous Window"
        text: "Focus Previous Window (Vim)"
        sequence: "Ctrl+Shift+K"
        onActivated: root.focusWindow(false)
    }

    ShortcutHandler {
        name: "Tessera: Swap Window Forward"
        text: "Swap Window Forward (Vim)"
        sequence: "Ctrl+Alt+J"
        onActivated: root.swapWindow(true)
    }

    ShortcutHandler {
        name: "Tessera: Swap Window Backward"
        text: "Swap Window Backward (Vim)"
        sequence: "Ctrl+Alt+K"
        onActivated: root.swapWindow(false)
    }

    ShortcutHandler {
        name: "Tessera: Increase Primary Ratio"
        text: "Expand Primary Region Ratio"
        sequence: "Ctrl+Shift+L"
        onActivated: root.adjustMasterRatio(0.05)
    }

    ShortcutHandler {
        name: "Tessera: Decrease Primary Ratio"
        text: "Shrink Primary Region Ratio"
        sequence: "Ctrl+Shift+H"
        onActivated: root.adjustMasterRatio(-0.05)
    }

    ShortcutHandler {
        name: "Tessera: Increase Primary Count"
        text: "Increase Primary Region Count"
        sequence: "Ctrl+Shift+I"
        onActivated: root.adjustMasterCount(1)
    }

    ShortcutHandler {
        name: "Tessera: Decrease Primary Count"
        text: "Decrease Primary Region Count"
        sequence: "Ctrl+Shift+O"
        onActivated: root.adjustMasterCount(-1)
    }

    ShortcutHandler {
        name: "Tessera: Retile Current Workspace"
        text: "Force Retile Workspace"
        sequence: "Ctrl+Shift+R"
        onActivated: {
            root.loadConfig();
            root.retileNow();
        }
    }

    // Screen Switching & Cross-Monitor Actions (Left-Hand Accessible)
    ShortcutHandler {
        name: "Tessera: Move Window to Next Screen"
        text: "Move Window to Next Screen"
        sequence: "Ctrl+Shift+Z"
        onActivated: root.moveWindowToNextScreen(true)
    }

    ShortcutHandler {
        name: "Tessera: Cycle Layout on Other Screen"
        text: "Cycle Layout on Other Screen"
        sequence: "Ctrl+Shift+X"
        onActivated: root.cycleOtherScreenLayout()
    }

    ShortcutHandler {
        name: "Tessera: Swap Screen Layouts"
        text: "Swap Screen Layouts"
        sequence: "Ctrl+Alt+X"
        onActivated: root.swapScreenLayouts()
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
