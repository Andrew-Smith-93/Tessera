/**
 * Tessera Tiling Window Manager for KDE Plasma 6
 * Real Dynamic Tiling Window Manager with Pre-Tiling, Full Slot Snapping,
 * Live Multi-Window Preview, Compositor Outline, and Plasma Top OSD.
 */

(function () {
    "use strict";

    // =========================================================================
    // 1. Layout Engine
    // =========================================================================
    var Layouts = {
        applyGaps: function (rect, gapInner, gapOuter, isLeft, isRight, isTop, isBottom) {
            var x = rect.x + (isLeft ? gapOuter : Math.floor(gapInner / 2));
            var y = rect.y + (isTop ? gapOuter : Math.floor(gapInner / 2));
            var r = (rect.x + rect.width) - (isRight ? gapOuter : Math.ceil(gapInner / 2));
            var b = (rect.y + rect.height) - (isBottom ? gapOuter : Math.ceil(gapInner / 2));
            return {
                x: x,
                y: y,
                width: Math.max(100, r - x),
                height: Math.max(80, b - y)
            };
        },

        masterStack: function (area, count, options) {
            var results = [];
            if (count <= 0) return results;

            var gapInner = options.gapInner !== undefined ? options.gapInner : 8;
            var gapOuter = options.gapOuter !== undefined ? options.gapOuter : 10;
            var masterRatio = options.masterRatio !== undefined ? options.masterRatio : 0.55;
            var masterCount = Math.max(1, options.masterCount !== undefined ? options.masterCount : 1);

            if (count === 1) {
                results.push(this.applyGaps(area, gapInner, gapOuter, true, true, true, true));
                return results;
            }

            var actualMasters = Math.min(count, masterCount);
            var stackCount = count - actualMasters;

            var masterWidth = (stackCount > 0) ? Math.floor(area.width * masterRatio) : area.width;
            var stackWidth = area.width - masterWidth;

            var masterHeight = Math.floor(area.height / actualMasters);
            for (var m = 0; m < actualMasters; m++) {
                var my = area.y + (m * masterHeight);
                var mh = (m === actualMasters - 1) ? (area.height - (m * masterHeight)) : masterHeight;
                results.push(this.applyGaps(
                    { x: area.x, y: my, width: masterWidth, height: mh },
                    gapInner, gapOuter, true, stackCount === 0, m === 0, m === actualMasters - 1
                ));
            }

            if (stackCount > 0) {
                var stackHeight = Math.floor(area.height / stackCount);
                for (var s = 0; s < stackCount; s++) {
                    var sy = area.y + (s * stackHeight);
                    var sh = (s === stackCount - 1) ? (area.height - (s * stackHeight)) : stackHeight;
                    results.push(this.applyGaps(
                        { x: area.x + masterWidth, y: sy, width: stackWidth, height: sh },
                        gapInner, gapOuter, false, true, s === 0, s === stackCount - 1
                    ));
                }
            }
            return results;
        },

        binarySplit: function (area, count, options) {
            var results = [];
            if (count <= 0) return results;

            var gapInner = options.gapInner !== undefined ? options.gapInner : 8;
            var gapOuter = options.gapOuter !== undefined ? options.gapOuter : 10;

            if (count === 1) {
                results.push(this.applyGaps(area, gapInner, gapOuter, true, true, true, true));
                return results;
            }

            var currentArea = { x: area.x, y: area.y, width: area.width, height: area.height };
            var isHorizontal = true;

            for (var i = 0; i < count; i++) {
                if (i === count - 1) {
                    results.push(this.applyGaps(currentArea, gapInner, gapOuter, true, true, true, true));
                    break;
                }
                var nextArea = {};
                var windowArea = {};
                if (isHorizontal) {
                    var w = Math.floor(currentArea.width / 2);
                    windowArea = { x: currentArea.x, y: currentArea.y, width: w, height: currentArea.height };
                    nextArea = { x: currentArea.x + w, y: currentArea.y, width: currentArea.width - w, height: currentArea.height };
                } else {
                    var h = Math.floor(currentArea.height / 2);
                    windowArea = { x: currentArea.x, y: currentArea.y, width: currentArea.width, height: h };
                    nextArea = { x: currentArea.x, y: currentArea.y + h, width: currentArea.width, height: currentArea.height - h };
                }
                results.push(this.applyGaps(windowArea, gapInner, gapOuter, true, true, true, true));
                currentArea = nextArea;
                isHorizontal = !isHorizontal;
            }
            return results;
        },

        columns: function (area, count, options) {
            var results = [];
            if (count <= 0) return results;

            var gapInner = options.gapInner !== undefined ? options.gapInner : 8;
            var gapOuter = options.gapOuter !== undefined ? options.gapOuter : 10;
            var colWidth = Math.floor(area.width / count);

            for (var i = 0; i < count; i++) {
                var w = (i === count - 1) ? (area.width - (i * colWidth)) : colWidth;
                results.push(this.applyGaps(
                    { x: area.x + (i * colWidth), y: area.y, width: w, height: area.height },
                    gapInner, gapOuter, i === 0, i === count - 1, true, true
                ));
            }
            return results;
        },

        rows: function (area, count, options) {
            var results = [];
            if (count <= 0) return results;

            var gapInner = options.gapInner !== undefined ? options.gapInner : 8;
            var gapOuter = options.gapOuter !== undefined ? options.gapOuter : 10;
            var rowHeight = Math.floor(area.height / count);

            for (var i = 0; i < count; i++) {
                var h = (i === count - 1) ? (area.height - (i * rowHeight)) : rowHeight;
                results.push(this.applyGaps(
                    { x: area.x, y: area.y + (i * rowHeight), width: area.width, height: h },
                    gapInner, gapOuter, true, true, i === 0, i === count - 1
                ));
            }
            return results;
        },

        monocle: function (area, count, options) {
            var results = [];
            if (count <= 0) return results;

            var gapOuter = options.gapOuter !== undefined ? options.gapOuter : 10;
            var rect = this.applyGaps(area, 0, gapOuter, true, true, true, true);

            for (var i = 0; i < count; i++) {
                results.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
            }
            return results;
        },

        compute: function (layoutName, area, count, options) {
            switch (layoutName) {
                case "bsp":
                    return this.binarySplit(area, count, options);
                case "columns":
                    return this.columns(area, count, options);
                case "rows":
                    return this.rows(area, count, options);
                case "monocle":
                    return this.monocle(area, count, options);
                case "floating":
                    return [];
                case "master-stack":
                default:
                    return this.masterStack(area, count, options);
            }
        }
    };

    // =========================================================================
    // 2. Rule Engine
    // =========================================================================
    var RuleEngine = {
        defaultFloatPatterns: [
            "krunner", "kcalc", "systemsettings", "pavucontrol", "plasma-desktop",
            "plasmashell", "spectacle", "kdialog", "ksplashqml",
            "polkit-kde-authentication-agent-1", "org.kde.polkit-kde-authentication-agent-1",
            "pinentry", "1password", "bitwarden", "steam", "steamwebhelper",
            "steam_app", "lutris", "heroic", "gamescope", "tessera",
            "tessera-settings", "tessera_settings.py", "file-roller", "ark", "gwenview"
        ],

        isIgnored: function (w) {
            if (!w || !w.managed || !w.normalWindow) return true;
            if (w.desktopWindow || w.dock || w.splash || w.notification || w.onScreenDisplay) return true;
            if (w.popupMenu || w.tooltip || w.specialWindow) return true;
            return false;
        },

        shouldFloat: function (w, userFilterString, customRulesJson) {
            if (this.isIgnored(w)) return true;
            if (w.fullScreen || w.dialog || w.transient) return true;

            if (w.minSize && w.maxSize &&
                w.minSize.width > 0 &&
                w.minSize.width === w.maxSize.width &&
                w.minSize.height === w.maxSize.height) {
                return true;
            }

            var resClass = (w.resourceClass || "").toString().toLowerCase();
            var resName = (w.resourceName || "").toString().toLowerCase();
            var caption = (w.caption || "").toString().toLowerCase();

            for (var i = 0; i < this.defaultFloatPatterns.length; i++) {
                var pat = this.defaultFloatPatterns[i].toLowerCase();
                if (resClass.indexOf(pat) !== -1 || resName.indexOf(pat) !== -1) return true;
            }

            if (userFilterString) {
                var tokens = userFilterString.split(",");
                for (var j = 0; j < tokens.length; j++) {
                    var tok = tokens[j].trim().toLowerCase();
                    if (tok.length > 0) {
                        if (resClass.indexOf(tok) !== -1 || resName.indexOf(tok) !== -1 || caption.indexOf(tok) !== -1) {
                            return true;
                        }
                    }
                }
            }

            if (customRulesJson) {
                try {
                    var rules = typeof customRulesJson === "string" ? JSON.parse(customRulesJson) : customRulesJson;
                    if (Array.isArray(rules)) {
                        for (var r = 0; r < rules.length; r++) {
                            var rule = rules[r];
                            if (rule.matchType === "class" && resClass.indexOf(rule.pattern.toLowerCase()) !== -1) {
                                return rule.action === "float";
                            }
                            if (rule.matchType === "title" && caption.indexOf(rule.pattern.toLowerCase()) !== -1) {
                                return rule.action === "float";
                            }
                        }
                    }
                } catch (e) {}
            }

            return false;
        }
    };

    // =========================================================================
    // 3. State & Configuration
    // =========================================================================
    var config = {
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
        floatFilter: "krunner,kcalc,systemsettings,pavucontrol,plasma-desktop,spectacle,kdialog,ksplashqml,Steam,steam_app,tessera,tessera-settings,tessera_settings.py",
        customRulesJson: "[]",
        desktopLayoutsJson: "{}"
    };

    var desktopLayouts = {};
    var floatingWindows = {}; // internalId -> boolean (explicit user float)
    var preTiledWindows = {}; // internalId -> boolean (single-window pre-tile)
    var screenTiledWindows = {}; // screenName -> ordered array of tiled window objects
    var currentLayoutList = ["master-stack", "bsp", "columns", "rows", "monocle", "floating"];
    var isArranging = false;

    // Drag tracking state
    var currentDraggingWindow = null;
    var lastActiveZone = null;
    var lastOsdMessage = "";
    var lastTopLayoutIndex = -1;

    function log(msg) {
        console.log("[Tessera] " + msg);
    }

    function notify(message, icon) {
        log("OSD Notification: " + message);
        if (!config.showOsd) return;
        if (lastOsdMessage === message) return;
        lastOsdMessage = message;

        if (typeof callDBus === "function") {
            callDBus(
                "org.kde.plasmashell",
                "/org/kde/osdService",
                "org.kde.osdService",
                "showText",
                icon || "preferences-desktop-virtual",
                "Tessera: " + message
            );
        }
    }

    function loadConfig() {
        config.enableTiling = readConfig("enableTiling", true);
        config.defaultLayout = readConfig("defaultLayout", "master-stack");
        config.gapInner = readConfig("gapInner", 8);
        config.gapOuter = readConfig("gapOuter", 10);
        config.masterRatio = readConfig("masterRatio", 0.50);
        config.masterCount = readConfig("masterCount", 1);
        config.perDesktopLayout = readConfig("perDesktopLayout", true);
        config.tileNewWindows = readConfig("tileNewWindows", true);
        config.showOsd = readConfig("showOsd", true);
        config.nvidiaDebounceMs = readConfig("nvidiaDebounceMs", 60);
        config.smoothResize = readConfig("smoothResize", false);
        config.ignoreMinimized = readConfig("ignoreMinimized", true);
        config.floatFilter = readConfig("floatFilter", config.floatFilter);
        config.customRulesJson = readConfig("customRulesJson", "[]");
        config.desktopLayoutsJson = readConfig("desktopLayoutsJson", "{}");

        try {
            desktopLayouts = JSON.parse(config.desktopLayoutsJson || "{}");
        } catch (e) {
            desktopLayouts = {};
        }

        var allWins = workspace.stackingOrder || [];
        for (var i = 0; i < allWins.length; i++) {
            hookWindow(allWins[i]);
        }

        log("Initialized! enableTiling=" + config.enableTiling + " defaultLayout=" + config.defaultLayout);
        retileNow();
    }

    function getCurrentDesktopKey() {
        if (!config.perDesktopLayout) return "global";
        var desk = workspace.currentDesktop;
        return desk ? (desk.id || desk.name || desk.toString()) : "default";
    }

    function getActiveLayout() {
        var key = getCurrentDesktopKey();
        return desktopLayouts[key] || config.defaultLayout || "master-stack";
    }

    function setActiveLayout(layoutName) {
        var key = getCurrentDesktopKey();
        desktopLayouts[key] = layoutName;
        notify("Layout: " + layoutName.toUpperCase(), "preferences-desktop-virtual");
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

    function getWindowId(w) {
        if (!w) return "";
        return w.internalId ? w.internalId.toString() : (w.caption + "_" + w.resourceClass);
    }

    function getScreenName(screen) {
        return screen ? (screen.name || "default") : "default";
    }

    function isWindowOnCurrentDesktop(w) {
        if (!w) return false;
        if (w.onAllDesktops) return true;
        if (w.desktops && w.desktops.length > 0) {
            for (var i = 0; i < w.desktops.length; i++) {
                if (w.desktops[i] === workspace.currentDesktop) return true;
            }
            return false;
        }
        return true;
    }

    /**
     * Synchronizes and maintains the explicit ordered list of tiled windows for a screen.
     */
    function syncTileableWindows(screen) {
        var sName = getScreenName(screen);
        var existing = screenTiledWindows[sName] || [];
        var allWins = workspace.stackingOrder || [];

        // 1. Keep existing valid windows in their preserved order
        var valid = [];
        for (var i = 0; i < existing.length; i++) {
            var w = existing[i];
            if (!w || !w.managed || !w.normalWindow || RuleEngine.isIgnored(w)) continue;
            if (!isWindowOnCurrentDesktop(w)) continue;

            var wid = getWindowId(w);
            if (floatingWindows[wid] === true) continue;
            if (config.ignoreMinimized && w.minimized) continue;

            if (valid.indexOf(w) === -1) {
                valid.push(w);
            }
        }

        // 2. Discover any new tileable windows that belong on this screen
        for (var j = 0; j < allWins.length; j++) {
            var win = allWins[j];
            if (!win || !win.managed || !win.normalWindow || RuleEngine.isIgnored(win)) continue;
            if (!isWindowOnCurrentDesktop(win)) continue;

            var winScreen = win.output ? (win.output.name || "") : "";
            if (winScreen && sName && winScreen !== sName) continue;

            if (config.ignoreMinimized && win.minimized) continue;

            var wId = getWindowId(win);
            if (floatingWindows[wId] === true) continue;
            if (RuleEngine.shouldFloat(win, config.floatFilter, config.customRulesJson)) continue;

            if (valid.indexOf(win) === -1) {
                valid.push(win);
            }
        }

        // 3. When multiple tileable windows exist, unmaximize and cooperate!
        if (valid.length > 1) {
            for (var k = 0; k < valid.length; k++) {
                var vw = valid[k];
                var vwid = getWindowId(vw);
                delete preTiledWindows[vwid];
            }
        }

        screenTiledWindows[sName] = valid;
        return valid;
    }

    function getScreenForPos(pos) {
        var screens = workspace.screens || [workspace.activeScreen];
        for (var s = 0; s < screens.length; s++) {
            var scr = screens[s];
            if (!scr) continue;
            var area = workspace.clientArea(0, scr, workspace.currentDesktop);
            if (pos.x >= area.x && pos.x < (area.x + area.width) &&
                pos.y >= area.y && pos.y < (area.y + area.height)) {
                return scr;
            }
        }
        return workspace.activeScreen || screens[0];
    }

    // =========================================================================
    // 4. Real Tiling Slot Finder & Pre-Tiling Calculator
    // =========================================================================
    function findSlotForCursor(screen, pos, otherWindows, draggedWin) {
        if (!screen || !pos) return null;
        var area = workspace.clientArea(0, screen, workspace.currentDesktop);
        if (!area || area.width <= 0 || area.height <= 0) return null;

        var relX = pos.x - area.x;
        var relY = pos.y - area.y;
        var normX = relX / area.width;
        var normY = relY / area.height;

        var go = config.gapOuter;
        var gi = config.gapInner;
        var halfW = Math.floor(area.width / 2);
        var halfH = Math.floor(area.height / 2);

        // 1. Top Edge: Layout Switcher Zone (top 40px or top 5% of screen)
        if (relY < 40 || normY < 0.05) {
            var layouts = ["master-stack", "bsp", "columns", "rows", "monocle", "floating"];
            var segIdx = Math.min(layouts.length - 1, Math.max(0, Math.floor(normX * layouts.length)));
            var chosenLayout = layouts[segIdx];

            return {
                type: "top_edge",
                layoutIndex: segIdx,
                layoutName: chosenLayout,
                name: "Layout: " + chosenLayout.toUpperCase(),
                rect: {
                    x: area.x + go,
                    y: area.y + go,
                    width: area.width - (go * 2),
                    height: area.height - (go * 2)
                }
            };
        }

        var options = {
            gapInner: config.gapInner,
            gapOuter: config.gapOuter,
            masterRatio: config.masterRatio,
            masterCount: config.masterCount
        };

        var totalCount = otherWindows.length + 1;

        // 2. Multi-Window Tiling Mode:
        // Every tile slot is a clear, intuitive snap zone covering the screen.
        if (otherWindows.length > 0) {
            var layoutName = getActiveLayout();
            var rects = Layouts.compute(layoutName, area, totalCount, options);

            var bestSlot = 0;
            var minDist = 99999999;

            for (var i = 0; i < rects.length; i++) {
                var r = rects[i];
                // Direct hit test with generous gap tolerance
                if (pos.x >= (r.x - gi) && pos.x <= (r.x + r.width + gi) &&
                    pos.y >= (r.y - gi) && pos.y <= (r.y + r.height + gi)) {
                    bestSlot = i;
                    minDist = 0;
                    break;
                }
                // Fallback to nearest slot center
                var cx = r.x + (r.width / 2);
                var cy = r.y + (r.height / 2);
                var dist = Math.hypot(pos.x - cx, pos.y - cy);
                if (dist < minDist) {
                    minDist = dist;
                    bestSlot = i;
                }
            }

            var slotName = "Slot " + (bestSlot + 1);
            if (layoutName === "master-stack") {
                slotName = (bestSlot === 0) ? "Master (Left)" : ("Stack #" + bestSlot);
            } else if (layoutName === "bsp") {
                slotName = "BSP Branch #" + (bestSlot + 1);
            } else if (layoutName === "columns") {
                slotName = "Column #" + (bestSlot + 1);
            } else if (layoutName === "rows") {
                slotName = "Row #" + (bestSlot + 1);
            }

            return {
                type: "tile_slot",
                slotIndex: bestSlot,
                name: slotName,
                rect: rects[bestSlot],
                allRects: rects
            };
        }

        // 3. Single-Window Pre-Tiling Mode (No other windows present):
        // Wide, intuitive halves and quarters across the entire screen.
        if (normX < 0.45) {
            if (normY < 0.35) {
                return {
                    type: "top_left",
                    name: "Top-Left Quarter",
                    rect: {
                        x: area.x + go,
                        y: area.y + go,
                        width: halfW - go - Math.floor(gi / 2),
                        height: halfH - go - Math.floor(gi / 2)
                    }
                };
            }
            if (normY > 0.65) {
                return {
                    type: "bot_left",
                    name: "Bottom-Left Quarter",
                    rect: {
                        x: area.x + go,
                        y: area.y + halfH + Math.ceil(gi / 2),
                        width: halfW - go - Math.floor(gi / 2),
                        height: halfH - go - Math.ceil(gi / 2)
                    }
                };
            }
            return {
                type: "left_half",
                name: "Left Half (Master)",
                rect: {
                    x: area.x + go,
                    y: area.y + go,
                    width: halfW - go - Math.floor(gi / 2),
                    height: area.height - (go * 2)
                }
            };
        }

        if (normX > 0.55) {
            if (normY < 0.35) {
                return {
                    type: "top_right",
                    name: "Top-Right Quarter",
                    rect: {
                        x: area.x + halfW + Math.ceil(gi / 2),
                        y: area.y + go,
                        width: halfW - go - Math.ceil(gi / 2),
                        height: halfH - go - Math.floor(gi / 2)
                    }
                };
            }
            if (normY > 0.65) {
                return {
                    type: "bot_right",
                    name: "Bottom-Right Quarter",
                    rect: {
                        x: area.x + halfW + Math.ceil(gi / 2),
                        y: area.y + halfH + Math.ceil(gi / 2),
                        width: halfW - go - Math.ceil(gi / 2),
                        height: halfH - go - Math.ceil(gi / 2)
                    }
                };
            }
            return {
                type: "right_half",
                name: "Right Half (Stack)",
                rect: {
                    x: area.x + halfW + Math.ceil(gi / 2),
                    y: area.y + go,
                    width: halfW - go - Math.ceil(gi / 2),
                    height: area.height - (go * 2)
                }
            };
        }

        // Center area (free float)
        return null;
    }

    /**
     * Live Preview of all other windows while holding the mouse.
     * Guarantees 100% exact mathematical consistency with the final dropped positions.
     */
    function previewSnapping(screen, targetZone, draggedWin, otherWindows) {
        if (!screen || otherWindows.length === 0) return;

        var area = workspace.clientArea(0, screen, workspace.currentDesktop);
        if (!area) return;

        var options = {
            gapInner: config.gapInner,
            gapOuter: config.gapOuter,
            masterRatio: config.masterRatio,
            masterCount: config.masterCount
        };

        if (!targetZone) {
            // Revert other windows back to standard layout
            var standardRects = Layouts.compute(getActiveLayout(), area, otherWindows.length, options);
            for (var o = 0; o < otherWindows.length && o < standardRects.length; o++) {
                otherWindows[o].frameGeometry = standardRects[o];
            }
            return;
        }

        if (targetZone.type === "top_edge") {
            // Preview layout chosen at top edge
            var prospectiveRects = Layouts.compute(targetZone.layoutName, area, otherWindows.length, options);
            for (var p = 0; p < otherWindows.length && p < prospectiveRects.length; p++) {
                otherWindows[p].frameGeometry = prospectiveRects[p];
            }
            return;
        }

        if (targetZone.type === "tile_slot") {
            // Dragged window is shown by outline at targetZone.slotIndex.
            // The remaining windows smoothly shift into all remaining slots.
            var rects = targetZone.allRects;
            var otherIdx = 0;

            for (var i = 0; i < rects.length; i++) {
                if (i === targetZone.slotIndex) {
                    continue; // Reserved slot for dragged window
                }
                if (otherIdx < otherWindows.length) {
                    otherWindows[otherIdx].frameGeometry = rects[i];
                    otherIdx++;
                }
            }
        }
    }

    // =========================================================================
    // 5. Retile Execution
    // =========================================================================
    function retileNow() {
        if (!config.enableTiling) return;
        if (isArranging) return;
        isArranging = true;

        try {
            var screens = workspace.screens || [workspace.activeScreen];
            var layoutName = getActiveLayout();

            if (layoutName === "floating") {
                isArranging = false;
                return;
            }

            var options = {
                gapInner: config.gapInner,
                gapOuter: config.gapOuter,
                masterRatio: config.masterRatio,
                masterCount: config.masterCount
            };

            for (var s = 0; s < screens.length; s++) {
                var screen = screens[s];
                if (!screen) continue;

                var area = workspace.clientArea(0, screen, workspace.currentDesktop);
                if (!area || area.width <= 0 || area.height <= 0) continue;

                var windows = syncTileableWindows(screen);
                if (windows.length === 0) continue;

                var rects = Layouts.compute(layoutName, area, windows.length, options);

                for (var w = 0; w < windows.length && w < rects.length; w++) {
                    var win = windows[w];
                    if (typeof win.setMaximize === "function") {
                        win.setMaximize(false, false);
                    }
                    win.frameGeometry = rects[w];
                }
            }
        } catch (err) {
            log("Retile error: " + err);
        } finally {
            isArranging = false;
        }
    }

    // =========================================================================
    // 6. Window Event Hooking (Drag, Pre-Tiling, Snapping)
    // =========================================================================
    function hookWindow(w) {
        if (!w || !w.managed || !w.normalWindow) return;
        if (w._tesseraHooked) return;
        w._tesseraHooked = true;

        if (w.interactiveMoveResizeStarted) {
            w.interactiveMoveResizeStarted.connect(function () {
                log("Drag started: " + w.caption);
                currentDraggingWindow = w;
                lastActiveZone = null;
                lastTopLayoutIndex = -1;
                lastOsdMessage = "";
            });
        }

        if (w.interactiveMoveResizeStepped) {
            w.interactiveMoveResizeStepped.connect(function () {
                if (!currentDraggingWindow) return;

                var pos = workspace.cursorPos;
                var screen = getScreenForPos(pos);
                var allTiled = syncTileableWindows(screen);
                var otherWins = allTiled.filter(function (win) {
                    return win !== currentDraggingWindow;
                });

                var targetZone = findSlotForCursor(screen, pos, otherWins, currentDraggingWindow);

                if (targetZone) {
                    // Show compositor outline at the exact target slot rect
                    if (typeof workspace.showOutline === "function") {
                        workspace.showOutline(targetZone.rect);
                    }

                    if (targetZone.type === "top_edge") {
                        if (lastTopLayoutIndex !== targetZone.layoutIndex) {
                            lastTopLayoutIndex = targetZone.layoutIndex;
                            notify(targetZone.name, "preferences-desktop-virtual");
                        }
                    } else {
                        lastTopLayoutIndex = -1;
                        var zoneKey = targetZone.type + (targetZone.slotIndex !== undefined ? ("_" + targetZone.slotIndex) : "");
                        var lastKey = lastActiveZone ? (lastActiveZone.type + (lastActiveZone.slotIndex !== undefined ? ("_" + lastActiveZone.slotIndex) : "")) : "";
                        if (zoneKey !== lastKey) {
                            notify("Snap: " + targetZone.name, "preferences-system-windows");
                        }
                    }

                    lastActiveZone = targetZone;

                    // Live multi-window rearrangement preview
                    previewSnapping(screen, targetZone, currentDraggingWindow, otherWins);
                } else {
                    // Hovering free float area: hide outline & revert other windows
                    if (lastActiveZone) {
                        if (typeof workspace.hideOutline === "function") {
                            workspace.hideOutline();
                        }
                        previewSnapping(screen, null, currentDraggingWindow, otherWins);
                        lastActiveZone = null;
                        lastTopLayoutIndex = -1;
                        lastOsdMessage = "";
                    }
                }
            });
        }

        if (w.interactiveMoveResizeFinished) {
            w.interactiveMoveResizeFinished.connect(function () {
                log("Drag finished: " + w.caption);
                if (typeof workspace.hideOutline === "function") {
                    workspace.hideOutline();
                }

                if (currentDraggingWindow) {
                    var wid = getWindowId(currentDraggingWindow);
                    var pos = workspace.cursorPos;
                    var screen = getScreenForPos(pos);
                    var sName = getScreenName(screen);
                    var allTiled = syncTileableWindows(screen);
                    var otherWins = allTiled.filter(function (win) {
                        return win !== currentDraggingWindow;
                    });

                    var targetZone = lastActiveZone || findSlotForCursor(screen, pos, otherWins, currentDraggingWindow);

                    if (targetZone) {
                        log("Applying drop target: " + targetZone.name + " (" + targetZone.type + ")");

                        if (targetZone.type === "top_edge") {
                            // Top drop: Apply chosen layout and retile
                            setActiveLayout(targetZone.layoutName);
                            floatingWindows[wid] = false;
                            if (typeof currentDraggingWindow.setMaximize === "function") {
                                currentDraggingWindow.setMaximize(false, false);
                            }
                        } else if (targetZone.type === "tile_slot") {
                            // Multi-window slot drop:
                            // Commit the exact window ordering previewed live!
                            var newList = [];
                            var otherIdx = 0;
                            for (var k = 0; k < targetZone.allRects.length; k++) {
                                if (k === targetZone.slotIndex) {
                                    newList.push(currentDraggingWindow);
                                } else if (otherIdx < otherWins.length) {
                                    newList.push(otherWins[otherIdx]);
                                    otherIdx++;
                                }
                            }
                            screenTiledWindows[sName] = newList;
                            floatingWindows[wid] = false;

                            for (var m = 0; m < newList.length; m++) {
                                var wItem = newList[m];
                                if (typeof wItem.setMaximize === "function") {
                                    wItem.setMaximize(false, false);
                                }
                                wItem.frameGeometry = targetZone.allRects[m];
                            }
                            notify("Snapped: " + targetZone.name, "preferences-system-windows");
                        } else {
                            // Single-window pre-tiling drop (halves / quarters):
                            // Pin exact geometry so user can test tiling without other windows
                            if (typeof currentDraggingWindow.setMaximize === "function") {
                                currentDraggingWindow.setMaximize(false, false);
                            }
                            currentDraggingWindow.frameGeometry = targetZone.rect;
                            preTiledWindows[wid] = true;
                            delete floatingWindows[wid];
                            notify("Snapped: " + targetZone.name, "preferences-system-windows");
                        }
                    } else {
                        // Dropped in center / unmapped area: Keep floating
                        floatingWindows[wid] = true;
                        delete preTiledWindows[wid];
                    }
                }

                currentDraggingWindow = null;
                lastActiveZone = null;
                lastTopLayoutIndex = -1;
                lastOsdMessage = "";

                retileNow();
            });
        }

        if (w.maximizedChanged) {
            w.maximizedChanged.connect(function (mode) {
                if (isArranging) return;
                log("Window maximizedChanged: " + w.caption + " mode=" + mode);
                var wid = getWindowId(w);
                if (mode === 0) {
                    floatingWindows[wid] = false;
                    delete preTiledWindows[wid];
                    retileNow();
                } else {
                    var s = getScreenForPos(w.frameGeometry);
                    var tiled = syncTileableWindows(s);
                    if (tiled.length === 1) {
                        preTiledWindows[wid] = true;
                    }
                }
            });
        }

        if (w.minimizedChanged) {
            w.minimizedChanged.connect(function () {
                retileNow();
            });
        }

        if (w.fullScreenChanged) {
            w.fullScreenChanged.connect(function () {
                retileNow();
            });
        }
    }

    // =========================================================================
    // 7. Workspace Global Events
    // =========================================================================
    workspace.windowActivated.connect(function (activeWin) {
        if (!activeWin || !activeWin.normalWindow || !config.enableTiling || isArranging) return;
        if (!isWindowOnCurrentDesktop(activeWin)) return;

        var s = activeWin.output || getScreenForPos(activeWin.frameGeometry);
        var tiled = syncTileableWindows(s);

        if (tiled.length > 1) {
            var changed = false;
            for (var i = 0; i < tiled.length; i++) {
                var tw = tiled[i];
                if (tw !== activeWin && tw.maximizeMode !== 0) {
                    if (typeof tw.setMaximize === "function") {
                        tw.setMaximize(false, false);
                    }
                    var wid = getWindowId(tw);
                    floatingWindows[wid] = false;
                    changed = true;
                    log("Unmaximized window to cooperate with active window: " + tw.caption);
                }
            }
            if (changed) {
                retileNow();
            }
        }
    });

    workspace.windowAdded.connect(function (w) {
        if (!w || !w.normalWindow || !w.managed) return;
        hookWindow(w);
        if (config.tileNewWindows) {
            var s = w.output || getScreenForPos(w.frameGeometry);
            var tiled = syncTileableWindows(s);
            if (tiled.length > 1) {
                for (var i = 0; i < tiled.length; i++) {
                    if (tiled[i].maximizeMode !== 0) {
                        if (typeof tiled[i].setMaximize === "function") {
                            tiled[i].setMaximize(false, false);
                        }
                        var wid = getWindowId(tiled[i]);
                        floatingWindows[wid] = false;
                    }
                }
            }
            retileNow();
        }
    });

    workspace.windowRemoved.connect(function (w) {
        if (!w) return;
        var wid = getWindowId(w);
        delete floatingWindows[wid];

        var screens = workspace.screens || [workspace.activeScreen];
        for (var s = 0; s < screens.length; s++) {
            var sName = getScreenName(screens[s]);
            if (screenTiledWindows[sName]) {
                screenTiledWindows[sName] = screenTiledWindows[sName].filter(function (win) {
                    return win !== w;
                });
            }
        }

        retileNow();
    });

    workspace.currentDesktopChanged.connect(function () {
        retileNow();
    });

    workspace.screensChanged.connect(function () {
        retileNow();
    });

    // =========================================================================
    // 8. Window Manipulation & Tiling Controls
    // =========================================================================
    function toggleTiling() {
        config.enableTiling = !config.enableTiling;
        notify(config.enableTiling ? "Tiling Enabled" : "Tiling Disabled (Floating)", "preferences-desktop-virtual");
        if (config.enableTiling) {
            retileNow();
        }
    }

    function toggleActiveFloating() {
        var w = workspace.activeWindow;
        if (!w) return;
        var wid = getWindowId(w);
        var currentlyFloating = floatingWindows[wid] === true;
        floatingWindows[wid] = !currentlyFloating;
        notify(floatingWindows[wid] ? "Window Floating" : "Window Tiled", "preferences-system-windows");
        retileNow();
    }

    function focusWindow(forward) {
        var windows = syncTileableWindows(workspace.activeScreen);
        if (windows.length <= 1) return;
        var currentIdx = windows.indexOf(workspace.activeWindow);
        if (currentIdx === -1) {
            workspace.activeWindow = windows[0];
            return;
        }
        var nextIdx = forward ? ((currentIdx + 1) % windows.length) : ((currentIdx - 1 + windows.length) % windows.length);
        workspace.activeWindow = windows[nextIdx];
    }

    function swapWindow(forward) {
        var sName = getScreenName(workspace.activeScreen);
        var windows = syncTileableWindows(workspace.activeScreen);
        if (windows.length <= 1) return;
        var currentIdx = windows.indexOf(workspace.activeWindow);
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
        notify("Master Ratio: " + Math.round(config.masterRatio * 100) + "%", "preferences-desktop-virtual");
        retileNow();
    }

    function adjustMasterCount(delta) {
        config.masterCount = Math.max(1, config.masterCount + delta);
        notify("Master Windows: " + config.masterCount, "preferences-desktop-virtual");
        retileNow();
    }

    // =========================================================================
    // 9. Global Keyboard Shortcuts
    // =========================================================================
    registerShortcut("Tessera: Next Layout", "Tessera: Next Layout", "Ctrl+Space", function () {
        cycleLayout(true);
    });

    registerShortcut("Tessera: Previous Layout", "Tessera: Previous Layout", "Ctrl+Shift+Space", function () {
        cycleLayout(false);
    });

    registerShortcut("Tessera: Toggle Tiling", "Tessera: Toggle Tiling", "Meta+Shift+T", function () {
        toggleTiling();
    });

    registerShortcut("Tessera: Toggle Window Floating", "Tessera: Toggle Window Floating", "Meta+Shift+F", function () {
        toggleActiveFloating();
    });

    registerShortcut("Tessera: Focus Next Window", "Tessera: Focus Next Window", "Meta+J", function () {
        focusWindow(true);
    });

    registerShortcut("Tessera: Focus Previous Window", "Tessera: Focus Previous Window", "Meta+K", function () {
        focusWindow(false);
    });

    registerShortcut("Tessera: Swap Window Forward", "Tessera: Swap Window Forward", "Meta+Shift+J", function () {
        swapWindow(true);
    });

    registerShortcut("Tessera: Swap Window Backward", "Tessera: Swap Window Backward", "Meta+Shift+K", function () {
        swapWindow(false);
    });

    registerShortcut("Tessera: Increase Master Ratio", "Tessera: Increase Master Ratio", "Meta+L", function () {
        adjustMasterRatio(0.05);
    });

    registerShortcut("Tessera: Decrease Master Ratio", "Tessera: Decrease Master Ratio", "Meta+H", function () {
        adjustMasterRatio(-0.05);
    });

    registerShortcut("Tessera: Increase Master Count", "Tessera: Increase Master Count", "Meta+I", function () {
        adjustMasterCount(1);
    });

    registerShortcut("Tessera: Decrease Master Count", "Tessera: Decrease Master Count", "Meta+U", function () {
        adjustMasterCount(-1);
    });

    registerShortcut("Tessera: Retile Current Workspace", "Tessera: Retile Current Workspace", "Meta+Shift+R", function () {
        retileNow();
    });

    // Initialize
    loadConfig();
})();
