import QtQuick
import org.kde.kwin

Window {
    id: zoneOverlay

    title: "Tessera Snap Zones"
    flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool
    color: "transparent"
    visible: false

    x: Workspace.virtualScreenGeometry.x
    y: Workspace.virtualScreenGeometry.y
    width: Workspace.virtualScreenGeometry.width
    height: Workspace.virtualScreenGeometry.height

    signal layoutSelected(string layoutName)

    property var allZones: []
    property var layoutTabs: []
    property int highlightedIndex: -1
    property int highlightedTab: -1
    property var activeZone: (highlightedIndex >= 0 && highlightedIndex < allZones.length) ? allZones[highlightedIndex] : null
    property string currentLayout: "master-stack"

    property var availableLayouts: [
        { id: "master-stack", label: "⊞ Master-Stack" },
        { id: "bsp", label: "◫ BSP" },
        { id: "columns", label: "▥ Columns" },
        { id: "rows", label: "▤ Rows" },
        { id: "monocle", label: "▣ Monocle" },
        { id: "floating", label: "⧉ Floating" }
    ]

    function showOverlay(activeLayoutName, gapInner, gapOuter) {
        x = Workspace.virtualScreenGeometry.x;
        y = Workspace.virtualScreenGeometry.y;
        width = Workspace.virtualScreenGeometry.width;
        height = Workspace.virtualScreenGeometry.height;

        currentLayout = activeLayoutName || "master-stack";

        var screens = Workspace.screens || [Workspace.activeScreen];
        var list = [];
        var tabs = [];
        var gi = (gapInner !== undefined) ? gapInner : 8;
        var go = (gapOuter !== undefined) ? gapOuter : 10;

        for (var s = 0; s < screens.length; s++) {
            var scr = screens[s];
            if (!scr) continue;
            var area = Workspace.clientArea(KWin.MaximizeArea, scr, Workspace.currentDesktop);
            if (!area || area.width <= 0 || area.height <= 0) continue;

            var scrName = screens.length > 1 ? (scr.name || ("Screen " + (s + 1))) + " — " : "";
            var w = area.width;
            var h = area.height;
            var halfW = Math.floor(w / 2);
            var halfH = Math.floor(h / 2);

            // Top Layout Switcher Tabs across the top of this screen
            var tabWidth = Math.floor((Math.min(960, w - 40)) / (availableLayouts.length + 1));
            var totalBarWidth = tabWidth * (availableLayouts.length + 1);
            var startX = area.x + Math.floor((w - totalBarWidth) / 2);
            var topY = area.y + 10;

            for (var t = 0; t < availableLayouts.length; t++) {
                tabs.push({
                    screenIndex: s,
                    layoutId: availableLayouts[t].id,
                    name: availableLayouts[t].label,
                    x: startX + (t * tabWidth),
                    y: topY,
                    width: tabWidth - 6,
                    height: 44,
                    isMaximize: false
                });
            }

            // Maximize tab at end of layout bar
            tabs.push({
                screenIndex: s,
                layoutId: "maximize",
                name: "🗖 Maximize",
                x: startX + (availableLayouts.length * tabWidth),
                y: topY,
                width: tabWidth - 6,
                height: 44,
                isMaximize: true,
                targetX: area.x + go,
                targetY: area.y + go,
                targetW: w - (go * 2),
                targetH: h - (go * 2)
            });

            // Snap Zones (offset down by 60px to leave room for the top layout bar)
            var zoneTopY = area.y + 64;
            var zoneHeight = h - 64 - go;
            var halfZoneH = Math.floor(zoneHeight / 2);

            var leftW = halfW - go - Math.floor(gi / 2);
            var rightW = halfW - go - Math.ceil(gi / 2);
            var topH = halfZoneH - Math.floor(gi / 2);
            var botH = halfZoneH - Math.ceil(gi / 2);

            // 0: Left Half (Master)
            list.push({
                screenIndex: s,
                type: "left_half",
                name: scrName + "Left Half (Master)",
                targetX: area.x + go,
                targetY: area.y + go,
                targetW: leftW,
                targetH: h - (go * 2),
                guideX: area.x + go,
                guideY: zoneTopY,
                guideW: leftW,
                guideH: zoneHeight
            });

            // 1: Right Half
            list.push({
                screenIndex: s,
                type: "right_half",
                name: scrName + "Right Half",
                targetX: area.x + halfW + Math.ceil(gi / 2),
                targetY: area.y + go,
                targetW: rightW,
                targetH: h - (go * 2),
                guideX: area.x + halfW + Math.ceil(gi / 2),
                guideY: zoneTopY,
                guideW: rightW,
                guideH: zoneHeight
            });

            // 2: Top-Left Quarter
            list.push({
                screenIndex: s,
                type: "top_left",
                name: scrName + "Top-Left Quarter",
                targetX: area.x + go,
                targetY: area.y + go,
                targetW: leftW,
                targetH: halfH - go - Math.floor(gi / 2),
                guideX: area.x + go,
                guideY: zoneTopY,
                guideW: leftW,
                guideH: topH
            });

            // 3: Bottom-Left Quarter
            list.push({
                screenIndex: s,
                type: "bot_left",
                name: scrName + "Bottom-Left Quarter",
                targetX: area.x + go,
                targetY: area.y + halfH + Math.ceil(gi / 2),
                targetW: leftW,
                targetH: halfH - go - Math.ceil(gi / 2),
                guideX: area.x + go,
                guideY: zoneTopY + topH + gi,
                guideW: leftW,
                guideH: botH
            });

            // 4: Top-Right Quarter
            list.push({
                screenIndex: s,
                type: "top_right",
                name: scrName + "Top-Right Quarter",
                targetX: area.x + halfW + Math.ceil(gi / 2),
                targetY: area.y + go,
                targetW: rightW,
                targetH: halfH - go - Math.floor(gi / 2),
                guideX: area.x + halfW + Math.ceil(gi / 2),
                guideY: zoneTopY,
                guideW: rightW,
                guideH: topH
            });

            // 5: Bottom-Right Quarter
            list.push({
                screenIndex: s,
                type: "bot_right",
                name: scrName + "Bottom-Right Quarter",
                targetX: area.x + halfW + Math.ceil(gi / 2),
                targetY: area.y + halfH + Math.ceil(gi / 2),
                targetW: rightW,
                targetH: halfH - go - Math.ceil(gi / 2),
                guideX: area.x + halfW + Math.ceil(gi / 2),
                guideY: zoneTopY + topH + gi,
                guideW: rightW,
                guideH: botH
            });
        }

        allZones = list;
        layoutTabs = tabs;
        highlightedIndex = -1;
        highlightedTab = -1;
        visible = true;
    }

    function updateHover(pos) {
        if (!visible) return;

        // 1. Check if hovering any top layout switcher tab
        for (var t = 0; t < layoutTabs.length; t++) {
            var tab = layoutTabs[t];
            if (pos.x >= tab.x && pos.x <= (tab.x + tab.width) &&
                pos.y >= tab.y && pos.y <= (tab.y + tab.height)) {

                if (highlightedTab !== t) {
                    highlightedTab = t;
                    highlightedIndex = -1;
                    if (!tab.isMaximize) {
                        currentLayout = tab.layoutId;
                        layoutSelected(tab.layoutId);
                    }
                }
                return;
            }
        }
        highlightedTab = -1;

        // 2. Check snap zones
        var screens = Workspace.screens || [Workspace.activeScreen];
        for (var s = 0; s < screens.length; s++) {
            var scr = screens[s];
            if (!scr) continue;
            var area = Workspace.clientArea(KWin.MaximizeArea, scr, Workspace.currentDesktop);
            if (!area) continue;

            if (pos.x >= area.x && pos.x < (area.x + area.width) &&
                pos.y >= area.y && pos.y < (area.y + area.height)) {

                var relX = pos.x - area.x;
                var relY = pos.y - area.y;
                var normX = relX / area.width;
                var normY = relY / area.height;

                // Center area -> Free float
                if (normX >= 0.35 && normX <= 0.65 && normY >= 0.30 && normY <= 0.70) {
                    highlightedIndex = -1;
                    return;
                }

                var chosenType = "";
                if (normX < 0.50) {
                    if (normY < 0.35) {
                        chosenType = "top_left";
                    } else if (normY > 0.65) {
                        chosenType = "bot_left";
                    } else {
                        chosenType = "left_half";
                    }
                } else {
                    if (normY < 0.35) {
                        chosenType = "top_right";
                    } else if (normY > 0.65) {
                        chosenType = "bot_right";
                    } else {
                        chosenType = "right_half";
                    }
                }

                for (var i = 0; i < allZones.length; i++) {
                    if (allZones[i].screenIndex === s && allZones[i].type === chosenType) {
                        highlightedIndex = i;
                        return;
                    }
                }
            }
        }
        highlightedIndex = -1;
    }

    function finishDrag() {
        var res = null;
        if (highlightedTab >= 0 && highlightedTab < layoutTabs.length) {
            var tab = layoutTabs[highlightedTab];
            if (tab.isMaximize) {
                res = {
                    type: "maximize",
                    name: "Full Maximize",
                    targetX: tab.targetX,
                    targetY: tab.targetY,
                    targetW: tab.targetW,
                    targetH: tab.targetH
                };
            }
        } else if (activeZone) {
            res = activeZone;
        }

        visible = false;
        highlightedIndex = -1;
        highlightedTab = -1;
        return res;
    }

    // Ambient dark tint
    Rectangle {
        anchors.fill: parent
        color: "#28000000"
    }

    // Top Layout Switcher Bar
    Repeater {
        model: zoneOverlay.layoutTabs

        Rectangle {
            property bool isHovered: index === zoneOverlay.highlightedTab
            property bool isActiveLayout: modelData.layoutId === zoneOverlay.currentLayout

            x: modelData.x
            y: modelData.y
            width: modelData.width
            height: modelData.height
            radius: 12

            color: isHovered ? "#3daee9" : (isActiveLayout ? "#224a73cc" : "#1e222bcc")
            border.color: isHovered ? "#ffffff" : (isActiveLayout ? "#3daee9" : "#454a5a73")
            border.width: (isHovered || isActiveLayout) ? 2 : 1

            Behavior on color { ColorAnimation { duration: 80 } }

            Text {
                anchors.centerIn: parent
                text: modelData.name
                color: isHovered ? "#ffffff" : (isActiveLayout ? "#3daee9" : "#b0b8c4")
                font.bold: isHovered || isActiveLayout
                font.pixelSize: 13
            }
        }
    }

    // Static guide cards for visual clarity
    Repeater {
        model: zoneOverlay.allZones.filter(function(z) {
            return z.type === "left_half" || z.type === "right_half";
        })

        Rectangle {
            x: modelData.guideX
            y: modelData.guideY
            width: modelData.guideW
            height: modelData.guideH
            radius: 12
            color: "#151e222b"
            border.color: "#304a5a73"
            border.width: 1.5

            // Subtle divider line showing quarter splits
            Rectangle {
                anchors.centerIn: parent
                width: parent.width - 40
                height: 1
                color: "#184a5a73"
            }

            // Guide Label
            Rectangle {
                anchors.centerIn: parent
                width: guideLabel.implicitWidth + 24
                height: 32
                radius: 8
                color: "#1a222bee"
                border.color: "#304a5a73"
                border.width: 1

                Text {
                    id: guideLabel
                    anchors.centerIn: parent
                    text: modelData.name
                    color: "#80a0a6ad"
                    font.pixelSize: 13
                    font.bold: true
                }
            }
        }
    }

    // Dynamic glowing snap highlight rectangle
    Rectangle {
        id: highlightBox
        visible: zoneOverlay.activeZone !== null
        x: zoneOverlay.activeZone ? zoneOverlay.activeZone.guideX : 0
        y: zoneOverlay.activeZone ? zoneOverlay.activeZone.guideY : 0
        width: zoneOverlay.activeZone ? zoneOverlay.activeZone.guideW : 0
        height: zoneOverlay.activeZone ? zoneOverlay.activeZone.guideH : 0
        radius: 14

        color: "#483daee9"
        border.color: "#3daee9"
        border.width: 3

        Behavior on x { NumberAnimation { duration: 80; easing.type: Easing.OutQuad } }
        Behavior on y { NumberAnimation { duration: 80; easing.type: Easing.OutQuad } }
        Behavior on width { NumberAnimation { duration: 80; easing.type: Easing.OutQuad } }
        Behavior on height { NumberAnimation { duration: 80; easing.type: Easing.OutQuad } }

        // Floating badge in center
        Rectangle {
            anchors.centerIn: parent
            width: activeLabel.implicitWidth + 32
            height: 42
            radius: 12
            color: "#141a22ee"
            border.color: "#3daee9"
            border.width: 2

            Text {
                id: activeLabel
                anchors.centerIn: parent
                text: zoneOverlay.activeZone ? "✦ " + zoneOverlay.activeZone.name + " ✦" : ""
                color: "#ffffff"
                font.pixelSize: 15
                font.bold: true
            }
        }
    }
}
