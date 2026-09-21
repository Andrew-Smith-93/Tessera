import QtQuick
import org.kde.kwin

Window {
    id: hudWindow

    title: "Tessera Top HUD"
    flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool
    color: "transparent"
    visible: false

    width: 320
    height: 48

    property string messageText: "Layout: MASTER-STACK"

    function showMessage(text) {
        messageText = text;
        var scr = Workspace.activeScreen;
        if (scr && scr.geometry) {
            hudWindow.x = scr.geometry.x + Math.floor((scr.geometry.width - hudWindow.width) / 2);
            hudWindow.y = scr.geometry.y + 12;
        }
        visible = true;
        hideTimer.restart();
    }

    Rectangle {
        anchors.fill: parent
        radius: 24
        color: "#181e28f5"
        border.color: "#3daee9"
        border.width: 2

        Row {
            anchors.centerIn: parent
            spacing: 12

            Rectangle {
                width: 8
                height: 8
                radius: 4
                color: "#3daee9"
                anchors.verticalCenter: parent.verticalCenter
            }

            Text {
                text: hudWindow.messageText
                color: "#ffffff"
                font.bold: true
                font.pixelSize: 14
                anchors.verticalCenter: parent.verticalCenter
            }

            Rectangle {
                width: 8
                height: 8
                radius: 4
                color: "#3daee9"
                anchors.verticalCenter: parent.verticalCenter
            }
        }
    }

    Timer {
        id: hideTimer
        interval: 1800
        repeat: false
        onTriggered: hudWindow.visible = false
    }
}
