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
        overlayPollingMs: 16,
        perDesktopLayout: true,
        tileNewWindows: true,
        showOsd: true,
        enableAnimations: true,
        animationDurationMs: 180,
        smoothResize: false,
        ignoreMinimized: true,
        gameWindowPolicy: "floating",
        floatFilter: "krunner,kcalc,systemsettings,pavucontrol,plasma-desktop,spectacle,kdialog,ksplashqml,org.kde.polkit-kde-authentication-agent-1",
        customRulesJson: "[]",
        workspaceLayoutsJson: '{"version":1,"scopes":{}}'
    })

    // =========================================================================
    // 2. State Tracking
    // =========================================================================
    property var wasDraggingMaximized: ({}) // windowId -> boolean
    property bool isArranging: false
    property var currentDraggingWindow: null
    property string lastRuleValidationError: ""

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
            readDefLayout = "balanced-grid";
        }
        if (readDefLayout !== "balanced-grid") {
            readDefLayout = "balanced-grid";
        }
        config.defaultLayout = readDefLayout || "balanced-grid";
        config.gapInner = KWin.readConfig("gapInner", 8);
        config.gapOuter = KWin.readConfig("gapOuter", 10);
        config.primaryRegionRatio = KWin.readConfig("primaryRegionRatio", KWin.readConfig("masterRatio", 0.50));
        config.primaryRegionCount = KWin.readConfig("primaryRegionCount", KWin.readConfig("masterCount", 1));
        config.reconcileDebounceMs = KWin.readConfig("reconcileDebounceMs", KWin.readConfig("nvidiaDebounceMs", 60));
        config.overlayPollingMs = KWin.readConfig("overlayPollingMs", 16);
        config.perDesktopLayout = KWin.readConfig("perDesktopLayout", true);
        config.tileNewWindows = KWin.readConfig("tileNewWindows", true);
        config.showOsd = KWin.readConfig("showOsd", true);
        config.enableAnimations = KWin.readConfig("enableAnimations", true);
        config.animationDurationMs = KWin.readConfig("animationDurationMs", 180);
        config.smoothResize = KWin.readConfig("smoothResize", false);
        config.ignoreMinimized = KWin.readConfig("ignoreMinimized", true);
        config.gameWindowPolicy = KWin.readConfig("gameWindowPolicy", "floating");
        config.floatFilter = KWin.readConfig("floatFilter", "krunner,kcalc,systemsettings,pavucontrol,plasma-desktop,spectacle,kdialog,ksplashqml,org.kde.polkit-kde-authentication-agent-1");
        config.customRulesJson = KWin.readConfig("customRulesJson", "[]");
        config.workspaceLayoutsJson = KWin.readConfig("workspaceLayoutsJson", '{"version":1,"scopes":{}}');

        if (!config.enableTiling || !config.enableAnimations) {
            if (windowAnimator) {
                windowAnimator.cancelAllAnimations(true);
            }
        }

        var allWins = Workspace.stackingOrder || [];
        for (var i = 0; i < allWins.length; i++) {
            hookWindow(allWins[i]);
        }
        var coord = getCoordinator();
        if (coord) {
            coord.updateConfig({
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

            var ruleErrors = (typeof coord.getLastCustomRuleErrors === "function")
                ? coord.getLastCustomRuleErrors()
                : [];
            if (ruleErrors && ruleErrors.length > 0) {
                var errCount = ruleErrors.length;
                var hasPriorValid = (typeof coord.hasPriorValidCustomRules === "function")
                    ? coord.hasPriorValidCustomRules()
                    : ((typeof coord.getLastValidCustomRules === "function")
                        && coord.getLastValidCustomRules().length > 0);
                var suffix = hasPriorValid ? "retaining previous rules" : "using default tiling";
                var errSummary = "Custom window rules invalid (" + errCount + " issue" + (errCount > 1 ? "s" : "") + ") - " + suffix;
                root.lastRuleValidationError = errSummary;
                log(errSummary);
                if (typeof osdCall !== "undefined" && osdCall && typeof osdCall.notify === "function") {
                    osdCall.notify(errSummary, "dialog-warning", true);
                }
            } else {
                root.lastRuleValidationError = "";
            }
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

        function notify(text, icon, force) {
            if (!config.showOsd && !force) return;
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

    function getScreenByName(name) {
        if (!name) return null;
        var screens = Workspace.screens || [];
        for (var i = 0; i < screens.length; i++) {
            if (screens[i] && (screens[i].name === name || getScreenName(screens[i]) === name)) {
                return screens[i];
            }
        }
        return null;
    }

    function resolveRegionTransition(currentRegion, direction) {
        if (typeof ReconcilerModule !== "undefined" && ReconcilerModule.ReconcilerBridge && ReconcilerModule.ReconcilerBridge.resolveRegionTransition) {
            return ReconcilerModule.ReconcilerBridge.resolveRegionTransition(currentRegion, direction);
        }
        if (direction === "left") {
            switch (currentRegion) {
                case "right-half": return "left-half";
                case "top-right": return "top-left";
                case "bottom-right": return "bottom-left";
                case "right-pillar": return "center-pillar";
                case "center-pillar": return "left-pillar";
                case "center-top": return "top-left";
                case "center-bottom": return "bottom-left";
                case "left-half": return "left-half";
                case "left-pillar": return "left-pillar";
                case "top-left": return "top-left";
                case "bottom-left": return "bottom-left";
                default: return "left-half";
            }
        } else if (direction === "right") {
            switch (currentRegion) {
                case "left-half": return "right-half";
                case "top-left": return "top-right";
                case "bottom-left": return "bottom-right";
                case "left-pillar": return "center-pillar";
                case "center-pillar": return "right-pillar";
                case "center-top": return "top-right";
                case "center-bottom": return "bottom-right";
                case "right-half": return "right-half";
                case "right-pillar": return "right-pillar";
                case "top-right": return "top-right";
                case "bottom-right": return "bottom-right";
                default: return "right-half";
            }
        } else if (direction === "up") {
            switch (currentRegion) {
                case "bottom-left": return "top-left";
                case "bottom-right": return "top-right";
                case "center-bottom": return "center-top";
                case "center-pillar": return "center-top";
                case "left-half": return "top-left";
                case "right-half": return "top-right";
                case "left-pillar": return "top-left";
                case "right-pillar": return "top-right";
                case "top-left": return "top-left";
                case "top-right": return "top-right";
                case "center-top": return "center-top";
                case "maximize": return "maximize";
                default: return "top-left";
            }
        } else if (direction === "down") {
            switch (currentRegion) {
                case "top-left": return "bottom-left";
                case "top-right": return "bottom-right";
                case "center-top": return "center-bottom";
                case "center-pillar": return "center-bottom";
                case "left-half": return "bottom-left";
                case "right-half": return "bottom-right";
                case "left-pillar": return "bottom-left";
                case "right-pillar": return "bottom-right";
                case "bottom-left": return "bottom-left";
                case "bottom-right": return "bottom-right";
                case "center-bottom": return "center-bottom";
                case "maximize": return "maximize";
                default: return "bottom-left";
            }
        }
        return "left-half";
    }

    function getLayoutKey(screen) {
        var scr = screen || getCurrentTargetScreen();
        var sName = getScreenName(scr);
        var deskKey = getCurrentDesktopKey();
        return sName + ":" + deskKey;
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

    // =========================================================================
    // Window Animation Engine (Real KWin 6 Geometry Interpolation)
    // =========================================================================
    Item {
        id: windowAnimator
        property var activeAnimations: ({})
        property int activeCount: 0
        property var writingWindowId: null

        Timer {
            id: animTimer
            interval: 16
            repeat: true
            running: false
            onTriggered: windowAnimator.step()
        }

        function isAnimating(wid) {
            return !!activeAnimations[wid];
        }

        function isExpectedIntermediate(wid, geom) {
            if (!geom) return false;
            var anim = activeAnimations[wid];
            if (!anim || !anim.expectedRect) return false;
            var exp = anim.expectedRect;
            var tolPos = 4;
            var tolSize = 32;
            return Math.abs(geom.x - exp.x) <= tolPos &&
                   Math.abs(geom.y - exp.y) <= tolPos &&
                   Math.abs(geom.width - exp.width) <= tolSize &&
                   Math.abs(geom.height - exp.height) <= tolSize;
        }

        function cancelAnimation(wid, clearCommand) {
            if (windowAnimator && windowAnimator.writingWindowId === wid) {
                windowAnimator.writingWindowId = null;
            }
            var anim = activeAnimations[wid];
            var animWin = anim ? anim.win : null;
            if (activeAnimations[wid]) {
                delete activeAnimations[wid];
                activeCount = Math.max(0, activeCount - 1);
                if (activeCount === 0) {
                    animTimer.stop();
                }
            }
            if (clearCommand) {
                var coord = getCoordinator();
                if (coord) {
                    coord.clearRecordedCommand(wid);
                }
                if (animWin) {
                    animWin._targetOutputName = null;
                    if (coord) {
                        var obsScr = animWin.output || (animWin.frameGeometry ? getScreenForPos(animWin.frameGeometry) : null);
                        if (obsScr) {
                            var obsName = getScreenName(obsScr);
                            var retained = coord.getRetainedWindow(wid);
                            if (retained && retained.outputId !== obsName) {
                                coord.ingestEvent({
                                    type: "WindowMovedOutput",
                                    windowId: wid,
                                    fromOutputId: retained.outputId,
                                    toOutputId: obsName
                                });
                            }
                        }
                    }
                }
            }
        }

        function cancelAllAnimations(clearCommand) {
            var keys = [];
            for (var wid in activeAnimations) {
                keys.push(wid);
            }
            for (var i = 0; i < keys.length; i++) {
                cancelAnimation(keys[i], clearCommand);
            }
        }

        function cancelInvalidAnimations() {
            var screens = Workspace.screens || [Workspace.activeScreen];
            var keys = [];
            for (var wid in activeAnimations) {
                var anim = activeAnimations[wid];
                if (!anim || !anim.win || !anim.win.managed || anim.win.deleted) {
                    keys.push(wid);
                    continue;
                }
                var winScr = anim.win.output || (anim.win.frameGeometry ? getScreenForPos(anim.win.frameGeometry) : null);
                var found = false;
                for (var s = 0; s < screens.length; s++) {
                    if (screens[s] === winScr) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    keys.push(wid);
                }
            }
            for (var i = 0; i < keys.length; i++) {
                cancelAnimation(keys[i], true);
            }
        }

        function easeOutCubic(t) {
            return 1 - Math.pow(1 - t, 3);
        }

        function animateWindow(win, targetRect, epoch, durationMs) {
            if (!win) return;
            var wid = getWindowId(win);
            if (!wid) return;

            var current = win.frameGeometry;
            if (!current) {
                cancelAnimation(wid, false);
                var writeSucceededNoAnim = false;
                try {
                    win.frameGeometry = Qt.rect(targetRect.x, targetRect.y, targetRect.width, targetRect.height);
                    writeSucceededNoAnim = true;
                } catch (e) {
                    writeSucceededNoAnim = false;
                }
                var coordNoAnim = getCoordinator();
                if (!writeSucceededNoAnim) {
                    if (coordNoAnim) coordNoAnim.clearRecordedCommand(wid);
                    return;
                }
                var actualNoAnim = win.frameGeometry;
                if (!actualNoAnim) {
                    if (coordNoAnim) coordNoAnim.clearRecordedCommand(wid);
                    return;
                }
                if (coordNoAnim && coordNoAnim.hasRecordedCommand && coordNoAnim.hasRecordedCommand(wid)) {
                    var echoNoAnim = coordNoAnim.checkAndHandleEcho(wid, {
                        x: actualNoAnim.x,
                        y: actualNoAnim.y,
                        width: actualNoAnim.width,
                        height: actualNoAnim.height
                    });
                    if (!echoNoAnim || !echoNoAnim.isEcho) {
                        coordNoAnim.clearRecordedCommand(wid);
                        coordNoAnim.ingestEvent({
                            type: "WindowGeometryChanged",
                            windowId: wid,
                            geometry: {
                                x: actualNoAnim.x,
                                y: actualNoAnim.y,
                                width: actualNoAnim.width,
                                height: actualNoAnim.height
                            }
                        });
                        scheduleReconcile("WindowGeometryClamped");
                    }
                }
                return;
            }

            if (current.x === targetRect.x && current.y === targetRect.y &&
                current.width === targetRect.width && current.height === targetRect.height) {
                cancelAnimation(wid, true);
                return;
            }

            var startX = current.x;
            var startY = current.y;
            var startW = current.width;
            var startH = current.height;
            var dur = (durationMs && durationMs > 0) ? durationMs : (config.animationDurationMs || 180);

            if (!activeAnimations[wid]) {
                activeCount++;
            }

            activeAnimations[wid] = {
                win: win,
                startX: startX,
                startY: startY,
                startW: startW,
                startH: startH,
                targetX: targetRect.x,
                targetY: targetRect.y,
                targetW: targetRect.width,
                targetH: targetRect.height,
                startTime: Date.now(),
                duration: dur,
                epoch: epoch || 0,
                expectedRect: null
            };

            if (!animTimer.running) {
                animTimer.start();
            }
        }

        function step() {
            var now = Date.now();
            var finishedKeys = [];
            var completedAnims = [];

            for (var wid in activeAnimations) {
                var anim = activeAnimations[wid];
                if (!anim || !anim.win) {
                    finishedKeys.push(wid);
                    continue;
                }

                var win = anim.win;

                // Safety checks: cancel WITHOUT writing target if window is invalid, fullscreen, being user-dragged/resized, minimized, maximized, or tiling disabled
                if (!win.managed || win.deleted || win.fullScreen || win.moveResized || win === currentDraggingWindow || win.minimized || (win.maximizeMode !== undefined && win.maximizeMode !== 0) || (root && !root.config.enableTiling)) {
                    finishedKeys.push(wid);
                    continue;
                }

                var elapsed = now - anim.startTime;
                var progress = anim.duration > 0 ? Math.min(1.0, elapsed / anim.duration) : 1.0;
                var eased = easeOutCubic(progress);

                if (progress >= 1.0) {
                    completedAnims.push({
                        wid: wid,
                        win: win,
                        targetX: anim.targetX,
                        targetY: anim.targetY,
                        targetW: anim.targetW,
                        targetH: anim.targetH
                    });
                } else {
                    var curX = Math.round(anim.startX + (anim.targetX - anim.startX) * eased);
                    var curY = Math.round(anim.startY + (anim.targetY - anim.startY) * eased);
                    var curW = Math.round(anim.startW + (anim.targetW - anim.startW) * eased);
                    var curH = Math.round(anim.startH + (anim.targetH - anim.startH) * eased);
                    try {
                        windowAnimator.writingWindowId = wid;
                        anim.expectedRect = { x: curX, y: curY, width: curW, height: curH };
                        win.frameGeometry = Qt.rect(curX, curY, curW, curH);
                    } catch (e) {
                        finishedKeys.push(wid);
                    } finally {
                        windowAnimator.writingWindowId = null;
                    }
                }
            }

            for (var i = 0; i < finishedKeys.length; i++) {
                cancelAnimation(finishedKeys[i], true);
            }

            for (var j = 0; j < completedAnims.length; j++) {
                var c = completedAnims[j];
                var win = c.win;
                cancelAnimation(c.wid, false);

                var coord = getCoordinator();
                var writeSucceeded = false;
                try {
                    windowAnimator.writingWindowId = c.wid;
                    win.frameGeometry = Qt.rect(c.targetX, c.targetY, c.targetW, c.targetH);
                    writeSucceeded = true;
                } catch (e) {
                    writeSucceeded = false;
                } finally {
                    windowAnimator.writingWindowId = null;
                }

                var actual = writeSucceeded ? win.frameGeometry : null;
                if (!writeSucceeded || !actual) {
                    if (coord) {
                        coord.clearRecordedCommand(c.wid);
                    }
                    win._targetOutputName = null;
                    if (coord) {
                        var obsScrFail = win.output || (win.frameGeometry ? getScreenForPos(win.frameGeometry) : null);
                        if (obsScrFail) {
                            var obsNameFail = getScreenName(obsScrFail);
                            var retFail = coord.getRetainedWindow(c.wid);
                            if (retFail && retFail.outputId !== obsNameFail) {
                                coord.ingestEvent({
                                    type: "WindowMovedOutput",
                                    windowId: c.wid,
                                    fromOutputId: retFail.outputId,
                                    toOutputId: obsNameFail
                                });
                            }
                        }
                    }
                    continue;
                }

                var observed = {
                    x: actual.x,
                    y: actual.y,
                    width: actual.width,
                    height: actual.height
                };

                if (coord) {
                    if (coord.hasRecordedCommand && coord.hasRecordedCommand(c.wid)) {
                        var echoCheck = coord.checkAndHandleEcho(c.wid, observed);
                        if (!echoCheck || !echoCheck.isEcho) {
                            coord.clearRecordedCommand(c.wid);
                            coord.ingestEvent({
                                type: "WindowGeometryChanged",
                                windowId: c.wid,
                                geometry: observed
                            });
                            scheduleReconcile("WindowGeometryClamped");
                        }
                    }
                }
            }
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

        var wid = getWindowId(win);
        var isCurrentlyAnimating = windowAnimator && windowAnimator.isAnimating(wid);

        if (evalResult.outcome === "unchanged-valid") {
            if (isCurrentlyAnimating) {
                // If a new target equals current observed geometry while an older transition is active,
                // cancel the older animation and clear the superseded command so the old timer
                // doesn't continue stepping toward the superseded target.
                windowAnimator.cancelAnimation(wid, true);
            }
            return { outcome: "unchanged-valid", normalized: evalResult.normalized };
        }

        var normalized = evalResult.normalized;
        try {
            coord.recordCommand(wid, normalized, epoch || 0);
            if (config.enableAnimations && windowAnimator && reason !== "drag_start") {
                windowAnimator.animateWindow(win, normalized, epoch || 0, config.animationDurationMs);
            } else {
                if (windowAnimator) windowAnimator.cancelAnimation(wid, false);
                win.frameGeometry = Qt.rect(normalized.x, normalized.y, normalized.width, normalized.height);
                var actualDirect = win.frameGeometry;
                if (coord.hasRecordedCommand && coord.hasRecordedCommand(wid)) {
                    if (!actualDirect) {
                        coord.clearRecordedCommand(wid);
                    } else {
                        var obsDirect = {
                            x: actualDirect.x,
                            y: actualDirect.y,
                            width: actualDirect.width,
                            height: actualDirect.height
                        };
                        var echoDirect = coord.checkAndHandleEcho(wid, obsDirect);
                        if (!echoDirect || !echoDirect.isEcho) {
                            coord.clearRecordedCommand(wid);
                            coord.ingestEvent({
                                type: "WindowGeometryChanged",
                                windowId: wid,
                                geometry: obsDirect
                            });
                            scheduleReconcile("WindowGeometryClamped");
                        }
                    }
                }
            }
            return { outcome: "applied", normalized: normalized };
        } catch (err) {
            coord.clearRecordedCommand(wid);
            if (windowAnimator) windowAnimator.cancelAnimation(wid, true);
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
            if (!winObj || !winObj.managed || !winObj.normalWindow || winObj.deleted) continue;
            var wid = getWindowId(winObj);
            var wScr = null;
            if (winObj._targetOutputName) {
                wScr = getScreenByName(winObj._targetOutputName);
                if (!wScr) {
                    winObj._targetOutputName = null;
                } else if (!windowAnimator || !windowAnimator.isAnimating(wid)) {
                    var obsScr = winObj.output || (winObj.frameGeometry ? getScreenForPos(winObj.frameGeometry) : null);
                    if (obsScr && obsScr !== wScr) {
                        var obsArea = Workspace.clientArea(KWin.MaximizeArea, obsScr, Workspace.currentDesktop);
                        var fg = winObj.frameGeometry;
                        if (fg && obsArea && (fg.x + fg.width <= obsArea.x + obsArea.width && fg.x >= obsArea.x)) {
                            winObj._targetOutputName = null;
                            wScr = obsScr;
                        }
                    }
                }
            }
            if (!wScr) {
                wScr = winObj.output || getScreenForPos(winObj.frameGeometry);
            }
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
                if (!targetWin || targetWin.deleted) continue;
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
    // 6. Visual Snap Overlay (PlasmaCore.Dialog)
    // =========================================================================
    PlasmaCore.Dialog {
        id: overlayDialog

        title: "Tessera Snap Overlay"
        location: PlasmaCore.Types.Desktop
        type: PlasmaCore.Dialog.OnScreenDisplay
        backgroundHints: PlasmaCore.Types.NoBackground
        flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint
        hideOnWindowDeactivate: false
        visible: true
        outputOnly: true
        opacity: 1

        property int originX: Workspace.virtualScreenGeometry ? Workspace.virtualScreenGeometry.x : 0
        property int originY: Workspace.virtualScreenGeometry ? Workspace.virtualScreenGeometry.y : 0
        property int virtualWidth: Workspace.virtualScreenGeometry ? Workspace.virtualScreenGeometry.width : (Workspace.virtualScreenSize ? Workspace.virtualScreenSize.width : 1920)
        property int virtualHeight: Workspace.virtualScreenGeometry ? Workspace.virtualScreenGeometry.height : (Workspace.virtualScreenSize ? Workspace.virtualScreenSize.height : 1080)

        x: originX
        y: originY

        property bool overlayActive: false

        property var snapZones: []
        property int hoveredZoneIndex: -1
        property var activeScreenGeom: Qt.rect(0, 0, 1920, 1080)

        function updateVirtualGeometry() {
            var vsGeom = Workspace.virtualScreenGeometry;
            if (vsGeom) {
                originX = vsGeom.x;
                originY = vsGeom.y;
                virtualWidth = vsGeom.width;
                virtualHeight = vsGeom.height;
            } else if (Workspace.virtualScreenSize) {
                originX = 0;
                originY = 0;
                virtualWidth = Workspace.virtualScreenSize.width;
                virtualHeight = Workspace.virtualScreenSize.height;
            }
            x = originX;
            y = originY;
        }

        function showOverlay(w) {
            computeZones(w);
            updateVirtualGeometry();
            hoveredZoneIndex = -1;
            overlayActive = true;
        }

        function hideOverlay() {
            overlayActive = false;
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

            // 3 Equal-width pillars: distribute remainder so max(width) - min(width) <= 1
            var totalColW = Math.max(0, uw - 2 * gi);
            var baseW = Math.floor(totalColW / 3);
            var rem = totalColW % 3;
            var colW0 = baseW + (rem === 2 ? 1 : 0);
            var colW1 = baseW + (rem === 1 ? 1 : 0);
            var colW2 = baseW + (rem === 2 ? 1 : 0);

            var cx0 = area.x + go;
            var cx1 = cx0 + colW0 + gi;
            var cx2 = cx1 + colW1 + gi;

            var zones = [];

            // 1. Top Maximize Bar Card (Index 0)
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

            // 2. Left Half (Primary Slot) (Index 1)
            zones.push({
                type: "half",
                id: "left-half",
                title: "Left Half (Primary)",
                badge: "⊞ Left Split",
                desc: "50% Primary Pane",
                slotIndex: 0,
                rect: { x: area.x + go, y: area.y + go + 70, width: hw, height: uh - 70 },
                targetRect: { x: area.x + go, y: area.y + go, width: hw, height: uh },
                triggerX: area.x + Math.floor(area.width * 0.16),
                triggerY: area.y + 80,
                triggerW: Math.floor(area.width * 0.18),
                triggerH: area.height - 80
            });

            // 3. Right Half (Stack Slot) (Index 2)
            zones.push({
                type: "half",
                id: "right-half",
                title: "Right Half (Stack)",
                badge: "▥ Right Split",
                desc: "50% Secondary Pane",
                slotIndex: 1,
                rect: { x: area.x + go + hw + gi, y: area.y + go + 70, width: uw - hw - gi, height: uh - 70 },
                targetRect: { x: area.x + go + hw + gi, y: area.y + go, width: uw - hw - gi, height: uh },
                triggerX: area.x + Math.floor(area.width * 0.66),
                triggerY: area.y + 80,
                triggerW: Math.floor(area.width * 0.18),
                triggerH: area.height - 80
            });

            // 4. Top-Left Quarter (Index 3)
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

            // 5. Bottom-Left Quarter (Index 4)
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

            // 6. Top-Right Quarter (Index 5)
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

            // 7. Bottom-Right Quarter (Index 6)
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

            // 8. Left Pillar (Index 7)
            zones.push({
                type: "pillar",
                id: "left-pillar",
                title: "Left Pillar",
                badge: "▎ Left Pillar",
                desc: "1/3 Left Column",
                slotIndex: 0,
                rect: { x: cx0, y: area.y + go + 70, width: colW0, height: uh - 70 },
                targetRect: { x: cx0, y: area.y + go, width: colW0, height: uh },
                triggerX: area.x,
                triggerY: area.y + Math.floor(area.height * 0.32),
                triggerW: Math.floor(area.width * 0.16),
                triggerH: Math.floor(area.height * 0.36)
            });

            // 9. Center Pillar (Index 8)
            zones.push({
                type: "pillar",
                id: "center-pillar",
                title: "Center Pillar",
                badge: "▍ Center Pillar",
                desc: "1/3 Center Column (Full)",
                slotIndex: 1,
                rect: { x: cx1, y: area.y + go + 70, width: colW1, height: uh - 70 },
                targetRect: { x: cx1, y: area.y + go, width: colW1, height: uh },
                triggerX: cx1,
                triggerY: area.y + Math.floor(area.height * 0.35),
                triggerW: colW1,
                triggerH: Math.floor(area.height * 0.30)
            });

            // 10. Center Top (Index 9)
            zones.push({
                type: "pillar",
                id: "center-top",
                title: "Center Top",
                badge: "⬒ Center Top",
                desc: "1/3 Center Column (Top)",
                slotIndex: 1,
                rect: { x: cx1, y: area.y + go + 70, width: colW1, height: Math.max(60, hh - 70) },
                targetRect: { x: cx1, y: area.y + go, width: colW1, height: hh },
                triggerX: cx1,
                triggerY: area.y + 66,
                triggerW: colW1,
                triggerH: Math.floor(area.height * 0.28)
            });

            // 11. Center Bottom (Index 10)
            zones.push({
                type: "pillar",
                id: "center-bottom",
                title: "Center Bottom",
                badge: "⬓ Center Bottom",
                desc: "1/3 Center Column (Bottom)",
                slotIndex: 2,
                rect: { x: cx1, y: area.y + go + hh + gi, width: colW1, height: uh - hh - gi },
                targetRect: { x: cx1, y: area.y + go + hh + gi, width: colW1, height: uh - hh - gi },
                triggerX: cx1,
                triggerY: area.y + Math.floor(area.height * 0.65),
                triggerW: colW1,
                triggerH: Math.floor(area.height * 0.35)
            });

            // 12. Right Pillar (Index 11)
            zones.push({
                type: "pillar",
                id: "right-pillar",
                title: "Right Pillar",
                badge: "▕ Right Pillar",
                desc: "1/3 Right Column",
                slotIndex: 2,
                rect: { x: cx2, y: area.y + go + 70, width: colW2, height: uh - 70 },
                targetRect: { x: cx2, y: area.y + go, width: colW2, height: uh },
                triggerX: area.x + Math.floor(area.width * 0.84),
                triggerY: area.y + Math.floor(area.height * 0.32),
                triggerW: Math.floor(area.width * 0.16),
                triggerH: Math.floor(area.height * 0.36)
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
                // 1. Check corner quarters first (higher priority in corners: indices 3, 4, 5, 6)
                for (var i = 3; i <= 6 && i < snapZones.length; i++) {
                    var qz = snapZones[i];
                    if (cursorPos.x >= qz.triggerX && cursorPos.x < qz.triggerX + qz.triggerW &&
                        cursorPos.y >= qz.triggerY && cursorPos.y < qz.triggerY + qz.triggerH) {
                        matchedIndex = i;
                        break;
                    }
                }

                // 2. Check top maximize bar (index 0)
                if (matchedIndex === -1 && snapZones.length > 0) {
                    var mz = snapZones[0];
                    if (cursorPos.x >= mz.triggerX && cursorPos.x < mz.triggerX + mz.triggerW &&
                        cursorPos.y >= mz.triggerY && cursorPos.y < mz.triggerY + mz.triggerH) {
                        matchedIndex = 0;
                    }
                }

                // 3. Check Center Top / Center Bottom / Center Pillar (indices 9, 10, 8)
                if (matchedIndex === -1 && snapZones.length >= 11) {
                    var ct = snapZones[9];
                    if (cursorPos.x >= ct.triggerX && cursorPos.x < ct.triggerX + ct.triggerW &&
                        cursorPos.y >= ct.triggerY && cursorPos.y < ct.triggerY + ct.triggerH) {
                        matchedIndex = 9;
                    } else {
                        var cb = snapZones[10];
                        if (cursorPos.x >= cb.triggerX && cursorPos.x < cb.triggerX + cb.triggerW &&
                            cursorPos.y >= cb.triggerY && cursorPos.y < cb.triggerY + cb.triggerH) {
                            matchedIndex = 10;
                        } else {
                            var cp = snapZones[8];
                            if (cursorPos.x >= cp.triggerX && cursorPos.x < cp.triggerX + cp.triggerW &&
                                cursorPos.y >= cp.triggerY && cursorPos.y < cp.triggerY + cp.triggerH) {
                                matchedIndex = 8;
                            }
                        }
                    }
                }

                // 4. Check Left/Right halves (indices 1, 2)
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

                // 5. Check Left Pillar (7) and Right Pillar (11)
                if (matchedIndex === -1) {
                    if (snapZones.length > 7) {
                        var lp = snapZones[7];
                        if (cursorPos.x >= lp.triggerX && cursorPos.x < lp.triggerX + lp.triggerW &&
                            cursorPos.y >= lp.triggerY && cursorPos.y < lp.triggerY + lp.triggerH) {
                            matchedIndex = 7;
                        }
                    }
                    if (snapZones.length > 11 && matchedIndex === -1) {
                        var rp = snapZones[11];
                        if (cursorPos.x >= rp.triggerX && cursorPos.x < rp.triggerX + rp.triggerW &&
                            cursorPos.y >= rp.triggerY && cursorPos.y < rp.triggerY + rp.triggerH) {
                            matchedIndex = 11;
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
        mainItem: Item {
            id: overlayContainer
            width: overlayDialog.virtualWidth
            height: overlayDialog.virtualHeight
            visible: true
            opacity: overlayDialog.overlayActive ? 1.0 : 0.0

            // Cursor tracking & snap refresh rate (16ms = smooth 60 FPS)
            Timer {
                id: overlayTimer
                interval: config.overlayPollingMs || 16
                running: overlayDialog.overlayActive
                repeat: true
                onTriggered: {
                    overlayDialog.updateHover(Workspace.cursorPos);
                }
            }

            // Subtle dark scrim so zone cards have punchy contrast
            Rectangle {
                anchors.fill: parent
                color: Qt.rgba(0, 0, 0, 0.20)
                visible: overlayDialog.overlayActive
            }

            // Top Maximize Card
            Repeater {
                model: (overlayDialog.overlayActive && overlayDialog.snapZones.length > 0) ? [overlayDialog.snapZones[0]] : []

                delegate: Rectangle {
                    visible: modelData !== null
                    x: modelData ? (modelData.rect.x - overlayDialog.originX) : 0
                    y: modelData ? (modelData.rect.y - overlayDialog.originY) : 0
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
                model: (overlayDialog.overlayActive && overlayDialog.snapZones.length >= 3) ? [overlayDialog.snapZones[1], overlayDialog.snapZones[2]] : []

                delegate: Rectangle {
                    property int zoneIdx: index + 1
                    property bool isHovered: overlayDialog.hoveredZoneIndex === zoneIdx

                    x: modelData ? (modelData.rect.x - overlayDialog.originX) : 0
                    y: modelData ? (modelData.rect.y - overlayDialog.originY) : 0
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
                model: (overlayDialog.overlayActive && overlayDialog.snapZones.length >= 7) ? [overlayDialog.snapZones[3], overlayDialog.snapZones[4], overlayDialog.snapZones[5], overlayDialog.snapZones[6]] : []

                delegate: Rectangle {
                    property int quarterIdx: index + 3
                    property bool isHovered: overlayDialog.hoveredZoneIndex === quarterIdx

                    visible: isHovered // Subtle, lights up with glowing border and fill when corner is hovered
                    x: modelData ? (modelData.rect.x - overlayDialog.originX) : 0
                    y: modelData ? (modelData.rect.y - overlayDialog.originY) : 0
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

            // 3-Pillar Zones (Left Pillar, Center Pillar, Center Top, Center Bottom, Right Pillar)
            Repeater {
                model: (overlayDialog.overlayActive && overlayDialog.snapZones.length >= 12) ? [
                    overlayDialog.snapZones[7],
                    overlayDialog.snapZones[8],
                    overlayDialog.snapZones[9],
                    overlayDialog.snapZones[10],
                    overlayDialog.snapZones[11]
                ] : []

                delegate: Rectangle {
                    property int pillarIdx: index === 0 ? 7 : (index === 1 ? 8 : (index === 2 ? 9 : (index === 3 ? 10 : 11)))
                    property bool isHovered: overlayDialog.hoveredZoneIndex === pillarIdx

                    visible: isHovered
                    x: modelData ? (modelData.rect.x - overlayDialog.originX) : 0
                    y: modelData ? (modelData.rect.y - overlayDialog.originY) : 0
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
                            text: isHovered ? "✓ Release to Snap Pillar" : (modelData ? modelData.desc : "")
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
        var wid = getWindowId(w);
        if (windowAnimator) {
            windowAnimator.cancelAnimation(wid, true);
        }
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
        delete w._targetOutputName;
    }

    function hookWindow(w) {
        if (!w || !w.managed || !w.normalWindow || w.deleted) return;
        if (w._tesseraHooks) {
            unhookWindow(w);
        }
        w._tesseraHooked = true;

        var hooks = {};

        var onMoveResizeStarted = function() {
            if (!root || !root.coordinator) return;
            var wid = getWindowId(w);
            if (windowAnimator) {
                windowAnimator.cancelAnimation(wid, true);
            }
            if (w.move && checkFilter(w)) {
                currentDraggingWindow = w;
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
            if (overlayDialog && overlayDialog.overlayActive && currentDraggingWindow === w) {
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
                                    snapRegion: target.id,
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
                if (windowAnimator) {
                    windowAnimator.cancelAnimation(wid, true);
                }
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
            if (!wid || !w.frameGeometry) return;
            if (windowAnimator && windowAnimator.isAnimating(wid)) {
                if (windowAnimator.writingWindowId === wid) {
                    return;
                }
                if (windowAnimator.isExpectedIntermediate && windowAnimator.isExpectedIntermediate(wid, w.frameGeometry)) {
                    return;
                }
                // External geometry change during active animation cancels animation and clears command
                windowAnimator.cancelAnimation(wid, true);
            }
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
                if (coord.ingestEvent) {
                    coord.ingestEvent({
                        type: "WindowGeometryChanged",
                        windowId: wid,
                        geometry: {
                            x: w.frameGeometry.x,
                            y: w.frameGeometry.y,
                            width: w.frameGeometry.width,
                            height: w.frameGeometry.height
                        }
                    });
                }
            }
            scheduleReconcile("WindowGeometryChanged");
        };

        var onFullScreenChanged = function() {
            if (!root || !root.coordinator || isArranging) return;
            var wid = getWindowId(w);
            if (windowAnimator && w.fullScreen) {
                windowAnimator.cancelAnimation(wid, true);
            }
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
            if (windowAnimator && w.maximizeMode !== 0) {
                windowAnimator.cancelAnimation(wid, true);
            }
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
            if (w._targetOutputName && getScreenName(w.output) === w._targetOutputName) {
                w._targetOutputName = null;
            }
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
            if (!w || !w.normalWindow || !w.managed || w.deleted) return;
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
            if (windowAnimator) {
                windowAnimator.cancelInvalidAnimations();
            }
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
        } else {
            if (windowAnimator) {
                windowAnimator.cancelAllAnimations(true);
            }
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

        if (nextFloating && windowAnimator) {
            windowAnimator.cancelAnimation(wid, true);
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

    function toggleOverlay() {
        if (overlayDialog.overlayActive) {
            overlayDialog.hideOverlay();
        } else {
            overlayDialog.showOverlay(Workspace.activeWindow);
        }
    }

    function snapActiveWindow(regionId) {
        var win = Workspace.activeWindow;
        if (!win || !win.normalWindow) return;
        var wid = getWindowId(win);
        var scr = win.output || getScreenForPos(win.frameGeometry) || Workspace.activeScreen;
        var area = Workspace.clientArea(KWin.MaximizeArea, scr, Workspace.currentDesktop);
        var zones = (typeof ReconcilerModule !== "undefined" && ReconcilerModule.computeSnapZones)
            ? ReconcilerModule.computeSnapZones(area, config.gapOuter, config.gapInner)
            : [];
        var targetZone = null;
        for (var i = 0; i < zones.length; i++) {
            if (zones[i].id === regionId) {
                targetZone = zones[i];
                break;
            }
        }
        if (!targetZone) return;

        var snapResult = commitWindowGeometry(win, targetZone.targetRect, "keyboard_snap");
        if (snapResult.outcome !== "rejected" && snapResult.normalized) {
            var coord = getCoordinator();
            if (coord) {
                coord.setManualFloating(wid, false);
                coord.setPreTiled(wid, true);
                coord.ingestEvent({
                    type: "WindowSnapCommitted",
                    windowId: wid,
                    outputId: getScreenName(scr),
                    targetRect: {
                        x: snapResult.normalized.x,
                        y: snapResult.normalized.y,
                        width: snapResult.normalized.width,
                        height: snapResult.normalized.height
                    },
                    slotIndex: targetZone.slotIndex,
                    snapRegion: targetZone.id,
                    desktopId: getCurrentDesktopKey()
                });
            }
            setSavedTiledGeometry(wid, snapResult.normalized);
            osdCall.notify("Snapped: " + targetZone.title, "preferences-system-windows");
            retileNow();
        }
    }

    function moveActiveWindowToRegion(direction) {
        var win = Workspace.activeWindow;
        if (!win || !win.normalWindow) return;
        var wid = getWindowId(win);
        var coord = getCoordinator();
        var retained = coord ? coord.getRetainedWindow(wid) : null;
        var currentRegion = (retained && retained.snapRegion) ? retained.snapRegion : "";

        var targetRegion = resolveRegionTransition(currentRegion, direction);
        snapActiveWindow(targetRegion);
    }

    function resizeActiveWindow(deltaW, deltaH) {
        var win = Workspace.activeWindow;
        if (!win || !win.normalWindow) return;
        var wid = getWindowId(win);
        var scr = win.output || getScreenForPos(win.frameGeometry) || Workspace.activeScreen;
        var area = Workspace.clientArea(KWin.MaximizeArea, scr, Workspace.currentDesktop);
        var cur = win.frameGeometry;
        if (!cur) return;

        var minW = Math.max(200, Math.floor(area.width * 0.15));
        var minH = Math.max(150, Math.floor(area.height * 0.15));
        var maxW = area.width - (config.gapOuter * 2);
        var maxH = area.height - (config.gapOuter * 2);

        var newW = Math.max(minW, Math.min(maxW, cur.width + deltaW));
        var newH = Math.max(minH, Math.min(maxH, cur.height + deltaH));
        var newX = cur.x;
        var newY = cur.y;

        if (newX + newW > area.x + area.width - config.gapOuter) {
            newX = area.x + area.width - config.gapOuter - newW;
        }
        if (newY + newH > area.y + area.height - config.gapOuter) {
            newY = area.y + area.height - config.gapOuter - newH;
        }
        newX = Math.max(area.x + config.gapOuter, newX);
        newY = Math.max(area.y + config.gapOuter, newY);

        var targetRect = { x: newX, y: newY, width: newW, height: newH };
        var res = commitWindowGeometry(win, targetRect, "keyboard_resize");
        if (res.outcome !== "rejected" && res.normalized) {
            var coord = getCoordinator();
            if (coord) {
                coord.setCustomTiledGeometry(wid, res.normalized);
            }
            setSavedTiledGeometry(wid, res.normalized);
        }
    }

    function findTargetScreenInDirection(currentScreen, direction) {
        var screens = Workspace.screens || [];
        if (screens.length <= 1) return null;

        var curArea = Workspace.clientArea(KWin.MaximizeArea, currentScreen, Workspace.currentDesktop);
        var curCx = curArea.x + curArea.width / 2;
        var curCy = curArea.y + curArea.height / 2;

        var bestScreen = null;
        var bestDistance = Infinity;

        for (var i = 0; i < screens.length; i++) {
            var s = screens[i];
            if (s === currentScreen) continue;
            var a = Workspace.clientArea(KWin.MaximizeArea, s, Workspace.currentDesktop);
            var cx = a.x + a.width / 2;
            var cy = a.y + a.height / 2;

            var matchesDir = false;
            var dist = 0;

            if (direction === "left" && cx < curCx) {
                matchesDir = true;
                dist = Math.abs(curCx - cx) + Math.abs(curCy - cy) * 2;
            } else if (direction === "right" && cx > curCx) {
                matchesDir = true;
                dist = Math.abs(cx - curCx) + Math.abs(curCy - cy) * 2;
            } else if (direction === "up" && cy < curCy) {
                matchesDir = true;
                dist = Math.abs(curCy - cy) + Math.abs(curCx - cx) * 2;
            } else if (direction === "down" && cy > curCy) {
                matchesDir = true;
                dist = Math.abs(cy - curCy) + Math.abs(curCx - cx) * 2;
            }

            if (matchesDir && dist < bestDistance) {
                bestDistance = dist;
                bestScreen = s;
            }
        }

        if (!bestScreen) {
            var curIdx = screens.indexOf(currentScreen);
            if (curIdx === -1) curIdx = 0;
            var nextIdx = (direction === "right" || direction === "down")
                ? ((curIdx + 1) % screens.length)
                : ((curIdx - 1 + screens.length) % screens.length);
            bestScreen = screens[nextIdx];
        }

        return bestScreen;
    }

    function moveWindowInDirection(direction) {
        var w = Workspace.activeWindow;
        if (!w || !w.normalWindow) return;

        var screens = Workspace.screens || [];
        if (screens.length <= 1) {
            osdCall.notify("Single Display Setup", "preferences-desktop-display");
            return;
        }

        var currentScreen = null;
        if (w._targetOutputName) {
            currentScreen = getScreenByName(w._targetOutputName);
            if (!currentScreen) {
                w._targetOutputName = null;
            }
        }
        if (!currentScreen) {
            currentScreen = getScreenForPos(w.frameGeometry) || Workspace.activeScreen;
        }

        var targetScreen = findTargetScreenInDirection(currentScreen, direction);
        if (!targetScreen || targetScreen === currentScreen) return;

        var wid = getWindowId(w);
        if (windowAnimator) {
            windowAnimator.cancelAnimation(wid, true);
        }

        var toName = getScreenName(targetScreen);
        var toArea = Workspace.clientArea(KWin.MaximizeArea, targetScreen, Workspace.currentDesktop);
        var minW = Math.max(200, Math.floor(toArea.width * 0.15));
        var minH = Math.max(150, Math.floor(toArea.height * 0.15));
        var curW = Math.max(minW, Math.min(toArea.width - (config.gapOuter * 2), w.frameGeometry.width));
        var curH = Math.max(minH, Math.min(toArea.height - (config.gapOuter * 2), w.frameGeometry.height));
        var newX = toArea.x + Math.floor((toArea.width - curW) / 2);
        var newY = toArea.y + Math.floor((toArea.height - curH) / 2);

        var fromName = getScreenName(currentScreen);
        var coord = getCoordinator();
        w._targetOutputName = toName;

        var moveResult = commitWindowGeometry(w, { x: newX, y: newY, width: curW, height: curH }, "move_screen");
        if (moveResult.outcome !== "rejected") {
            if (coord) {
                coord.ingestEvent({
                    type: "WindowMovedOutput",
                    windowId: wid,
                    fromOutputId: fromName,
                    toOutputId: toName
                });
            }
            osdCall.notify("Window Moved to " + toName, "preferences-desktop-display");
            retileNow();
        } else {
            w._targetOutputName = null;
            if (coord) {
                var retained = coord.getRetainedWindow(wid);
                if (retained && retained.outputId !== fromName) {
                    coord.ingestEvent({
                        type: "WindowMovedOutput",
                        windowId: wid,
                        fromOutputId: retained.outputId,
                        toOutputId: fromName
                    });
                }
            }
        }
    }

    function moveWindowToNextScreen(forward) {
        var screens = Workspace.screens || [];
        if (screens.length <= 1) {
            osdCall.notify("Single Display Setup", "preferences-desktop-display");
            return;
        }

        var w = Workspace.activeWindow;
        if (!w || !w.normalWindow) return;

        var currentScreen = null;
        if (w._targetOutputName) {
            currentScreen = getScreenByName(w._targetOutputName);
            if (!currentScreen) {
                w._targetOutputName = null;
            }
        }
        if (!currentScreen) {
            currentScreen = getScreenForPos(w.frameGeometry) || Workspace.activeScreen;
        }

        var curIdx = screens.indexOf(currentScreen);
        if (curIdx === -1) curIdx = 0;
        var nextIdx = forward
            ? ((curIdx + 1) % screens.length)
            : ((curIdx - 1 + screens.length) % screens.length);
        var targetScreen = screens[nextIdx];
        if (!targetScreen || targetScreen === currentScreen) return;

        var wid = getWindowId(w);
        if (windowAnimator) {
            windowAnimator.cancelAnimation(wid, true);
        }

        var toName = getScreenName(targetScreen);
        var toArea = Workspace.clientArea(KWin.MaximizeArea, targetScreen, Workspace.currentDesktop);
        var minW = Math.max(200, Math.floor(toArea.width * 0.15));
        var minH = Math.max(150, Math.floor(toArea.height * 0.15));
        var curW = Math.max(minW, Math.min(toArea.width - (config.gapOuter * 2), w.frameGeometry.width));
        var curH = Math.max(minH, Math.min(toArea.height - (config.gapOuter * 2), w.frameGeometry.height));
        var newX = toArea.x + Math.floor((toArea.width - curW) / 2);
        var newY = toArea.y + Math.floor((toArea.height - curH) / 2);

        var fromName = getScreenName(currentScreen);
        var coord = getCoordinator();
        w._targetOutputName = toName;

        var moveResult = commitWindowGeometry(w, { x: newX, y: newY, width: curW, height: curH }, "move_screen");
        if (moveResult.outcome !== "rejected") {
            if (coord) {
                coord.ingestEvent({
                    type: "WindowMovedOutput",
                    windowId: wid,
                    fromOutputId: fromName,
                    toOutputId: toName
                });
            }
            osdCall.notify("Window Moved to " + toName, "preferences-desktop-display");
            retileNow();
        } else {
            w._targetOutputName = null;
            if (coord) {
                var retained = coord.getRetainedWindow(wid);
                if (retained && retained.outputId !== fromName) {
                    coord.ingestEvent({
                        type: "WindowMovedOutput",
                        windowId: wid,
                        fromOutputId: retained.outputId,
                        toOutputId: fromName
                    });
                }
            }
        }
    }

    // =========================================================================
    // 10. Global Keyboard Shortcuts (Super-Primary Default Bindings)
    // =========================================================================

    ShortcutHandler {
        name: "Tessera: Toggle Zone Overlay"
        text: "Toggle Zone Overlay"
        sequence: "Meta+Shift+C"
        onActivated: root.toggleOverlay()
    }

    ShortcutHandler {
        name: "Tessera: Toggle Tiling"
        text: "Toggle Tiling Globally"
        sequence: "Meta+Shift+T"
        onActivated: root.toggleTiling()
    }

    ShortcutHandler {
        name: "Tessera: Toggle Window Floating"
        text: "Toggle Active Window Floating"
        sequence: "Meta+Shift+F"
        onActivated: root.toggleActiveFloating()
    }

    ShortcutHandler {
        name: "Tessera: Move Window to Left Region"
        text: "Move Window to Left Snap Region"
        sequence: "Meta+Left"
        onActivated: root.moveActiveWindowToRegion("left")
    }

    ShortcutHandler {
        name: "Tessera: Move Window to Right Region"
        text: "Move Window to Right Snap Region"
        sequence: "Meta+Right"
        onActivated: root.moveActiveWindowToRegion("right")
    }

    ShortcutHandler {
        name: "Tessera: Move Window to Up Region"
        text: "Move Window to Upper Snap Region"
        sequence: "Meta+Up"
        onActivated: root.moveActiveWindowToRegion("up")
    }

    ShortcutHandler {
        name: "Tessera: Move Window to Down Region"
        text: "Move Window to Lower Snap Region"
        sequence: "Meta+Down"
        onActivated: root.moveActiveWindowToRegion("down")
    }

    ShortcutHandler {
        name: "Tessera: Expand Window Width"
        text: "Expand Window Width"
        sequence: "Meta+Shift+Right"
        onActivated: root.resizeActiveWindow(60, 0)
    }

    ShortcutHandler {
        name: "Tessera: Shrink Window Width"
        text: "Shrink Window Width"
        sequence: "Meta+Shift+Left"
        onActivated: root.resizeActiveWindow(-60, 0)
    }

    ShortcutHandler {
        name: "Tessera: Expand Window Height"
        text: "Expand Window Height"
        sequence: "Meta+Shift+Down"
        onActivated: root.resizeActiveWindow(0, 60)
    }

    ShortcutHandler {
        name: "Tessera: Shrink Window Height"
        text: "Shrink Window Height"
        sequence: "Meta+Shift+Up"
        onActivated: root.resizeActiveWindow(0, -60)
    }

    ShortcutHandler {
        name: "Tessera: Move Window to Screen Left"
        text: "Move Window to Screen Left"
        sequence: "Meta+Ctrl+Left"
        onActivated: root.moveWindowInDirection("left")
    }

    ShortcutHandler {
        name: "Tessera: Move Window to Screen Right"
        text: "Move Window to Screen Right"
        sequence: "Meta+Ctrl+Right"
        onActivated: root.moveWindowInDirection("right")
    }

    ShortcutHandler {
        name: "Tessera: Move Window to Screen Above"
        text: "Move Window to Screen Above"
        sequence: "Meta+Ctrl+Up"
        onActivated: root.moveWindowInDirection("up")
    }

    ShortcutHandler {
        name: "Tessera: Move Window to Screen Below"
        text: "Move Window to Screen Below"
        sequence: "Meta+Ctrl+Down"
        onActivated: root.moveWindowInDirection("down")
    }

    ShortcutHandler {
        name: "Tessera: Focus Left Window"
        text: "Focus Left Window (WASD)"
        sequence: "Meta+Alt+A"
        onActivated: root.focusWindow(false)
    }

    ShortcutHandler {
        name: "Tessera: Focus Right Window"
        text: "Focus Right Window (WASD)"
        sequence: "Meta+Alt+D"
        onActivated: root.focusWindow(true)
    }

    ShortcutHandler {
        name: "Tessera: Focus Up Window"
        text: "Focus Up Window (WASD)"
        sequence: "Meta+Alt+W"
        onActivated: root.focusWindow(false)
    }

    ShortcutHandler {
        name: "Tessera: Focus Down Window"
        text: "Focus Down Window (WASD)"
        sequence: "Meta+Alt+S"
        onActivated: root.focusWindow(true)
    }

    ShortcutHandler {
        name: "Tessera: Swap Left Window"
        text: "Swap Window Left (Counter-Clockwise)"
        sequence: "Meta+Alt+Q"
        onActivated: root.swapWindow(false)
    }

    ShortcutHandler {
        name: "Tessera: Swap Right Window"
        text: "Swap Window Right (Clockwise)"
        sequence: "Meta+Alt+E"
        onActivated: root.swapWindow(true)
    }

    ShortcutHandler {
        name: "Tessera: Retile Current Workspace"
        text: "Force Retile Workspace"
        sequence: "Meta+Shift+R"
        onActivated: {
            root.loadConfig();
            root.retileNow();
        }
    }

    Component.onCompleted: {
        log("Tessera Declarative Extension loaded with Visual Snap Overlay");
        loadConfig();
        initRuntimeMode();
        retileNow();
    }

    Component.onDestruction: {
        log("Tessera unloading: cleaning up window hooks");
        if (reconcileTimer && reconcileTimer.running) {
            reconcileTimer.stop();
        }
        if (windowAnimator) {
            windowAnimator.cancelAllAnimations(false);
        }
        if (overlayDialog) {
            overlayDialog.hideOverlay();
        }
    }
}
