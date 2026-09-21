/**
 * Tessera Tiling Window Manager - Window Rule Engine
 * Intelligently classifies windows into tileable vs floating vs ignored.
 */

var RuleEngine = (function () {
    "use strict";

    // Only Tessera Control Center itself is floated by default to allow configuring settings
    var defaultFloatPatterns = [
        "tessera",
        "tessera-settings",
        "tessera_settings.py"
    ];

    /**
     * Check if a window should be ignored completely by the window manager
     */
    function isIgnored(window) {
        if (!window) return true;

        // Must be a managed window by KWin
        if (!window.managed) return true;

        // Must be a normal window (skip docks, desktop wallpaper, notifications)
        if (!window.normalWindow) return true;

        // Skip desktop wallpaper, docks/panels, splash screens, notifications
        if (window.desktopWindow || window.dock || window.splash || window.notification || window.onScreenDisplay) {
            return true;
        }

        // Skip popup menus and tooltips (transient context menus)
        if (window.popupMenu || window.tooltip || window.specialWindow) {
            return true;
        }

        return false;
    }

    /**
     * Determine if a window should float by default.
     * Everything tiles by default unless matched by Tessera Control Center, custom rules, or user filter.
     */
    function shouldFloat(window, userFilterString, customRulesJson) {
        if (isIgnored(window)) return true;

        // Fullscreen windows manage their own bounds
        if (window.fullScreen) return true;

        var resClass = (window.resourceClass || "").toString().toLowerCase();
        var resName = (window.resourceName || "").toString().toLowerCase();
        var caption = (window.caption || "").toString().toLowerCase();

        // Check default float list
        for (var i = 0; i < defaultFloatPatterns.length; i++) {
            var pat = defaultFloatPatterns[i].toLowerCase();
            if (resClass.indexOf(pat) !== -1 || resName.indexOf(pat) !== -1) {
                return true;
            }
        }

        // Check user filter string (comma-separated)
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

        // Check structured custom rules
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
            } catch (e) {
                // Ignore parse errors on custom rules
            }
        }

        return false;
    }

    return {
        isIgnored: isIgnored,
        shouldFloat: shouldFloat,
        defaultFloatPatterns: defaultFloatPatterns
    };
})();
