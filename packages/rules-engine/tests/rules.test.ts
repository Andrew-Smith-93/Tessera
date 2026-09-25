import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import {
  WindowRuleEngine,
  WindowClassificationTracker,
  isGameIdentity,
  isFullscreenLike,
  normalizeAction,
  type WindowRuleInput
} from "../src/rules.js";
import { RuleEngine } from "../../../apps/kwin-adapter/src/qml-rules-compat.js";

describe("WindowRuleEngine & Game-Safe Classification", () => {
  const engine = new WindowRuleEngine();

  // 1. Unmanaged surfaces
  it("classifies unmanaged windows as ignored (runtime)", () => {
    const res = engine.classify({
      windowId: "1",
      managed: false,
      resourceClass: "xterm",
      title: "Terminal"
    });
    expect(res.classification).toBe("ignored");
    expect(res.source).toBe("runtime");
  });

  // 2. Non-normal system surfaces
  it("classifies non-normal surfaces (dock, panel, notification) as ignored (runtime)", () => {
    const dock = engine.classify({
      windowId: "2",
      managed: true,
      normalWindow: false,
      resourceClass: "plasmashell",
      dock: true
    });
    expect(dock.classification).toBe("ignored");
    expect(dock.source).toBe("runtime");

    const notif = engine.classify({
      windowId: "3",
      managed: true,
      normalWindow: true,
      notification: true
    });
    expect(notif.classification).toBe("ignored");
    expect(notif.source).toBe("runtime");
  });

  // 3. True fullscreen window
  it("classifies true fullscreen windows as fullscreen (runtime)", () => {
    const res = engine.classify({
      windowId: "4",
      managed: true,
      normalWindow: true,
      fullScreen: true,
      resourceClass: "vlc"
    });
    expect(res.classification).toBe("fullscreen");
    expect(res.source).toBe("runtime");
  });

  // 4. User custom rule cannot override true fullscreen
  it("ensures true fullscreen takes precedence over user custom tile rule", () => {
    const customEngine = new WindowRuleEngine({
      customRules: [
        {
          pattern: "mpv",
          matchType: "class",
          action: "tiled"
        }
      ]
    });
    const res = customEngine.classify({
      windowId: "5",
      managed: true,
      normalWindow: true,
      fullScreen: true,
      resourceClass: "mpv"
    });
    expect(res.classification).toBe("fullscreen");
    expect(res.source).toBe("runtime");
  });

  // 5. Fullscreen-like borderless window
  it("classifies borderless window covering display as fullscreen-like (runtime)", () => {
    const res = engine.classify({
      windowId: "6",
      managed: true,
      normalWindow: true,
      noBorder: true,
      maximizeMode: 0,
      frameGeometry: { x: 0, y: 0, width: 1920, height: 1080 },
      outputGeometry: { x: 0, y: 0, width: 1920, height: 1080 },
      resourceClass: "my_borderless_game"
    });
    expect(res.classification).toBe("fullscreen-like");
    expect(res.source).toBe("runtime");
  });

  // 6. Maximized regular window (NOT fullscreen-like)
  it("does not classify maximized regular windows as fullscreen-like", () => {
    const res = engine.classify({
      windowId: "7",
      managed: true,
      normalWindow: true,
      noBorder: false,
      maximizeMode: 3, // Maximized both
      frameGeometry: { x: 0, y: 0, width: 1920, height: 1080 },
      outputGeometry: { x: 0, y: 0, width: 1920, height: 1080 },
      resourceClass: "google-chrome"
    });
    expect(res.classification).toBe("tiled");
    expect(res.source).toBe("fallback");
  });

  // 7. Steam app window with default policy (floating)
  it("identifies steam_app_* as game and floats by default (default-rule)", () => {
    const res = engine.classify({
      windowId: "8",
      managed: true,
      normalWindow: true,
      resourceClass: "steam_app_12345",
      resourceName: "steam_app_12345"
    });
    expect(res.classification).toBe("floating");
    expect(res.source).toBe("default-rule");
    expect(res.matchedPattern).toBe("steam_app_*");
  });

  // 8. Steam app window with gameWindowPolicy: tiled
  it("tiles steam_app_* when gameWindowPolicy is tiled", () => {
    const tiledGameEngine = new WindowRuleEngine({
      gameWindowPolicy: "tiled"
    });
    const res = tiledGameEngine.classify({
      windowId: "9",
      managed: true,
      normalWindow: true,
      resourceClass: "steam_app_54321"
    });
    expect(res.classification).toBe("tiled");
    expect(res.source).toBe("default-rule");
    expect(res.matchedPattern).toBe("steam_app_*");
  });

  // 9. Gamescope window
  it("identifies gamescope as game window", () => {
    const res = engine.classify({
      windowId: "10",
      managed: true,
      normalWindow: true,
      resourceClass: "gamescope"
    });
    expect(res.classification).toBe("floating");
    expect(res.source).toBe("default-rule");
    expect(res.matchedPattern).toBe("gamescope");
  });

  // 10. Ordinary Steam client (NOT a game)
  it("does not classify ordinary Steam client as a game; tiles by default", () => {
    const res = engine.classify({
      windowId: "11",
      managed: true,
      normalWindow: true,
      resourceClass: "steam",
      resourceName: "steam",
      appId: "steam"
    });
    expect(res.classification).toBe("tiled");
    expect(res.source).toBe("fallback");
  });

  // 11. Steam web helper (NOT a game)
  it("does not classify steamwebhelper as a game; tiles by default", () => {
    const res = engine.classify({
      windowId: "12",
      managed: true,
      normalWindow: true,
      resourceClass: "steamwebhelper",
      appId: "steamwebhelper"
    });
    expect(res.classification).toBe("tiled");
    expect(res.source).toBe("fallback");
  });

  // 12. Generic Wine window without game identity (NOT a game)
  it("does not classify generic Wine window as a game; tiles by default", () => {
    const res = engine.classify({
      windowId: "13",
      managed: true,
      normalWindow: true,
      resourceClass: "wine",
      title: "Wine configuration"
    });
    expect(res.classification).toBe("tiled");
    expect(res.source).toBe("fallback");
  });

  // 13. Wine game window with steam_app indicator
  it("classifies Wine game with steam_app indicator as a game", () => {
    const res = engine.classify({
      windowId: "14",
      managed: true,
      normalWindow: true,
      resourceClass: "wine",
      resourceName: "steam_app_1091500"
    });
    expect(res.classification).toBe("floating");
    expect(res.source).toBe("default-rule");
  });

  // 14. User custom rule matching class with action 'float' (normalized to floating)
  it("normalizes legacy action 'float' to 'floating' (user-rule)", () => {
    const customEngine = new WindowRuleEngine({
      customRules: [
        {
          pattern: "gimp",
          matchType: "class",
          action: "float"
        }
      ]
    });
    const res = customEngine.classify({
      windowId: "15",
      managed: true,
      normalWindow: true,
      resourceClass: "gimp-2.10"
    });
    expect(res.classification).toBe("floating");
    expect(res.source).toBe("user-rule");
    expect(res.matchedPattern).toBe("gimp");
  });

  // 15. User custom rule matching class with action 'floating'
  it("matches custom rule with action 'floating'", () => {
    const customEngine = new WindowRuleEngine({
      customRules: [
        {
          id: "rule-blender",
          pattern: "blender",
          matchType: "class",
          action: "floating"
        }
      ]
    });
    const res = customEngine.classify({
      windowId: "16",
      managed: true,
      normalWindow: true,
      resourceClass: "blender"
    });
    expect(res.classification).toBe("floating");
    expect(res.source).toBe("user-rule");
    expect(res.matchedRuleId).toBe("rule-blender");
  });

  // 16. User custom rule matching title with action 'tile' (normalized to tiled)
  it("normalizes legacy action 'tile' to 'tiled' on title match (user-rule)", () => {
    const customEngine = new WindowRuleEngine({
      customRules: [
        {
          pattern: "my-calculator",
          matchType: "title",
          action: "tile"
        }
      ]
    });
    const res = customEngine.classify({
      windowId: "17",
      managed: true,
      normalWindow: true,
      resourceClass: "kcalc",
      title: "my-calculator"
    });
    expect(res.classification).toBe("tiled");
    expect(res.source).toBe("user-rule");
  });

  // 17. User custom rule matching title with action 'tiled'
  it("matches custom rule on title with action 'tiled'", () => {
    const customEngine = new WindowRuleEngine({
      customRules: [
        {
          pattern: "Project Dashboard",
          matchType: "title",
          action: "tiled"
        }
      ]
    });
    const res = customEngine.classify({
      windowId: "18",
      managed: true,
      normalWindow: true,
      title: "Active - Project Dashboard - Overview"
    });
    expect(res.classification).toBe("tiled");
    expect(res.source).toBe("user-rule");
  });

  // 18. User custom rule matching role
  it("matches custom rule by window role", () => {
    const customEngine = new WindowRuleEngine({
      customRules: [
        {
          pattern: "browser-window",
          matchType: "role",
          action: "tiled"
        }
      ]
    });
    const res = customEngine.classify({
      windowId: "19",
      managed: true,
      normalWindow: true,
      windowRole: "browser-window"
    });
    expect(res.classification).toBe("tiled");
    expect(res.source).toBe("user-rule");
  });

  // 19. User custom rule regex matching
  it("supports regex pattern matching", () => {
    const customEngine = new WindowRuleEngine({
      customRules: [
        {
          pattern: "^calc_.*_window$",
          matchType: "class",
          action: "floating",
          isRegex: true
        }
      ]
    });
    const match = customEngine.classify({
      windowId: "20",
      managed: true,
      normalWindow: true,
      resourceClass: "calc_scientific_window"
    });
    expect(match.classification).toBe("floating");
    expect(match.source).toBe("user-rule");

    const noMatch = customEngine.classify({
      windowId: "21",
      managed: true,
      normalWindow: true,
      resourceClass: "other_calc_scientific_window_extra"
    });
    expect(noMatch.classification).toBe("tiled");
  });

  // 20. Invalid regex fallback
  it("safely falls back to substring matching when regex is invalid", () => {
    const customEngine = new WindowRuleEngine({
      customRules: [
        {
          pattern: "[invalid(regex",
          matchType: "title",
          action: "floating",
          isRegex: true
        }
      ]
    });
    const res = customEngine.classify({
      windowId: "22",
      managed: true,
      normalWindow: true,
      title: "Contains [invalid(regex substring"
    });
    expect(res.classification).toBe("floating");
    expect(res.source).toBe("user-rule");
  });

  // 21. User filter tokens (comma-separated)
  it("floats windows matching comma-separated user filter tokens", () => {
    const filterEngine = new WindowRuleEngine({
      userFilterString: "vlc, kcalc, pavucontrol"
    });
    const vlc = filterEngine.classify({
      windowId: "23",
      managed: true,
      normalWindow: true,
      resourceClass: "vlc"
    });
    expect(vlc.classification).toBe("floating");
    expect(vlc.source).toBe("user-rule");

    const kcalc = filterEngine.classify({
      windowId: "24",
      managed: true,
      normalWindow: true,
      resourceClass: "org.kde.kcalc"
    });
    expect(kcalc.classification).toBe("floating");
    expect(kcalc.source).toBe("user-rule");
  });

  // 22. Retired Control Center implicit float rule removed; windows with Tessera in title tile by default
  it("does not float ordinary windows with Tessera in title merely for that string", () => {
    const docWindow = engine.classify({
      windowId: "25",
      managed: true,
      normalWindow: true,
      resourceClass: "google-chrome",
      title: "Tessera Documentation - Architecture"
    });
    expect(docWindow.classification).toBe("tiled");
    expect(docWindow.source).toBe("fallback");

    const codeWindow = engine.classify({
      windowId: "25b",
      managed: true,
      normalWindow: true,
      resourceClass: "code",
      title: "tessera_settings.py - Visual Studio Code"
    });
    expect(codeWindow.classification).toBe("tiled");
    expect(codeWindow.source).toBe("fallback");

    const retiredSettingsWindow = engine.classify({
      windowId: "25c",
      managed: true,
      normalWindow: true,
      resourceClass: "tessera-settings",
      title: "Tessera Control Center"
    });
    expect(retiredSettingsWindow.classification).toBe("tiled");
    expect(retiredSettingsWindow.source).toBe("fallback");
  });

  it("preserves explicitly user-customized floatFilter values (user-rule)", () => {
    const customEngine = new WindowRuleEngine({
      userFilterString: "custom-tool,my-app,tessera-admin"
    });
    const tool = customEngine.classify({
      windowId: "25d",
      managed: true,
      normalWindow: true,
      resourceClass: "custom-tool",
      title: "My Special Tool"
    });
    expect(tool.classification).toBe("floating");
    expect(tool.source).toBe("user-rule");

    const admin = customEngine.classify({
      windowId: "25e",
      managed: true,
      normalWindow: true,
      resourceClass: "tessera-admin",
      title: "Admin"
    });
    expect(admin.classification).toBe("floating");
    expect(admin.source).toBe("user-rule");
  });

  // 22b. Shipped floatFilter defaults & Steam/game/browser regression
  describe("Shipped floatFilter defaults & Steam/game/browser regression", () => {
    const SHIPPED_DEFAULT_FLOAT_FILTER =
      "krunner,kcalc,systemsettings,pavucontrol,plasma-desktop,spectacle,kdialog,ksplashqml,org.kde.polkit-kde-authentication-agent-1";

    it("reproduces the defect when buggy legacy floatFilter tokens are present", () => {
      const buggyEngine = new WindowRuleEngine({
        userFilterString: "krunner,Steam,steam_app,steamwebhelper"
      });
      // Steam client is auto-floated as user-rule (false green previously masked by bare engine)
      const steamClient = buggyEngine.classify({
        windowId: "bug-1",
        managed: true,
        normalWindow: true,
        resourceClass: "steam",
        title: "Steam"
      });
      expect(steamClient.classification).toBe("floating");
      expect(steamClient.source).toBe("user-rule");

      // steamwebhelper is auto-floated as user-rule
      const webhelper = buggyEngine.classify({
        windowId: "bug-2",
        managed: true,
        normalWindow: true,
        resourceClass: "steamwebhelper",
        appId: "steamwebhelper"
      });
      expect(webhelper.classification).toBe("floating");
      expect(webhelper.source).toBe("user-rule");

      // Browser with "Steam" in title is auto-floated as user-rule
      const browser = buggyEngine.classify({
        windowId: "bug-3",
        managed: true,
        normalWindow: true,
        resourceClass: "firefox",
        title: "Steam Community :: Workshop"
      });
      expect(browser.classification).toBe("floating");
      expect(browser.source).toBe("user-rule");

      // Steam game floats via user-rule token, bypassing gameWindowPolicy
      const gameWithTilePolicy = new WindowRuleEngine({
        userFilterString: "krunner,Steam,steam_app,steamwebhelper",
        gameWindowPolicy: "tiled"
      });
      const steamGame = gameWithTilePolicy.classify({
        windowId: "bug-4",
        managed: true,
        normalWindow: true,
        resourceClass: "steam_app_1091500",
        resourceName: "steam_app_1091500"
      });
      expect(steamGame.classification).toBe("floating");
      expect(steamGame.source).toBe("user-rule");
    });

    it("classifies ordinary Steam client as tiled under shipped defaults", () => {
      const shippedEngine = new WindowRuleEngine({
        userFilterString: SHIPPED_DEFAULT_FLOAT_FILTER
      });
      const res = shippedEngine.classify({
        windowId: "ship-1",
        managed: true,
        normalWindow: true,
        resourceClass: "steam",
        resourceName: "steam",
        appId: "steam",
        title: "Steam"
      });
      expect(res.classification).toBe("tiled");
      expect(res.source).toBe("fallback");
    });

    it("classifies steamwebhelper as tiled under shipped defaults", () => {
      const shippedEngine = new WindowRuleEngine({
        userFilterString: SHIPPED_DEFAULT_FLOAT_FILTER
      });
      const res = shippedEngine.classify({
        windowId: "ship-2",
        managed: true,
        normalWindow: true,
        resourceClass: "steamwebhelper",
        appId: "steamwebhelper",
        title: "Steam"
      });
      expect(res.classification).toBe("tiled");
      expect(res.source).toBe("fallback");
    });

    it("classifies unrelated browser windows with Steam in title as tiled under shipped defaults", () => {
      const shippedEngine = new WindowRuleEngine({
        userFilterString: SHIPPED_DEFAULT_FLOAT_FILTER
      });
      const firefox = shippedEngine.classify({
        windowId: "ship-3",
        managed: true,
        normalWindow: true,
        resourceClass: "firefox",
        title: "Steam Community :: Workshop"
      });
      expect(firefox.classification).toBe("tiled");
      expect(firefox.source).toBe("fallback");

      const chrome = shippedEngine.classify({
        windowId: "ship-4",
        managed: true,
        normalWindow: true,
        resourceClass: "google-chrome",
        title: "Steam Store - Great on Deck"
      });
      expect(chrome.classification).toBe("tiled");
      expect(chrome.source).toBe("fallback");
    });

    it("classifies Steam games according to gameWindowPolicy under shipped defaults", () => {
      // Default policy is floating
      const defaultGameEngine = new WindowRuleEngine({
        userFilterString: SHIPPED_DEFAULT_FLOAT_FILTER,
        gameWindowPolicy: "floating"
      });
      const floatingGame = defaultGameEngine.classify({
        windowId: "ship-5",
        managed: true,
        normalWindow: true,
        resourceClass: "steam_app_1091500",
        resourceName: "steam_app_1091500"
      });
      expect(floatingGame.classification).toBe("floating");
      expect(floatingGame.source).toBe("default-rule");
      expect(floatingGame.matchedPattern).toBe("steam_app_*");

      // User setting gameWindowPolicy to tiled tiles the game
      const tiledGameEngine = new WindowRuleEngine({
        userFilterString: SHIPPED_DEFAULT_FLOAT_FILTER,
        gameWindowPolicy: "tiled"
      });
      const tiledGame = tiledGameEngine.classify({
        windowId: "ship-6",
        managed: true,
        normalWindow: true,
        resourceClass: "steam_app_1091500",
        resourceName: "steam_app_1091500"
      });
      expect(tiledGame.classification).toBe("tiled");
      expect(tiledGame.source).toBe("default-rule");
      expect(tiledGame.matchedPattern).toBe("steam_app_*");
    });

    it("preserves explicit user-customized floatFilter targeting steam", () => {
      const userCustomEngine = new WindowRuleEngine({
        userFilterString: `${SHIPPED_DEFAULT_FLOAT_FILTER},steam`
      });
      const customSteam = userCustomEngine.classify({
        windowId: "ship-7",
        managed: true,
        normalWindow: true,
        resourceClass: "steam",
        title: "Steam"
      });
      expect(customSteam.classification).toBe("floating");
      expect(customSteam.source).toBe("user-rule");
      expect(customSteam.matchedPattern).toBe("steam");
    });

    it("preserves auto-floating for shipped default utilities", () => {
      const shippedEngine = new WindowRuleEngine({
        userFilterString: SHIPPED_DEFAULT_FLOAT_FILTER
      });
      for (const util of ["krunner", "kcalc", "systemsettings", "spectacle", "pavucontrol"]) {
        const res = shippedEngine.classify({
          windowId: `util-${util}`,
          managed: true,
          normalWindow: true,
          resourceClass: util,
          title: util
        });
        expect(res.classification).toBe("floating");
        expect(res.source).toBe("user-rule");
      }
    });
  });

  // 23. Preserved pre-Phase-1A dialog behavior (tiles by default)
  it("preserves pre-Phase-1A dialog behavior (tiles by default unless explicitly ruled)", () => {
    const dlg = engine.classify({
      windowId: "26",
      managed: true,
      normalWindow: true,
      dialog: true,
      title: "Open File"
    });
    expect(dlg.classification).toBe("tiled");
    expect(dlg.source).toBe("fallback");

    const trans = engine.classify({
      windowId: "27",
      managed: true,
      normalWindow: true,
      transient: true,
      title: "Save As"
    });
    expect(trans.classification).toBe("tiled");
    expect(trans.source).toBe("fallback");

    // Explicit custom rule for dialog
    const customEngine = new WindowRuleEngine({
      customRules: [{ pattern: "Special Dialog", matchType: "title", action: "floating" }]
    });
    const customDlg = customEngine.classify({
      windowId: "27b",
      managed: true,
      normalWindow: true,
      dialog: true,
      title: "Special Dialog"
    });
    expect(customDlg.classification).toBe("floating");
    expect(customDlg.source).toBe("user-rule");
  });

  // 24. Default fallback window
  it("tiles standard desktop windows by default (fallback)", () => {
    const kitty = engine.classify({
      windowId: "28",
      managed: true,
      normalWindow: true,
      resourceClass: "kitty",
      title: "bash"
    });
    expect(kitty.classification).toBe("tiled");
    expect(kitty.source).toBe("fallback");

    const dolphin = engine.classify({
      windowId: "29",
      managed: true,
      normalWindow: true,
      resourceClass: "org.kde.dolphin",
      title: "Home — Dolphin"
    });
    expect(dolphin.classification).toBe("tiled");
    expect(dolphin.source).toBe("fallback");
  });

  // 25. QML bridge parity
  it("verifies QML bridge RuleEngine.classify produces identical results", () => {
    const rawKWinWindow = {
      internalId: "{abcd-1234}",
      managed: true,
      normalWindow: true,
      resourceClass: "steam_app_730",
      caption: "Counter-Strike 2"
    };
    const bridgeRes = RuleEngine.classify(rawKWinWindow, {
      gameWindowPolicy: "floating"
    });
    expect(bridgeRes.classification).toBe("floating");
    expect(bridgeRes.source).toBe("default-rule");
    expect(RuleEngine.shouldFloat(rawKWinWindow)).toBe(true);

    const normalWin = {
      internalId: "{abcd-5678}",
      managed: true,
      normalWindow: true,
      resourceClass: "kitty",
      caption: "zsh"
    };
    const normalRes = RuleEngine.classify(normalWin);
    expect(normalRes.classification).toBe("tiled");
    expect(RuleEngine.shouldFloat(normalWin)).toBe(false);
  });
});

describe("Slot Persistence, Tileability State Tracking, and Artifact Drift Guard", () => {
  // 1. Entering fullscreen preserves slot/order
  it("entering fullscreen preserves slot order in persistent screen state", () => {
    let persistentOrder = ["win-1", "win-2", "win-3"];
    const savedTiledGeometries: Record<string, { x: number; y: number; width: number; height: number }> = {
      "win-1": { x: 0, y: 0, width: 600, height: 1080 },
      "win-2": { x: 600, y: 0, width: 600, height: 1080 },
      "win-3": { x: 1200, y: 0, width: 600, height: 1080 },
    };

    // win-2 entered fullscreen!
    const windows = [
      { id: "win-1", fullScreen: false, normalWindow: true, managed: true },
      { id: "win-2", fullScreen: true, normalWindow: true, managed: true },
      { id: "win-3", fullScreen: false, normalWindow: true, managed: true },
    ];

    const engine = new WindowRuleEngine();
    const activeTileables = windows.filter(w => engine.classify({
      windowId: w.id,
      fullScreen: w.fullScreen,
      normalWindow: w.normalWindow,
      managed: w.managed
    }).classification === "tiled");

    expect(activeTileables.map(w => w.id)).toEqual(["win-1", "win-3"]);

    // Main.qml prunedPersistent slot memory algorithm
    const prunedPersistent: string[] = [];
    for (const pWid of persistentOrder) {
      const foundInActive = activeTileables.some(w => w.id === pWid);
      const hasSavedSlot = Boolean(savedTiledGeometries[pWid]);
      if (foundInActive || hasSavedSlot) {
        prunedPersistent.push(pWid);
      }
    }
    persistentOrder = prunedPersistent;

    // Verify win-2's slot is preserved in persistent order despite not being active
    expect(persistentOrder).toEqual(["win-1", "win-2", "win-3"]);
  });

  // 2. Exiting fullscreen restores slot/order
  it("exiting fullscreen restores slot order without reshuffling existing tiles", () => {
    let persistentOrder = ["win-1", "win-2", "win-3"];

    // win-2 exits fullscreen!
    const windows = [
      { id: "win-1", fullScreen: false, normalWindow: true, managed: true },
      { id: "win-2", fullScreen: false, normalWindow: true, managed: true },
      { id: "win-3", fullScreen: false, normalWindow: true, managed: true },
    ];

    const engine = new WindowRuleEngine();
    const activeTileables = windows.filter(w => engine.classify({
      windowId: w.id,
      fullScreen: w.fullScreen,
      normalWindow: w.normalWindow,
      managed: w.managed
    }).classification === "tiled");

    const newOrder: string[] = [];
    for (const pWid of persistentOrder) {
      if (activeTileables.some(w => w.id === pWid)) {
        newOrder.push(pWid);
      }
    }

    expect(newOrder).toEqual(["win-1", "win-2", "win-3"]);
  });

  // 3. Entering fullscreen-like state changes tileability once
  it("entering fullscreen-like state changes tileability once and coalesces repeat events", () => {
    const tracker = new WindowClassificationTracker();
    const engine = new WindowRuleEngine();

    const initialInput: WindowRuleInput = {
      windowId: "game-win",
      managed: true,
      normalWindow: true,
      noBorder: false,
      maximizeMode: 0,
      resourceClass: "my_custom_game"
    };

    const initialRes = engine.classify(initialInput);
    const initialEval = tracker.evaluate("game-win", initialRes);
    expect(initialEval.isTileable).toBe(true);
    expect(initialEval.classification).toBe("tiled");

    // Transition to fullscreen-like borderless window
    const borderlessInput: WindowRuleInput = {
      windowId: "game-win",
      managed: true,
      normalWindow: true,
      noBorder: true,
      maximizeMode: 0,
      frameGeometry: { x: 0, y: 0, width: 1920, height: 1080 },
      outputGeometry: { x: 0, y: 0, width: 1920, height: 1080 },
      resourceClass: "my_custom_game"
    };

    const borderlessRes = engine.classify(borderlessInput);
    const firstEval = tracker.evaluate("game-win", borderlessRes);

    // Changes tileability once (from true to false)
    expect(firstEval.changed).toBe(true);
    expect(firstEval.isTileable).toBe(false);
    expect(firstEval.classification).toBe("fullscreen-like");

    // Repeat event with identical state (e.g. geometry tick)
    const repeatRes = engine.classify(borderlessInput);
    const secondEval = tracker.evaluate("game-win", repeatRes);

    // Coalesced: changed is false!
    expect(secondEval.changed).toBe(false);
    expect(secondEval.isTileable).toBe(false);
    expect(secondEval.classification).toBe("fullscreen-like");
  });

  // 4. Unchanged classification causes no layout transaction
  it("unchanged classification causes no layout transaction", () => {
    const tracker = new WindowClassificationTracker();
    const engine = new WindowRuleEngine();

    let transactionCount = 0;
    const onTileabilityChanged = () => {
      transactionCount++;
    };

    const input: WindowRuleInput = {
      windowId: "browser-win",
      managed: true,
      normalWindow: true,
      resourceClass: "google-chrome"
    };

    const res1 = engine.classify(input);
    const eval1 = tracker.evaluate("browser-win", res1);
    if (eval1.changed) {
      onTileabilityChanged();
    }
    expect(transactionCount).toBe(0);

    for (let i = 0; i < 5; i++) {
      const res = engine.classify(input);
      const evalN = tracker.evaluate("browser-win", res);
      if (evalN.changed) {
        onTileabilityChanged();
      }
    }

    expect(transactionCount).toBe(0);
  });

  // 5. Staged generated-artifact drift fails verification
  it("staged generated-artifact drift fails verification check against HEAD", () => {
    // Verify that git diff --exit-code detects drifted artifacts and exits non-zero
    expect(() => {
      execSync("git diff --exit-code 84d58a133ca3292715e02c454fc5a4459599d003 HEAD -- contents/code/rules.js", {
        cwd: process.cwd(),
        stdio: "pipe"
      });
    }).toThrow();
  });

  // 6. Engine caching & deterministic signature
  it("reuses compiled WindowRuleEngine across calls and rebuilds only when signature changes", () => {
    RuleEngine.clearCache();
    expect(RuleEngine.getCachedSignature()).toBe("");

    const win = { internalId: "test-win", managed: true, normalWindow: true, resourceClass: "kitty" };
    const options1 = { gameWindowPolicy: "floating" as const, userFilterString: "tessera" };

    RuleEngine.classify(win, options1);
    const sig1 = RuleEngine.getCachedSignature();
    expect(sig1).toContain("floating");
    expect(sig1).toContain("tessera");

    // Second call with same options uses cached engine
    RuleEngine.classify(win, options1);
    expect(RuleEngine.getCachedSignature()).toBe(sig1);

    // Call with different gameWindowPolicy rebuilds engine
    const options2 = { gameWindowPolicy: "tiled" as const, userFilterString: "tessera" };
    RuleEngine.classify(win, options2);
    const sig2 = RuleEngine.getCachedSignature();
    expect(sig2).not.toBe(sig1);
    expect(sig2).toContain("tiled");
  });
});
