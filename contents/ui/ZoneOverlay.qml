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

    property var allZones: []
    property int highlightedIndex: -1
    property var activeZone: (highlightedIndex >= 0 && highlightedIndex < allZones.length) ? allZones[highlightedIndex] : null

    // Build zones for all connected monitors
    function showOverlay(gapInner, gapOuter) {
        x = Workspace.virtualScreenGeometry.x;
        y = Workspace.virtualScreenGeometry.y;
        width = Workspace.virtualScreenGeometry.width;
        height = Workspace.virtualScreenGeometry.height;

        var screens = Workspace.screens || [Workspace.activeScreen];
        var list = [];
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

            var leftW = halfW - go - Math.floor(gi / 2);
            var rightW = halfW - go - Math.ceil(gi / 2);
            var fullH = h - (go * 2);
            var topH = halfH - go - Math.floor(gi / 2);
            var botH = halfH - go - Math.ceil(gi / 2);

            // Left Half (Master)
            list.push({
                screenIndex: s,
                type: "left_half",
                name: scrName + "Left Half (Master)",
                targetX: area.x + go,
                targetY: area.y + go,
                targetW: leftW,
                targetH: fullH,
                area: area
            });

            // Right Half
            list.push({
                screenIndex: s,
                type: "right_half",
                name: scrName + "Right Half",
                targetX: area.x + halfW + Math.ceil(gi / 2),
                targetY: area.y + go,
                targetW: rightW,
                targetH: fullH,
                area: area
            });

            // Top-Left Quarter
            list.push({
                screenIndex: s,
                type: "top_left",
                name: scrName + "Top-Left Quarter",
                targetX: area.x + go,
                targetY: area.y + go,
                targetW: leftW,
                targetH: topH,
                area: area
            });

            // Bottom-Left Quarter
            list.push({
                screenIndex: s,
                type: "bot_left",
                name: scrName + "Bottom-Left Quarter",
                targetX: area.x + go,
                targetY: area.y + halfH + Math.ceil(gi / 2),
                targetW: leftW,
                targetH: botH,
                area: area
            });

            // Top-Right Quarter
            list.push({
                screenIndex: s,
                type: "top_right",
                name: scrName + "Top-Right Quarter",
                targetX: area.x + halfW + Math.ceil(gi / 2),
                targetY: area.y + go,
                targetW: rightW,
                targetH: topH,
                area: area
            });

            // Bottom-Right Quarter
            list.push({
                screenIndex: s,
                type: "bot_right",
                name: scrName + "Bottom-Right Quarter",
                targetX: area.x + halfW + Math.ceil(gi / 2),
                targetY: area.y + halfH + Math.ceil(gi / 2),
                targetW: rightW,
                targetH: botH,
                area: area
            });

            // Full Maximize
            list.push({
                screenIndex: s,
                type: "maximize",
                name: scrName + "Full Maximize",
                targetX: area.x + go,
                targetY: area.y + go,
                targetW: w - (go * 2),
                targetH: fullH,
                area: area
            });
        }

        allZones = list;
        highlightedIndex = -1;
        visible = true;
    }

    // Update zone highlight based on current cursor position
    function updateHover(pos) {
        if (!visible || allZones.length === 0) return;

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

                var chosenType = "";
                // Top edge or within 60px -> Maximize
                if (relY < 65 || normY < 0.08) {
                    chosenType = "maximize";
                }
                // Center zone -> Free floating (no snap)
                else if (normX >= 0.35 && normX <= 0.65 && normY >= 0.30 && normY <= 0.70) {
                    highlightedIndex = -1;
                    return;
                }
                // Left half
                else if (normX < 0.50) {
                    if (normY < 0.30) {
                        chosenType = "top_left";
                    } else if (normY > 0.70) {
                        chosenType = "bot_left";
                    } else {
                        chosenType = "left_half";
                    }
                }
                // Right half
                else {
                    if (normY < 0.30) {
                        chosenType = "top_right";
                    } else if (normY > 0.70) {
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

    // Finish dragging: return snapped zone if any, and hide
    function finishDrag() {
        var target = activeZone;
        visible = false;
        highlightedIndex = -1;
        return target;
    }

    // Ambient dark tint
    Rectangle {
        anchors.fill: parent
        color: "#28000000"
    }

    // Static guide cards for visual clarity across screens
    Repeater {
        model: zoneOverlay.allZones.filter(function(z) {
            return z.type === "left_half" || z.type === "right_half";
        })

        Rectangle {
            x: modelData.targetX
            y: modelData.targetY
            width: modelData.targetW
            height: modelData.targetH
            radius: 12
            color: "#181e222b"
            border.color: "#354a5a73"
            border.width: 1.5

            // Subtle divider line showing quarter splits
            Rectangle {
                anchors.centerIn: parent
                width: parent.width - 40
                height: 1
                color: "#204a5a73"
            }

            // Guide Label
            Rectangle {
                anchors.centerIn: parent
                width: guideLabel.implicitWidth + 20
                height: 30
                radius: 8
                color: "#1e222bee"
                border.color: "#354a5a73"
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

    // Maximize Drop Header Bar across screens
    Repeater {
        model: zoneOverlay.allZones.filter(function(z) {
            return z.type === "maximize";
        })

        Rectangle {
            x: modelData.area.x + Math.floor(modelData.area.width * 0.25)
            y: modelData.area.y + 10
            width: Math.floor(modelData.area.width * 0.5)
            height: 44
            radius: 10
            color: "#1e222bee"
            border.color: "#3daee966"
            border.width: 1.5

            Row {
                anchors.centerIn: parent
                spacing: 8
                Text {
                    text: "⬆  Drop here to Maximize  ⬆"
                    color: "#a0c8e8"
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
        x: zoneOverlay.activeZone ? zoneOverlay.activeZone.targetX : 0
        y: zoneOverlay.activeZone ? zoneOverlay.activeZone.targetY : 0
        width: zoneOverlay.activeZone ? zoneOverlay.activeZone.targetW : 0
        height: zoneOverlay.activeZone ? zoneOverlay.activeZone.targetH : 0
        radius: 14

        color: "#483daee9"
        border.color: "#3daee9"
        border.width: 3

        Behavior on x { NumberAnimation { duration: 90; easing.type: Easing.OutQuad } }
        Behavior on y { NumberAnimation { duration: 90; easing.type: Easing.OutQuad } }
        Behavior on width { NumberAnimation { duration: 90; easing.type: Easing.OutQuad } }
        Behavior on height { NumberAnimation { duration: 90; easing.type: Easing.OutQuad } }

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
