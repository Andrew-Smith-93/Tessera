import { describe, it, expect } from "vitest";
import { WindowRuleEngine } from "../src/rules.js";
import type { LogicalWindowIdentity } from "@tessera/protocol";

describe("WindowRuleEngine", () => {
  const engine = new WindowRuleEngine();

  it("ignores non-managed or non-normal windows", () => {
    const dock: LogicalWindowIdentity = {
      appId: "plasmashell",
      windowClass: "plasmashell",
      title: "Panel",
      isNormal: false,
      isManaged: true,
    };
    expect(engine.classify(dock)).toBe("ignored");

    const unmanaged: LogicalWindowIdentity = {
      appId: "xterm",
      windowClass: "xterm",
      title: "Terminal",
      isNormal: true,
      isManaged: false,
    };
    expect(engine.classify(unmanaged)).toBe("ignored");
  });

  it("floats Tessera Control Center by default", () => {
    const settings: LogicalWindowIdentity = {
      appId: "tessera-settings",
      windowClass: "tessera_settings.py",
      title: "Tessera Control Center",
      isNormal: true,
      isManaged: true,
    };
    expect(engine.classify(settings)).toBe("floating");
  });

  it("tiles standard applications by default", () => {
    const terminal: LogicalWindowIdentity = {
      appId: "kitty",
      windowClass: "kitty",
      title: "bash",
      isNormal: true,
      isManaged: true,
    };
    expect(engine.classify(terminal)).toBe("tiled");

    const browser: LogicalWindowIdentity = {
      appId: "google-chrome",
      windowClass: "google-chrome",
      title: "GitHub",
      isNormal: true,
      isManaged: true,
    };
    expect(engine.classify(browser)).toBe("tiled");
  });

  it("respects custom rules to force float or tile", () => {
    const customEngine = new WindowRuleEngine({
      customRules: [
        {
          pattern: "steam_app",
          matchType: "class",
          action: "floating",
        },
        {
          pattern: "my-calculator",
          matchType: "title",
          action: "tiled",
        },
      ],
    });

    const game: LogicalWindowIdentity = {
      appId: "steam_app_12345",
      windowClass: "steam_app_12345",
      title: "Game",
      isNormal: true,
      isManaged: true,
    };
    expect(customEngine.classify(game)).toBe("floating");

    const calc: LogicalWindowIdentity = {
      appId: "kcalc",
      windowClass: "kcalc",
      title: "my-calculator",
      isNormal: true,
      isManaged: true,
    };
    expect(customEngine.classify(calc)).toBe("tiled");
  });
});
