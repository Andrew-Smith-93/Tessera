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
        floatFilter: "krunner,kcalc,systemsettings,pavucontrol,plasma-desktop,spectacle,kdialog,ksplashqml,org.kde.polkit-kde-authentication-agent-1,Steam,steam_app,steamwebhelper",
        customRulesJson: "[]",
        desktopLayoutsJson: "{}"
    })

    // State Tracking
    property var desktopLayouts: ({})
    property var floatingWindows: ({}) // window internalId -> boolean
    property var trackedWindows: []
    property var currentLayoutList: ["master-stack", "bsp", "columns", "rows", "monocle", "floating"]
    property bool isArranging: false

    function log(msg) {
        console.log("[Tessera] " + msg);
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

        debounceTimer.interval = Math.max(20, config.nvidiaDebounceMs);
        log("Config loaded. Tiling active: " + config.enableTiling + " defaultLayout: " + config.defaultLayout);
        triggerRetile();
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

    // Debounce timer for NVIDIA/X11 rendering stability
    Timer {
        id: debounceTimer
        interval: 60
        repeat: false
        onTriggered: {
            retileNow();
        }
    }

    function triggerRetile() {
        if (!config.enableTiling) return;
        debounceTimer.restart();
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
        osdCall.notify("Layout: " + layoutName.toUpperCase(), "preferences-desktop-virtual");
        triggerRetile();
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

    // Identify if a window belongs to current desktop and screen
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

            // Check desktop & screen affinity
            if (!isWindowOnCurrentDesktop(w)) continue;
            if (screen && w.output !== screen && w.screen !== screen) continue;

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

                    // Unmaximize if tiled
                    if (win.maximized) {
                        win.maximized = false;
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
            triggerRetile();
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
        triggerRetile();
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

        // Swap positions in window hierarchy/order
        var targetWin = windows[targetIdx];
        var currentGeom = Workspace.activeWindow.frameGeometry;
        Workspace.activeWindow.frameGeometry = targetWin.frameGeometry;
        targetWin.frameGeometry = currentGeom;

        triggerRetile();
    }

    function adjustMasterRatio(delta) {
        config.masterRatio = Math.max(0.2, Math.min(0.8, config.masterRatio + delta));
        osdCall.notify("Master Ratio: " + Math.round(config.masterRatio * 100) + "%", "preferences-desktop-virtual");
        triggerRetile();
    }

    function adjustMasterCount(delta) {
        config.masterCount = Math.max(1, config.masterCount + delta);
        osdCall.notify("Master Windows: " + config.masterCount, "preferences-desktop-virtual");
        triggerRetile();
    }

    // Connections to Workspace events
    Connections {
        target: Workspace

        function onWindowAdded(window) {
            if (!window) return;
            log("Window added: " + window.caption + " (" + window.resourceClass + ")");

            // Hook window state changes
            window.minimizedChanged.connect(function() {
                triggerRetile();
            });
            window.fullScreenChanged.connect(function() {
                triggerRetile();
            });

            if (config.tileNewWindows) {
                triggerRetile();
            }
        }

        function onWindowRemoved(window) {
            if (!window) return;
            var wid = window.internalId ? window.internalId.toString() : (window.caption + window.resourceClass);
            delete floatingWindows[wid];
            triggerRetile();
        }

        function onCurrentDesktopChanged() {
            log("Desktop switched to: " + Workspace.currentDesktop);
            triggerRetile();
        }

        function onScreensChanged() {
            log("Screens configuration changed");
            triggerRetile();
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
        sequence: "Meta+Space"
        onActivated: root.cycleLayout(true)
    }

    ShortcutHandler {
        name: "Tessera: Previous Layout"
        text: "Tessera: Previous Layout"
        sequence: "Meta+Shift+Space"
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
        sequence: "Meta+D"
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
