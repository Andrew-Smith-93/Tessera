import { describe, it, expect } from "vitest";
import {
  WindowRuleEngine,
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

  // 22. Tessera Control Center default float rule
  it("floats Tessera Control Center by default (default-rule)", () => {
    const settings = engine.classify({
      windowId: "25",
      managed: true,
      normalWindow: true,
      resourceClass: "tessera-settings",
      title: "Tessera Control Center"
    });
    expect(settings.classification).toBe("floating");
    expect(settings.source).toBe("default-rule");
  });

  // 23. Dialog / transient window handling
  it("classifies dialog / transient windows as dialog (runtime)", () => {
    const dlg = engine.classify({
      windowId: "26",
      managed: true,
      normalWindow: true,
      dialog: true
    });
    expect(dlg.classification).toBe("dialog");
    expect(dlg.source).toBe("runtime");

    const trans = engine.classify({
      windowId: "27",
      managed: true,
      normalWindow: true,
      transient: true
    });
    expect(trans.classification).toBe("dialog");
    expect(trans.source).toBe("runtime");
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
