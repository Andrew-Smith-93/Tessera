import QtQuick
import QtQuick.Layouts
import org.kde.kwin
import org.kde.plasma.core as PlasmaCore

PlasmaCore.Dialog {
    id: zoneDialog

    title: "Tessera Snap Zones"
    location: PlasmaCore.Types.Desktop
    type: PlasmaCore.Dialog.OnScreenDisplay
    backgroundHints: PlasmaCore.Types.NoBackground
    flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
    hideOnWindowDeactivate: false
    visible: false

    property var zones: []
    property int highlightedIndex: -1
    property var currentScreen: null

    function updateZonesForScreen(screen, layoutName, gapInner, gapOuter) {
        currentScreen = screen;
        var area = Workspace.clientArea(KWin.MaximizeArea, screen, Workspace.currentDesktop);
        if (!area || area.width <= 0) return;

        zoneDialog.x = area.x;
        zoneDialog.y = area.y;
        zoneDialog.width = area.width;
        zoneDialog.height = area.height;

        var computed = [];
        var w = area.width;
        var h = area.height;

        // Provide 3 primary snapping zones based on screen dimensions:
        // Zone 1: Left 50% (or Master)
        // Zone 2: Right 50% (or Top-Right)
        // Zone 3: Bottom-Right 50% (or Full Maximize)
        var halfW = Math.floor(w / 2);
        var halfH = Math.floor(h / 2);

        // 1. Left Half
        computed.push({
            name: "Left Half (Master)",
            x: gapOuter,
            y: gapOuter,
            width: halfW - gapOuter - Math.floor(gapInner / 2),
            height: h - (gapOuter * 2),
            targetX: area.x + gapOuter,
            targetY: area.y + gapOuter,
            targetW: halfW - gapOuter - Math.floor(gapInner / 2),
            targetH: h - (gapOuter * 2)
        });

        // 2. Right Top Quarter
        computed.push({
            name: "Top Right",
            x: halfW + Math.ceil(gapInner / 2),
            y: gapOuter,
            width: halfW - gapOuter - Math.ceil(gapInner / 2),
            height: halfH - gapOuter - Math.floor(gapInner / 2),
            targetX: area.x + halfW + Math.ceil(gapInner / 2),
            targetY: area.y + gapOuter,
            targetW: halfW - gapOuter - Math.ceil(gapInner / 2),
            targetH: halfH - gapOuter - Math.floor(gapInner / 2)
        });

        // 3. Right Bottom Quarter
        computed.push({
            name: "Bottom Right",
            x: halfW + Math.ceil(gapInner / 2),
            y: halfH + Math.ceil(gapInner / 2),
            width: halfW - gapOuter - Math.ceil(gapInner / 2),
            height: halfH - gapOuter - Math.ceil(gapInner / 2),
            targetX: area.x + halfW + Math.ceil(gapInner / 2),
            targetY: area.y + halfH + Math.ceil(gapInner / 2),
            targetW: halfW - gapOuter - Math.ceil(gapInner / 2),
            targetH: halfH - gapOuter - Math.ceil(gapInner / 2)
        });

        // 4. Center Maximize Zone (top bar or full screen)
        computed.push({
            name: "Full Maximize",
            x: Math.floor(w * 0.25),
            y: 10,
            width: Math.floor(w * 0.5),
            height: 60,
            targetX: area.x + gapOuter,
            targetY: area.y + gapOuter,
            targetW: w - (gapOuter * 2),
            targetH: h - (gapOuter * 2)
        });

        zones = computed;
        highlightedIndex = -1;
    }

    function checkCursorHover(cursorPos) {
        if (!visible || zones.length === 0) return -1;

        var relX = cursorPos.x - zoneDialog.x;
        var relY = cursorPos.y - zoneDialog.y;

        for (var i = 0; i < zones.length; i++) {
            var z = zones[i];
            if (relX >= z.x && relX <= (z.x + z.width) &&
                relY >= z.y && relY <= (z.y + z.height)) {
                highlightedIndex = i;
                return i;
            }
        }
        highlightedIndex = -1;
        return -1;
    }

    Item {
        anchors.fill: parent

        Repeater {
            model: zoneDialog.zones

            Rectangle {
                property bool isHighlighted: index === zoneDialog.highlightedIndex

                x: modelData.x
                y: modelData.y
                width: modelData.width
                height: modelData.height
                radius: 10

                color: isHighlighted ? "#3daee955" : "#1e222b99"
                border.color: isHighlighted ? "#3daee9" : "#4a5a73"
                border.width: isHighlighted ? 3 : 1.5

                Behavior on color {
                    ColorAnimation { duration: 120 }
                }

                // Zone Label Badge
                Rectangle {
                    anchors.centerIn: parent
                    width: zoneText.implicitWidth + 24
                    height: 36
                    radius: 8
                    color: isHighlighted ? "#1b668fee" : "#1e222bee"
                    border.color: isHighlighted ? "#3daee9" : "#4a5a73"
                    border.width: 1

                    Text {
                        id: zoneText
                        anchors.centerIn: parent
                        text: modelData.name
                        color: isHighlighted ? "#ffffff" : "#a0a6ad"
                        font.pixelSize: 13
                        font.bold: true
                    }
                }
            }
        }
    }
}
