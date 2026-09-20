/**
 * Tessera Tiling Window Manager - Window Rule Engine
 * Intelligently classifies windows into tileable vs floating vs ignored.
 */

var RuleEngine = (function () {
    "use strict";

    // Standard floating window classes and patterns (dialogs, utilities, game popups)
    var defaultFloatPatterns = [
        "krunner",
        "kcalc",
        "systemsettings",
        "pavucontrol",
        "plasma-desktop",
        "plasmashell",
        "spectacle",
        "kdialog",
        "ksplashqml",
        "polkit-kde-authentication-agent-1",
        "org.kde.polkit-kde-authentication-agent-1",
        "pinentry",
        "1password",
        "bitwarden",
        "steam",
        "steamwebhelper",
        "steam_app",
        "lutris",
        "heroic",
        "gamescope",
        "file-roller",
        "ark",
        "gwenview"
    ];

    /**
     * Check if a window should be ignored completely by the window manager
     */
    function isIgnored(window) {
        if (!window) return true;

        // Skip non-normal windows (panels, desktop wallpaper, notifications, menus)
        if (window.desktopWindow || window.dock || window.splash || window.notification || window.onScreenDisplay) {
            return true;
        }

        // Must be normal window or dialog
        if (!window.normalWindow && !window.dialog) {
            return true;
        }

        // Skip utility popups and override-redirect style windows
        if (window.popupMenu || window.tooltip) {
            return true;
        }

        return false;
    }

    /**
     * Determine if a window should float by default
     */
    function shouldFloat(window, userFilterString, customRulesJson) {
        if (isIgnored(window)) return true;

        // Fullscreen windows manage their own bounds
        if (window.fullScreen) return true;

        // Dialogs or transient windows float by default
        if (window.dialog || window.transient) return true;

        // If window has fixed maximum size equal to minimum size (e.g. calculator, small utility)
        if (window.minSize && window.maxSize &&
            window.minSize.width > 0 &&
            window.minSize.width === window.maxSize.width &&
            window.minSize.height === window.maxSize.height) {
            return true;
        }

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
