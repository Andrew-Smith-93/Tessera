import QtQuick
import QtQuick.Layouts
import org.kde.kwin
import org.kde.plasma.core as PlasmaCore

import "../code/layouts.js" as LayoutsModule
import "../code/rules.js" as RulesModule

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
        masterRatio: 0.55,
        masterCount: 1,
        perDesktopLayout: true,
        tileNewWindows: true,
        showOsd: true,
        nvidiaDebounceMs: 60,
        smoothResize: false,
        ignoreMinimized: true,
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
    property var currentLayoutList: ["master-stack", "bsp", "columns", "rows", "monocle", "floating"]
    property bool isArranging: false
    property var currentDraggingWindow: null

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
        config.masterRatio = KWin.readConfig("masterRatio", 0.55);
        config.masterCount = KWin.readConfig("masterCount", 1);
        config.perDesktopLayout = KWin.readConfig("perDesktopLayout", true);
        config.tileNewWindows = KWin.readConfig("tileNewWindows", true);
        config.showOsd = KWin.readConfig("showOsd", true);
        config.nvidiaDebounceMs = KWin.readConfig("nvidiaDebounceMs", 60);
        config.overlayPollingMs = KWin.readConfig("overlayPollingMs", 16);
        config.smoothResize = KWin.readConfig("smoothResize", false);
        config.ignoreMinimized = KWin.readConfig("ignoreMinimized", true);
        config.floatFilter = KWin.readConfig("floatFilter", "tessera,tessera-settings,tessera_settings.py");
        config.customRulesJson = KWin.readConfig("customRulesJson", "[]");
        config.desktopLayoutsJson = KWin.readConfig("desktopLayoutsJson", "{}");

        try {
            desktopLayouts = JSON.parse(config.desktopLayoutsJson || "{}");
        } catch (e) {
            desktopLayouts = {};
        }

        var allWins = Workspace.stackingOrder || [];
        for (var i = 0; i < allWins.length; i++) {
            hookWindow(allWins[i]);
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

    function getLayoutKey(screen) {
        var scr = screen || Workspace.activeScreen;
        var sName = getScreenName(scr);
        var deskKey = getCurrentDesktopKey();
        return sName + ":" + deskKey;
    }

    function getActiveLayout(screen) {
        var scr = screen || Workspace.activeScreen;
        var key = getLayoutKey(scr);
        return screenLayouts[key] || desktopLayouts[getCurrentDesktopKey()] || config.defaultLayout || "master-stack";
    }

    function setActiveLayout(layoutName, screen) {
        var scr = screen || Workspace.activeScreen;
        var key = getLayoutKey(scr);
        screenLayouts[key] = layoutName;
        desktopLayouts[getCurrentDesktopKey()] = layoutName;
        var sLabel = scr ? (scr.name || "Screen") : "Screen";
        osdCall.notify(sLabel + " Layout: " + layoutName.toUpperCase(), "preferences-desktop-virtual");
        retileNow();
    }

    function cycleLayout(forward) {
        var scr = Workspace.activeScreen;
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
        if (!w.managed) return false;

        // Skip non-normal system surfaces (wallpaper, docks/panels, notifications)
        if (w.desktopWindow || w.dock || w.splash || w.notification || w.onScreenDisplay) {
            return false;
        }
        if (w.popupMenu || w.tooltip || w.specialWindow) {
            return false;
        }

        // Only Tessera Control Center itself floats by default
        var rClass = w.resourceClass ? w.resourceClass.toString().toLowerCase() : "";
        var caption = w.caption ? w.caption.toString().toLowerCase() : "";
        if (rClass.indexOf("tessera") !== -1 || caption.indexOf("tessera control center") !== -1) {
            return false;
        }

        // Check custom rules if explicitly defined by user
        if (config.customRulesJson && config.customRulesJson !== "[]") {
            try {
                var rules = JSON.parse(config.customRulesJson);
                for (var r = 0; r < rules.length; r++) {
                    var rule = rules[r];
                    if (rule.matchType === "class" && rClass.indexOf(rule.pattern.toLowerCase()) !== -1) {
                        return rule.action !== "float";
                    }
                    if (rule.matchType === "title" && caption.indexOf(rule.pattern.toLowerCase()) !== -1) {
                        return rule.action !== "float";
                    }
                }
            } catch (e) {}
        }

        // Everything else tiles (System Settings, pavucontrol, kcalc, steam, dialogs, etc.)
        return true;
    }

    function getTileableWindows(screen) {
        var allWindows = Workspace.stackingOrder || [];
        var tileables = [];
        var sName = getScreenName(screen);

        for (var i = 0; i < allWindows.length; i++) {
            var w = allWindows[i];
            if (!w || !checkFilter(w)) continue;
            if (!isWindowOnCurrentDesktop(w)) continue;

            // Check screen affinity
            var wScreen = w.output || getScreenForPos(w.frameGeometry);
            if (sName && getScreenName(wScreen) !== sName) continue;

            if (config.ignoreMinimized && w.minimized) continue;

            var wid = getWindowId(w);
            if (floatingWindows[wid] === true) continue;

            tileables.push(w);
        }

        // Maintain consistent window order
        var existing = screenTiledWindows[sName] || [];
        var ordered = [];
        for (var e = 0; e < existing.length; e++) {
            if (tileables.indexOf(existing[e]) !== -1) {
                ordered.push(existing[e]);
            }
        }
        for (var t = 0; t < tileables.length; t++) {
            if (ordered.indexOf(tileables[t]) === -1) {
                ordered.push(tileables[t]);
            }
        }

        screenTiledWindows[sName] = ordered;
        return ordered;
    }

    // =========================================================================
    // 5. Layout Calculation & Geometry Application
    // =========================================================================
    function retileNow() {
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

                // Handle single pre-tiled or single regular window
                if (windows.length === 1) {
                    var singleWin = windows[0];
                    var swid = getWindowId(singleWin);
                    if (preTiledWindows[swid] === true) {
                        // Preserves user's manual half / quarter snap geometry
                        continue;
                    }
                }

                var sName = getScreenName(screen);
                var effectiveRatio = screenMasterRatios[sName] !== undefined ? screenMasterRatios[sName] : config.masterRatio;

                var options = {
                    gapInner: config.gapInner,
                    gapOuter: config.gapOuter,
                    masterRatio: effectiveRatio,
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

                for (var w = 0; w < windows.length && w < rects.length; w++) {
                    var win = windows[w];
                    var r = rects[w];

                    if (win === currentDraggingWindow) continue;

                    if (typeof win.setMaximize === "function") {
                        win.setMaximize(false, false);
                    }
                    win.frameGeometry = Qt.rect(r.x, r.y, r.width, r.height);
                }
            }
        } catch (err) {
            log("Retile error: " + err);
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
            var area = Workspace.clientArea(KWin.MaximizeArea, screen, Workspace.currentDesktop);
            activeScreenGeom = area;

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
                // Trigger bounds near top of screen
                triggerX: area.x + 40,
                triggerY: area.y,
                triggerW: area.width - 80,
                triggerH: 80
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
            var matchedIndex = -1;

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
    // 7. Window Event Hooks
    // =========================================================================
    function hookWindow(w) {
        if (!w || !w.managed || !w.normalWindow) return;
        if (w._tesseraHooked) return;
        w._tesseraHooked = true;

        if (w.interactiveMoveResizeStarted) {
            w.interactiveMoveResizeStarted.connect(function() {
                if (w.move && checkFilter(w)) {
                    currentDraggingWindow = w;
                    log("Drag started: " + w.caption);
                    overlayDialog.showOverlay(w);
                }
            });
        }

        if (w.interactiveMoveResizeStepped) {
            w.interactiveMoveResizeStepped.connect(function() {
                if (overlayDialog.visible && currentDraggingWindow === w) {
                    overlayDialog.updateHover(Workspace.cursorPos);
                } else if (w.resize && checkFilter(w)) {
                    // On-the-fly desktop master resizing!
                    var scr = w.output || getScreenForPos(w.frameGeometry);
                    var sName = getScreenName(scr);
                    var tiled = getTileableWindows(scr);
                    if (tiled.length > 1 && tiled[0] === w && getActiveLayout(scr) === "master-stack") {
                        var area = Workspace.clientArea(KWin.MaximizeArea, scr, Workspace.currentDesktop);
                        var usableW = area.width - (config.gapOuter * 2);
                        if (usableW > 0) {
                            var liveRatio = Math.max(0.20, Math.min(0.80, w.frameGeometry.width / usableW));
                            screenMasterRatios[sName] = Math.round(liveRatio * 100) / 100;
                            retileNow();
                        }
                    }
                }
            });
        }

        if (w.interactiveMoveResizeFinished) {
            w.interactiveMoveResizeFinished.connect(function() {
                if (w.resize && checkFilter(w)) {
                    var scr = w.output || getScreenForPos(w.frameGeometry);
                    var sName = getScreenName(scr);
                    var tiled = getTileableWindows(scr);
                    if (tiled.length > 1 && tiled[0] === w && getActiveLayout(scr) === "master-stack") {
                        var area = Workspace.clientArea(KWin.MaximizeArea, scr, Workspace.currentDesktop);
                        var usableW = area.width - (config.gapOuter * 2);
                        if (usableW > 0) {
                            var newRatio = Math.max(0.20, Math.min(0.80, w.frameGeometry.width / usableW));
                            newRatio = Math.round(newRatio * 100) / 100;
                            screenMasterRatios[sName] = newRatio;
                            config.masterRatio = newRatio;
                            log("Desktop on-the-fly master ratio updated to " + Math.round(newRatio * 100) + "% for screen " + sName);
                            retileNow();
                        }
                    }
                }
                if (currentDraggingWindow === w) {
                    log("Drag finished: " + w.caption);
                    var target = overlayDialog.finishDrag();
                    if (target) {
                        var wid = getWindowId(w);
                        if (target.type === "maximize") {
                            if (typeof w.setMaximize === "function") {
                                w.setMaximize(true, true);
                            }
                            delete preTiledWindows[wid];
                            floatingWindows[wid] = false;
                            osdCall.notify("Maximized", "preferences-system-windows");
                        } else {
                            if (typeof w.setMaximize === "function") {
                                w.setMaximize(false, false);
                            }
                            w.frameGeometry = Qt.rect(target.targetRect.x, target.targetRect.y, target.targetRect.width, target.targetRect.height);
                            preTiledWindows[wid] = true;
                            floatingWindows[wid] = false;

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

                            osdCall.notify("Snapped: " + target.title, "preferences-system-windows");
                        }
                    }
                    overlayDialog.hideOverlay();
                    currentDraggingWindow = null;
                    retileNow();
                }
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

        if (w.maximizedAboutToChange) {
            w.maximizedAboutToChange.connect(function(mode) {
                if (isArranging) return;
                var wid = getWindowId(w);
                if (mode === 0) {
                    floatingWindows[wid] = false;
                    delete preTiledWindows[wid];
                    retileNow();
                }
            });
        }
    }

    // =========================================================================
    // 8. Workspace Global Event Handling & Cooperative Unmaximize
    // =========================================================================
    Connections {
        target: Workspace

        // Automatic cooperative state transition for maximized windows
        function onWindowActivated(activeWin) {
            if (!activeWin || !activeWin.normalWindow || !config.enableTiling || isArranging) return;
            if (!isWindowOnCurrentDesktop(activeWin)) return;

            var s = activeWin.output || getScreenForPos(activeWin.frameGeometry);
            var tiled = getTileableWindows(s);

            if (tiled.length > 1) {
                var changed = false;
                for (var i = 0; i < tiled.length; i++) {
                    var tw = tiled[i];
                    if (tw.maximizeMode !== 0) {
                        if (typeof tw.setMaximize === "function") {
                            tw.setMaximize(false, false);
                        }
                        var wid = getWindowId(tw);
                        floatingWindows[wid] = false;
                        delete preTiledWindows[wid];
                        changed = true;
                        log("Unmaximized window to cooperate: " + tw.caption);
                    }
                }
                if (changed) {
                    retileNow();
                }
            }
        }

        function onWindowAdded(w) {
            if (!w || !w.normalWindow || !w.managed) return;
            hookWindow(w);

            if (config.tileNewWindows) {
                var s = w.output || getScreenForPos(w.frameGeometry);
                var tiled = getTileableWindows(s);
                if (tiled.length > 1) {
                    for (var i = 0; i < tiled.length; i++) {
                        if (tiled[i].maximizeMode !== 0) {
                            if (typeof tiled[i].setMaximize === "function") {
                                tiled[i].setMaximize(false, false);
                            }
                            var wid = getWindowId(tiled[i]);
                            floatingWindows[wid] = false;
                            delete preTiledWindows[wid];
                        }
                    }
                }
                retileNow();
            }
        }

        function onWindowRemoved(w) {
            if (!w) return;
            var wid = getWindowId(w);
            delete floatingWindows[wid];
            delete preTiledWindows[wid];
            retileNow();
        }

        function onCurrentDesktopChanged() {
            retileNow();
        }

        function onScreensChanged() {
            retileNow();
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

    function toggleOverlay() {
        if (overlayDialog.visible) {
            overlayDialog.hideOverlay();
        } else {
            overlayDialog.showOverlay(Workspace.activeWindow);
        }
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

    Component.onCompleted: {
        log("Tessera Declarative Extension loaded with KZones-Style Visual Snap Overlay");
        loadConfig();
        retileNow();
    }
}
