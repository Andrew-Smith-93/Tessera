import type { LogicalWindowIdentity, WindowClassification } from "@tessera/protocol";

export type MatchType = "class" | "title" | "role" | "app";
export type RuleAction = WindowClassification;

export interface CustomRule {
  readonly id?: string;
  readonly pattern: string;
  readonly matchType: MatchType;
  readonly action: RuleAction;
  readonly isRegex?: boolean;
}

export interface RuleEngineOptions {
  userFilterPatterns?: string[];
  customRules?: CustomRule[];
}

export class WindowRuleEngine {
  private userFilterTokens: string[] = [];
  private customRules: CustomRule[] = [];

  /**
   * Only Tessera Control Center itself floats by default so user can configure the system.
   */
  public static readonly DEFAULT_FLOAT_PATTERNS: readonly string[] = Object.freeze([
    "tessera",
    "tessera-settings",
    "tessera_settings.py"
  ]);

  constructor(options: RuleEngineOptions = {}) {
    this.updateOptions(options);
  }

  public updateOptions(options: RuleEngineOptions): void {
    if (options.userFilterPatterns) {
      this.userFilterTokens = options.userFilterPatterns
        .flatMap(p => p.split(","))
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 0);
    }
    if (options.customRules) {
      this.customRules = [...options.customRules];
    }
  }

  /**
   * Determine if a window surface should be completely ignored by the window manager.
   */
  public isIgnored(window: LogicalWindowIdentity): boolean {
    if (window.isManaged === false) return true;
    if (window.isNormal === false) return true;
    return false;
  }

  /**
   * Classify a window identity into its appropriate window management category:
   * "ignored" | "floating" | "fullscreen" | "dialog" | "tiled"
   */
  public classify(window: LogicalWindowIdentity): WindowClassification {
    if (this.isIgnored(window)) {
      return "ignored";
    }

    const winClass = (window.windowClass || "").toLowerCase();
    const appId = (window.appId || "").toLowerCase();
    const title = (window.title || "").toLowerCase();
    const role = (window.role || "").toLowerCase();

    // Check custom rules first (highest priority user override)
    for (const rule of this.customRules) {
      let targetString = "";
      switch (rule.matchType) {
        case "class":
          targetString = winClass;
          break;
        case "app":
          targetString = appId;
          break;
        case "title":
          targetString = title;
          break;
        case "role":
          targetString = role;
          break;
      }

      let matched = false;
      if (rule.isRegex) {
        try {
          const re = new RegExp(rule.pattern, "i");
          matched = re.test(targetString);
        } catch {
          matched = targetString.includes(rule.pattern.toLowerCase());
        }
      } else {
        matched = targetString.includes(rule.pattern.toLowerCase());
      }

      if (matched) {
        return rule.action;
      }
    }

    // Check default float patterns (Tessera Control Center)
    for (const pat of WindowRuleEngine.DEFAULT_FLOAT_PATTERNS) {
      if (winClass.includes(pat) || appId.includes(pat) || title.includes(pat)) {
        return "floating";
      }
    }

    // Check user filter comma-separated patterns
    for (const token of this.userFilterTokens) {
      if (winClass.includes(token) || appId.includes(token) || title.includes(token)) {
        return "floating";
      }
    }

    // Everything else tiles by default!
    return "tiled";
  }
}
