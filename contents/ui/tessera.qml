import QtQuick
import QtQuick.Layouts
import org.kde.kwin
import org.kde.plasma.core as PlasmaCore

import "../code/layouts.js" as LayoutsModule
import "../code/rules.js" as RulesModule

Item {
    id: root

    // Configuration Properties
    property var config: ({
        enableTiling: true,
        defaultLayout: "master-stack",
        gapInner: 8,
        gapOuter: 10,
        masterRatio: 0.55,
        masterCount: 1,
        perDesktopLayout: true,
        tileNewWindows: true,
        showOsd: true,
        nvidiaDebounceMs: 60,
        smoothResize: false,
        ignoreMinimized: true,
        floatFilter: "krunner,kcalc,systemsettings,pavucontrol,plasma-desktop,spectacle,kdialog,ksplashqml,org.kde.polkit-kde-authentication-agent-1,Steam,steam_app,steamwebhelper,tessera,tessera-settings,tessera_settings.py",
        customRulesJson: "[]",
        desktopLayoutsJson: "{}"
    })

    // State Tracking
    property var desktopLayouts: ({})
    property var floatingWindows: ({}) // window internalId -> boolean
    property var currentLayoutList: ["master-stack", "bsp", "columns", "rows", "monocle", "floating"]
    property bool isArranging: false
    property var currentDraggingWindow: null

    // References to overlay and HUD windows
    property var overlayItem: null
    property var hudItem: null

    // Visual Drag & Drop Snap Zones Overlay Loader
    Loader {
        id: zoneOverlayLoader
        source: Qt.resolvedUrl("ZoneOverlay.qml")
        onLoaded: {
            console.log("[Tessera] ZoneOverlay Loaded successfully!");
            root.overlayItem = item;
            if (item) {
                item.layoutSelected.connect(function(layoutName) {
                    root.setActiveLayout(layoutName);
                });
            }
        }
        onStatusChanged: {
            if (status === Loader.Error) {
                console.error("[Tessera] ZoneOverlay Loader Error: " + errorString());
            }
        }
    }

    // Top Notification HUD Loader
    Loader {
        id: topHudLoader
        source: Qt.resolvedUrl("TopNotification.qml")
        onLoaded: {
            console.log("[Tessera] TopNotification Loaded successfully!");
            root.hudItem = item;
        }
        onStatusChanged: {
            if (status === Loader.Error) {
                console.error("[Tessera] TopNotification Loader Error: " + errorString());
            }
        }
    }

    // Load configuration from KWin KConfig
    function loadConfig() {
        config.enableTiling = KWin.readConfig("enableTiling", true);
        config.defaultLayout = KWin.readConfig("defaultLayout", "master-stack");
        config.gapInner = KWin.readConfig("gapInner", 8);
        config.gapOuter = KWin.readConfig("gapOuter", 10);
        config.masterRatio = KWin.readConfig("masterRatio", 0.55);
        config.masterCount = KWin.readConfig("masterCount", 1);
        config.perDesktopLayout = KWin.readConfig("perDesktopLayout", true);
        config.tileNewWindows = KWin.readConfig("tileNewWindows", true);
        config.showOsd = KWin.readConfig("showOsd", true);
        config.nvidiaDebounceMs = KWin.readConfig("nvidiaDebounceMs", 60);
        config.smoothResize = KWin.readConfig("smoothResize", false);
        config.ignoreMinimized = KWin.readConfig("ignoreMinimized", true);
        config.floatFilter = KWin.readConfig("floatFilter", "krunner,kcalc,systemsettings,pavucontrol,plasma-desktop,spectacle,kdialog,ksplashqml,Steam,steam_app");
        config.customRulesJson = KWin.readConfig("customRulesJson", "[]");
        config.desktopLayoutsJson = KWin.readConfig("desktopLayoutsJson", "{}");

        try {
            desktopLayouts = JSON.parse(config.desktopLayoutsJson || "{}");
        } catch (e) {
            desktopLayouts = {};
        }

        // Hook all existing windows for drag & drop zones
        var allWins = Workspace.stackingOrder || [];
        for (var i = 0; i < allWins.length; i++) {
            hookWindow(allWins[i]);
        }

        log("Config loaded. Tiling active: " + config.enableTiling + " defaultLayout: " + config.defaultLayout);
        retileNow();
    }

    function log(msg) {
        console.log("[Tessera] " + msg);
    }

    // Hook window move/resize events for visual snap zones
    function hookWindow(w) {
        if (!w || !w.managed || !w.normalWindow) return;
        if (w._tesseraHooked) return;
        w._tesseraHooked = true;

        if (w.interactiveMoveResizeStarted) {
            w.interactiveMoveResizeStarted.connect(function() {
                currentDraggingWindow = w;
                console.log("[Tessera] Drag started for: " + w.caption + ", overlay=" + root.overlayItem);
                if (root.overlayItem) {
                    root.overlayItem.showOverlay(getActiveLayout(), config.gapInner, config.gapOuter);
                }
            });
        }
        if (w.interactiveMoveResizeStepped) {
            w.interactiveMoveResizeStepped.connect(function() {
                if (root.overlayItem && root.overlayItem.visible) {
                    root.overlayItem.updateHover(Workspace.cursorPos);
                }
            });
        }
        if (w.interactiveMoveResizeFinished) {
            w.interactiveMoveResizeFinished.connect(function() {
                console.log("[Tessera] Drag finished for: " + w.caption);
                var target = root.overlayItem ? root.overlayItem.finishDrag() : null;
                if (target && currentDraggingWindow) {
                    var wid = currentDraggingWindow.internalId ? currentDraggingWindow.internalId.toString() : (currentDraggingWindow.caption + currentDraggingWindow.resourceClass);
                    floatingWindows[wid] = true;

                    if (target.type === "maximize") {
                        if (typeof currentDraggingWindow.setMaximize === "function") {
                            currentDraggingWindow.setMaximize(true, true);
                        }
                    } else {
                        if (typeof currentDraggingWindow.setMaximize === "function") {
                            currentDraggingWindow.setMaximize(false, false);
                        }
                        currentDraggingWindow.frameGeometry = Qt.rect(target.targetX, target.targetY, target.targetW, target.targetH);
                    }
                    if (root.hudItem) {
                        root.hudItem.showMessage("Snapped: " + target.name);
                    }
                    osdCall.notify("Snapped: " + target.name, "preferences-desktop-virtual");
                }
                currentDraggingWindow = null;
            });
        }
        if (w.minimizedChanged) {
            w.minimizedChanged.connect(function() {
                retileNow();
            });
        }
        if (w.fullScreenChanged) {
            w.fullScreenChanged.connect(function() {
                retileNow();
            });
        }
    }

    // Native Plasma OSD notification
    DBusCall {
        id: osdCall
        service: "org.kde.plasmashell"
        path: "/org/kde/osdService"
        method: "showText"

        function notify(title, icon) {
            if (!config.showOsd) return;
            arguments = [icon || "preferences-desktop-virtual", "Tessera: " + title];
            call();
        }
    }

    // Returns the active layout name for the current desktop
    function getCurrentDesktopKey() {
        if (!config.perDesktopLayout) return "global";
        var desk = Workspace.currentDesktop;
        return desk ? (desk.id || desk.name || desk.toString()) : "default";
    }

    function getActiveLayout() {
        var key = getCurrentDesktopKey();
        return desktopLayouts[key] || config.defaultLayout || "master-stack";
    }

    function setActiveLayout(layoutName) {
        var key = getCurrentDesktopKey();
        desktopLayouts[key] = layoutName;
        if (root.hudItem) {
            root.hudItem.showMessage("LAYOUT: " + layoutName.toUpperCase());
        }
        osdCall.notify("Layout: " + layoutName.toUpperCase(), "preferences-desktop-virtual");
        retileNow();
    }

    function cycleLayout(forward) {
        var current = getActiveLayout();
        var idx = currentLayoutList.indexOf(current);
        if (idx === -1) idx = 0;

        if (forward) {
            idx = (idx + 1) % currentLayoutList.length;
        } else {
            idx = (idx - 1 + currentLayoutList.length) % currentLayoutList.length;
        }
        setActiveLayout(currentLayoutList[idx]);
    }

    // Identify if a window belongs to current desktop
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

    // Filter tileable windows for a screen
    function getTileableWindows(screen) {
        var allWindows = Workspace.stackingOrder || [];
        var tileables = [];

        for (var i = 0; i < allWindows.length; i++) {
            var w = allWindows[i];
            if (!w) continue;

            // Must be a managed normal window
            if (!w.managed || !w.normalWindow || w.specialWindow) continue;

            // Check desktop affinity
            if (!isWindowOnCurrentDesktop(w)) continue;

            // Check screen / monitor affinity
            var sName = screen ? (screen.name || "") : "";
            var wName = w.output ? (w.output.name || "") : "";
            if (sName && wName && sName !== wName) continue;

            // Ignore minimized if configured
            if (config.ignoreMinimized && w.minimized) continue;

            // Check rule engine ignore
            if (RulesModule.RuleEngine.isIgnored(w)) continue;

            // Check if user set window to float
            var wid = w.internalId ? w.internalId.toString() : (w.caption + w.resourceClass);
            if (floatingWindows[wid] === true) continue;

            // Check default rule engine float patterns
            if (RulesModule.RuleEngine.shouldFloat(w, config.floatFilter, config.customRulesJson)) continue;

            tileables.push(w);
        }

        return tileables;
    }

    // Core layout execution
    function retileNow() {
        if (!config.enableTiling) return;
        if (isArranging) return;
        isArranging = true;

        try {
            var screens = Workspace.screens || [Workspace.activeScreen];
            var layoutName = getActiveLayout();

            if (layoutName === "floating") {
                isArranging = false;
                return;
            }

            for (var s = 0; s < screens.length; s++) {
                var screen = screens[s];
                if (!screen) continue;

                var area = Workspace.clientArea(KWin.MaximizeArea, screen, Workspace.currentDesktop);
                if (!area || area.width <= 0 || area.height <= 0) continue;

                var windows = getTileableWindows(screen);
                if (windows.length === 0) continue;

                var options = {
                    gapInner: config.gapInner,
                    gapOuter: config.gapOuter,
                    masterRatio: config.masterRatio,
                    masterCount: config.masterCount
                };

                var rects = [];
                switch (layoutName) {
                    case "master-stack":
                        rects = LayoutsModule.Layouts.masterStack(area, windows.length, options);
                        break;
                    case "bsp":
                        rects = LayoutsModule.Layouts.binarySplit(area, windows.length, options);
                        break;
                    case "columns":
                        rects = LayoutsModule.Layouts.columns(area, windows.length, options);
                        break;
                    case "rows":
                        rects = LayoutsModule.Layouts.rows(area, windows.length, options);
                        break;
                    case "monocle":
                        rects = LayoutsModule.Layouts.monocle(area, windows.length, options);
                        break;
                    default:
                        rects = LayoutsModule.Layouts.masterStack(area, windows.length, options);
                        break;
                }

                // Apply geometries
                for (var w = 0; w < windows.length && w < rects.length; w++) {
                    var win = windows[w];
                    var r = rects[w];

                    if (typeof win.setMaximize === "function") {
                        win.setMaximize(false, false);
                    }

                    win.frameGeometry = Qt.rect(r.x, r.y, r.width, r.height);
                }
            }
        } catch (err) {
            console.error("[Tessera] Retile error: " + err);
        } finally {
            isArranging = false;
        }
    }

    // Toggle tiling globally
    function toggleTiling() {
        config.enableTiling = !config.enableTiling;
        osdCall.notify(config.enableTiling ? "Tiling Enabled" : "Tiling Disabled (Floating)", "preferences-desktop-virtual");
        if (config.enableTiling) {
            retileNow();
        }
    }

    // Toggle active window between floating and tiled
    function toggleActiveFloating() {
        var w = Workspace.activeWindow;
        if (!w) return;

        var wid = w.internalId ? w.internalId.toString() : (w.caption + w.resourceClass);
        var currentlyFloating = floatingWindows[wid] === true;
        floatingWindows[wid] = !currentlyFloating;

        osdCall.notify(floatingWindows[wid] ? "Window Floating" : "Window Tiled", "preferences-system-windows");
        retileNow();
    }

    // Window navigation & manipulation
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
        var windows = getTileableWindows(Workspace.activeScreen);
        if (windows.length <= 1) return;

        var currentIdx = windows.indexOf(Workspace.activeWindow);
        if (currentIdx === -1) return;

        var targetIdx = forward ? ((currentIdx + 1) % windows.length) : ((currentIdx - 1 + windows.length) % windows.length);

        var targetWin = windows[targetIdx];
        var currentGeom = Workspace.activeWindow.frameGeometry;
        Workspace.activeWindow.frameGeometry = targetWin.frameGeometry;
        targetWin.frameGeometry = currentGeom;

        retileNow();
    }

    function adjustMasterRatio(delta) {
        config.masterRatio = Math.max(0.2, Math.min(0.8, config.masterRatio + delta));
        osdCall.notify("Master Ratio: " + Math.round(config.masterRatio * 100) + "%", "preferences-desktop-virtual");
        retileNow();
    }

    function adjustMasterCount(delta) {
        config.masterCount = Math.max(1, config.masterCount + delta);
        osdCall.notify("Master Windows: " + config.masterCount, "preferences-desktop-virtual");
        retileNow();
    }

    // Connections to Workspace events
    Connections {
        target: Workspace

        function onWindowAdded(window) {
            if (!window || !window.normalWindow || !window.managed) return;
            log("Window added: " + window.caption + " (" + window.resourceClass + ")");

            hookWindow(window);

            if (config.tileNewWindows) {
                retileNow();
            }
        }

        function onWindowRemoved(window) {
            if (!window) return;
            var wid = window.internalId ? window.internalId.toString() : (window.caption + window.resourceClass);
            delete floatingWindows[wid];
            retileNow();
        }

        function onCurrentDesktopChanged() {
            log("Desktop switched to: " + Workspace.currentDesktop);
            retileNow();
        }

        function onScreensChanged() {
            log("Screens configuration changed");
            retileNow();
        }
    }

    // ==========================================
    // Native Plasma Global Keyboard Shortcuts
    // ==========================================

    ShortcutHandler {
        name: "Tessera: Toggle Tiling"
        text: "Tessera: Toggle Tiling"
        sequence: "Meta+Shift+T"
        onActivated: root.toggleTiling()
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
        name: "Tessera: Toggle Window Floating"
        text: "Tessera: Toggle Window Floating"
        sequence: "Meta+Shift+F"
        onActivated: root.toggleActiveFloating()
    }

    ShortcutHandler {
        name: "Tessera: Focus Next Window"
        text: "Tessera: Focus Next Window"
        sequence: "Meta+J"
        onActivated: root.focusWindow(true)
    }

    ShortcutHandler {
        name: "Tessera: Focus Previous Window"
        text: "Tessera: Focus Previous Window"
        sequence: "Meta+K"
        onActivated: root.focusWindow(false)
    }

    ShortcutHandler {
        name: "Tessera: Swap Window Forward"
        text: "Tessera: Swap Window Forward"
        sequence: "Meta+Shift+J"
        onActivated: root.swapWindow(true)
    }

    ShortcutHandler {
        name: "Tessera: Swap Window Backward"
        text: "Tessera: Swap Window Backward"
        sequence: "Meta+Shift+K"
        onActivated: root.swapWindow(false)
    }

    ShortcutHandler {
        name: "Tessera: Increase Master Ratio"
        text: "Tessera: Increase Master Ratio"
        sequence: "Meta+L"
        onActivated: root.adjustMasterRatio(0.05)
    }

    ShortcutHandler {
        name: "Tessera: Decrease Master Ratio"
        text: "Tessera: Decrease Master Ratio"
        sequence: "Meta+H"
        onActivated: root.adjustMasterRatio(-0.05)
    }

    ShortcutHandler {
        name: "Tessera: Increase Master Count"
        text: "Tessera: Increase Master Count"
        sequence: "Meta+I"
        onActivated: root.adjustMasterCount(1)
    }

    ShortcutHandler {
        name: "Tessera: Decrease Master Count"
        text: "Tessera: Decrease Master Count"
        sequence: "Meta+U"
        onActivated: root.adjustMasterCount(-1)
    }

    ShortcutHandler {
        name: "Tessera: Retile Current Workspace"
        text: "Tessera: Retile Current Workspace"
        sequence: "Meta+Shift+R"
        onActivated: root.retileNow()
    }

    Component.onCompleted: {
        log("Tessera KWin 6 Declarative Extension Initializing...");
        loadConfig();
    }
}
