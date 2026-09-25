import type { LogicalWindowIdentity, Rect, WindowClassification } from "@tessera/protocol";

export type MatchType = "class" | "title" | "role" | "app";
export type LegacyRuleAction = "tile" | "float";
export type RuleAction = WindowClassification | LegacyRuleAction;

export const VALID_MATCH_TYPES = ["class", "title", "role", "app"] as const;
export const VALID_RULE_ACTIONS = ["tile", "float", "monocle", "tiled", "floating", "ignored"] as const;

export interface CustomRule {
  readonly id?: string;
  readonly pattern: string;
  readonly matchType: MatchType;
  readonly action: RuleAction;
  readonly isRegex?: boolean;
}

export interface RuleValidationResult {
  readonly valid: boolean;
  readonly rules: CustomRule[];
  readonly errors: string[];
}

export function validateCustomRules(input: unknown): RuleValidationResult {
  if (input === undefined || input === null) {
    return { valid: true, rules: [], errors: [] };
  }

  let rawRules: unknown = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed === "" || trimmed === "[]") {
      return { valid: true, rules: [], errors: [] };
    }
    try {
      rawRules = JSON.parse(trimmed);
    } catch (e: any) {
      return {
        valid: false,
        rules: [],
        errors: [`Malformed JSON syntax: ${e?.message || String(e)}`]
      };
    }
  }

  if (!Array.isArray(rawRules)) {
    return {
      valid: false,
      rules: [],
      errors: ["Custom rules must be an array of rule objects"]
    };
  }

  const errors: string[] = [];
  const validRules: CustomRule[] = [];

  for (let i = 0; i < rawRules.length; i++) {
    const item = rawRules[i];
    const prefix = `Rule #${i + 1}`;

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${prefix}: must be a non-null object`);
      continue;
    }

    const rec = item as Record<string, unknown>;

    // Pattern validation
    if (typeof rec.pattern !== "string" || rec.pattern.trim().length === 0) {
      errors.push(`${prefix}: 'pattern' must be a non-empty string`);
      continue;
    }

    // MatchType validation
    const rawMatchType = typeof rec.matchType === "string" ? rec.matchType.toLowerCase() : "";
    if (!(VALID_MATCH_TYPES as readonly string[]).includes(rawMatchType)) {
      errors.push(
        `${prefix}: 'matchType' must be one of: ${VALID_MATCH_TYPES.join(", ")} (got ${JSON.stringify(rec.matchType)})`
      );
      continue;
    }

    // Action validation
    const rawAction = typeof rec.action === "string" ? rec.action.toLowerCase() : "";
    if (!(VALID_RULE_ACTIONS as readonly string[]).includes(rawAction)) {
      errors.push(
        `${prefix}: 'action' must be one of: ${VALID_RULE_ACTIONS.join(", ")} (got ${JSON.stringify(rec.action)})`
      );
      continue;
    }

    // Regex validation
    let isRegex = false;
    if ("isRegex" in rec && rec.isRegex !== undefined) {
      if (typeof rec.isRegex !== "boolean") {
        errors.push(`${prefix}: 'isRegex' must be a boolean`);
        continue;
      }
      isRegex = rec.isRegex;
      if (isRegex) {
        try {
          new RegExp(rec.pattern, "i");
        } catch (e: any) {
          errors.push(`${prefix}: invalid regular expression '${rec.pattern}': ${e?.message || String(e)}`);
          continue;
        }
      }
    }

    const validated: {
      pattern: string;
      matchType: MatchType;
      action: RuleAction;
      isRegex?: boolean;
      id?: string;
    } = {
      pattern: rec.pattern,
      matchType: rawMatchType as MatchType,
      action: rawAction as RuleAction
    };
    if (isRegex) {
      validated.isRegex = true;
    }
    if (typeof rec.id === "string" && rec.id) {
      validated.id = rec.id;
    }
    validRules.push(validated as CustomRule);
  }

  if (errors.length > 0) {
    return {
      valid: false,
      rules: [],
      errors
    };
  }

  return {
    valid: true,
    rules: validRules,
    errors: []
  };
}

export type GameWindowPolicy = "floating" | "tiled";

export interface RuleEngineOptions {
  userFilterPatterns?: string[];
  userFilterString?: string;
  customRules?: CustomRule[];
  gameWindowPolicy?: GameWindowPolicy;
  customGamePatterns?: string[];
}

export interface WindowRuleInput {
  windowId?: string;
  resourceClass?: string;
  windowClass?: string; // alias
  resourceName?: string;
  appId?: string;
  desktopFileName?: string;
  title?: string;
  caption?: string; // alias
  windowRole?: string;
  role?: string; // alias
  managed?: boolean;
  isManaged?: boolean; // alias
  normalWindow?: boolean;
  isNormal?: boolean; // alias
  dialog?: boolean;
  transient?: boolean;
  fullScreen?: boolean;
  noBorder?: boolean;
  maximizeMode?: number; // 0 = none, 1 = horiz, 2 = vert, 3 = both
  minimized?: boolean;
  frameGeometry?: Rect;
  outputGeometry?: Rect;
  outputUsableArea?: Rect;
  // Non-normal system surfaces
  desktopWindow?: boolean;
  dock?: boolean;
  splash?: boolean;
  notification?: boolean;
  onScreenDisplay?: boolean;
  popupMenu?: boolean;
  tooltip?: boolean;
  specialWindow?: boolean;
}

export interface WindowClassificationResult {
  classification: WindowClassification;
  reason: string;
  source: "runtime" | "user-rule" | "default-rule" | "fallback";
  matchedRuleId?: string;
  matchedPattern?: string;
}

/**
 * Normalizes legacy rule actions ("tile" -> "tiled", "float" -> "floating").
 */
export function normalizeAction(action: RuleAction | string): WindowClassification {
  const a = (action || "").toLowerCase().trim();
  if (a === "tile" || a === "tiled") return "tiled";
  if (a === "float" || a === "floating") return "floating";
  if (a === "dialog") return "dialog";
  if (a === "fullscreen") return "fullscreen";
  if (a === "fullscreen-like") return "fullscreen-like";
  if (a === "ignored" || a === "ignore") return "ignored";
  return "tiled";
}

/**
 * Determines whether a window identity represents a video game surface.
 */
export function isGameIdentity(
  input: WindowRuleInput,
  customGamePatterns: string[] = []
): { isGame: boolean; matchedPattern?: string } {
  const rClass = (input.resourceClass || input.windowClass || "").toLowerCase();
  const rName = (input.resourceName || "").toLowerCase();
  const appId = (input.appId || "").toLowerCase();
  const desktopFile = (input.desktopFileName || "").toLowerCase();

  // 1. Explicitly exclude the ordinary Steam client and helper processes
  const isOrdinarySteam =
    (rClass === "steam" && !rName.startsWith("steam_app") && !desktopFile.includes("steam_app")) ||
    rClass === "steamwebhelper" ||
    rName === "steamwebhelper" ||
    appId === "steamwebhelper";

  if (isOrdinarySteam) {
    return { isGame: false };
  }

  // 2. Steam games (steam_app_*)
  if (
    rClass.startsWith("steam_app_") ||
    rClass.includes("steam_app_") ||
    rName.startsWith("steam_app_") ||
    rName.includes("steam_app_") ||
    appId.startsWith("steam_app_") ||
    appId.includes("steam_app_") ||
    desktopFile.includes("steam_app_")
  ) {
    return { isGame: true, matchedPattern: "steam_app_*" };
  }

  // 3. Gamescope nested micro-compositor
  if (rClass.includes("gamescope") || rName.includes("gamescope") || appId.includes("gamescope")) {
    return { isGame: true, matchedPattern: "gamescope" };
  }

  // 4. Custom game patterns
  for (const pat of customGamePatterns) {
    const p = pat.toLowerCase().trim();
    if (p.length > 0 && (rClass.includes(p) || rName.includes(p) || appId.includes(p) || desktopFile.includes(p))) {
      return { isGame: true, matchedPattern: pat };
    }
  }

  // Generic Wine/Proton windows (e.g. winecfg, explorer.exe) without game identity are NOT games by default
  return { isGame: false };
}

/**
 * Checks whether a window is in a borderless fullscreen-like state
 * (noBorder === true, maximizeMode === 0, geometry covers >= 98% of physical output or tolerance <= 5px).
 */
export function isFullscreenLike(input: WindowRuleInput): boolean {
  if (input.fullScreen === true) return false;
  if (input.noBorder !== true) return false;

  const maxMode = input.maximizeMode ?? 0;
  if (maxMode !== 0) return false;

  const frame = input.frameGeometry;
  const out = input.outputGeometry ?? input.outputUsableArea;
  if (!frame || !out) return false;

  const frameArea = frame.width * frame.height;
  const outArea = out.width * out.height;
  if (outArea <= 0 || frameArea <= 0) return false;

  const coverageRatio = frameArea / outArea;
  const coversAlmostAll = coverageRatio >= 0.98;

  const xDiff = Math.abs(frame.x - out.x);
  const yDiff = Math.abs(frame.y - out.y);
  const wDiff = Math.abs(frame.width - out.width);
  const hDiff = Math.abs(frame.height - out.height);
  const withinTolerance = xDiff <= 5 && yDiff <= 5 && wDiff <= 5 && hDiff <= 5;

  return coversAlmostAll || withinTolerance;
}

export class WindowRuleEngine {
  private userFilterTokens: string[] = [];
  private customRules: CustomRule[] = [];
  private gameWindowPolicy: GameWindowPolicy = "floating";
  private customGamePatterns: string[] = [];

  /**
   * Default float patterns (retained as an empty frozen array for backward compatibility).
   * Standalone Control Center is retired; implicit floating exceptions are removed.
   */
  public static readonly DEFAULT_FLOAT_PATTERNS: readonly string[] = Object.freeze([]);

  constructor(options: RuleEngineOptions = {}) {
    this.updateOptions(options);
  }

  public updateOptions(options: RuleEngineOptions): void {
    if (options.userFilterString !== undefined) {
      this.userFilterTokens = options.userFilterString
        .split(",")
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 0);
    } else if (options.userFilterPatterns !== undefined) {
      const tokens: string[] = [];
      for (const p of options.userFilterPatterns) {
        if (typeof p === "string") {
          const parts = p.split(",");
          for (const part of parts) {
            const trimmed = part.trim().toLowerCase();
            if (trimmed.length > 0) {
              tokens.push(trimmed);
            }
          }
        }
      }
      this.userFilterTokens = tokens;
    }

    if (options.customRules !== undefined) {
      if (Array.isArray(options.customRules)) {
        this.customRules = options.customRules.filter(
          (r): r is CustomRule => Boolean(r && typeof r === "object" && typeof r.pattern === "string" && r.pattern.trim().length > 0)
        );
      } else {
        const validation = validateCustomRules(options.customRules);
        this.customRules = validation.valid ? validation.rules : [];
      }
    }

    if (options.gameWindowPolicy !== undefined) {
      this.gameWindowPolicy = options.gameWindowPolicy;
    }

    if (options.customGamePatterns !== undefined) {
      this.customGamePatterns = [...options.customGamePatterns];
    }
  }

  /**
   * Determine if a window surface should be completely ignored by the window manager.
   */
  public isIgnored(window: WindowRuleInput | LogicalWindowIdentity): boolean {
    const res = this.classify(window);
    return res.classification === "ignored";
  }

  /**
   * Determine if a window should float by default.
   */
  public shouldFloat(window: WindowRuleInput | LogicalWindowIdentity): boolean {
    const res = this.classify(window);
    return res.classification === "floating" || res.classification === "fullscreen" || res.classification === "fullscreen-like";
  }

  /**
   * Single authoritative classification entrypoint.
   *
   * Precedence order:
   * 1. Unmanaged / non-normal system surfaces -> "ignored" (source: "runtime")
   * 2. True fullscreen (fullScreen === true) -> "fullscreen" (source: "runtime", cannot be overridden by user tile rule)
   * 3. Explicit user rules (custom rules / user filter) -> "user-rule"
   * 4. Fullscreen-like borderless state -> "fullscreen-like" (source: "runtime")
   * 5. Default game recognition -> follows gameWindowPolicy (source: "default-rule")
   * 6. Dialog / transient -> "dialog" (source: "runtime")
   * 7. Default float patterns (Tessera Control Center) -> "floating" (source: "default-rule")
   * 8. Default fallback -> "tiled" (source: "fallback")
   */
  public classify(window: WindowRuleInput | LogicalWindowIdentity): WindowClassificationResult {
    const input: WindowRuleInput = window as WindowRuleInput;

    // 1. Unmanaged surfaces and non-normal system windows
    const isManaged = input.managed !== undefined ? input.managed : (input.isManaged !== undefined ? input.isManaged : true);
    if (!isManaged) {
      return {
        classification: "ignored",
        reason: "Window is not managed by KWin",
        source: "runtime"
      };
    }

    const isNormal = input.normalWindow !== undefined ? input.normalWindow : (input.isNormal !== undefined ? input.isNormal : true);
    if (
      !isNormal ||
      input.desktopWindow ||
      input.dock ||
      input.splash ||
      input.notification ||
      input.onScreenDisplay ||
      input.popupMenu ||
      input.tooltip ||
      input.specialWindow
    ) {
      return {
        classification: "ignored",
        reason: "Surface is a non-normal system surface or transient popup",
        source: "runtime"
      };
    }

    // 2. True fullscreen (runtime state takes highest precedence over user rules)
    if (input.fullScreen === true) {
      return {
        classification: "fullscreen",
        reason: "Window is in true fullscreen state",
        source: "runtime"
      };
    }

    const rClass = (input.resourceClass || input.windowClass || "").toLowerCase();
    const rName = (input.resourceName || "").toLowerCase();
    const appId = (input.appId || "").toLowerCase();
    const desktopFile = (input.desktopFileName || "").toLowerCase();
    const title = (input.caption || input.title || "").toLowerCase();
    const role = (input.windowRole || input.role || "").toLowerCase();

    // 3. Explicit user rules (custom rules & user filter)
    for (const rule of this.customRules) {
      if (!rule || typeof rule !== "object" || typeof rule.pattern !== "string" || !rule.pattern) {
        continue;
      }
      let target = "";
      switch (rule.matchType) {
        case "class":
          target = rClass || rName || appId || desktopFile;
          break;
        case "app":
          target = appId || rClass;
          break;
        case "title":
          target = title;
          break;
        case "role":
          target = role;
          break;
        default:
          continue;
      }

      let matched = false;
      const patLower = rule.pattern.toLowerCase();
      if (rule.isRegex) {
        try {
          const re = new RegExp(rule.pattern, "i");
          matched = re.test(target);
        } catch {
          matched = target.includes(patLower);
        }
      } else {
        matched = target.includes(patLower);
      }

      if (matched) {
        const normalized = normalizeAction(rule.action);
        return {
          classification: normalized,
          reason: `Matched user custom rule (${rule.pattern})`,
          source: "user-rule",
          matchedRuleId: rule.id,
          matchedPattern: rule.pattern
        };
      }
    }

    // User filter tokens (comma-separated list for auto-floating)
    for (const token of this.userFilterTokens) {
      if (
        (rClass && rClass.includes(token)) ||
        (rName && rName.includes(token)) ||
        (appId && appId.includes(token)) ||
        (title && title.includes(token)) ||
        (desktopFile && desktopFile.includes(token))
      ) {
        return {
          classification: "floating",
          reason: `Matched user filter token (${token})`,
          source: "user-rule",
          matchedPattern: token
        };
      }
    }

    // 4. Fullscreen-like borderless state
    if (isFullscreenLike(input)) {
      return {
        classification: "fullscreen-like",
        reason: "Window is borderless and occupies physical display area",
        source: "runtime"
      };
    }

    // 5. Default game recognition
    const gameCheck = isGameIdentity(input, this.customGamePatterns);
    if (gameCheck.isGame) {
      return {
        classification: this.gameWindowPolicy,
        reason: `Identified game window; applying game window policy (${this.gameWindowPolicy})`,
        source: "default-rule",
        matchedPattern: gameCheck.matchedPattern
      };
    }

    // 6. Default fallback: Everything else tiles!
    return {
      classification: "tiled",
      reason: "Default tiling fallback",
      source: "fallback"
    };
  }
}

export interface ClassificationChangeResult {
  readonly changed: boolean;
  readonly isTileable: boolean;
  readonly classification: WindowClassification;
  readonly previousClassification?: WindowClassification;
  readonly result: WindowClassificationResult;
}

/**
 * Minimal per-window classification-state tracking to coalesce events
 * and avoid redundant retile transactions when tileability is unchanged.
 */
export class WindowClassificationTracker {
  private readonly classifications = new Map<string, WindowClassification>();
  private readonly tileability = new Map<string, boolean>();

  public evaluate(
    windowId: string,
    result: WindowClassificationResult
  ): ClassificationChangeResult {
    const prevClassification = this.classifications.get(windowId);
    const prevTileable = this.tileability.get(windowId);
    const isTileable = result.classification === "tiled";

    this.classifications.set(windowId, result.classification);
    this.tileability.set(windowId, isTileable);

    const changed =
      (prevTileable !== undefined && prevTileable !== isTileable) ||
      (prevClassification !== undefined && prevClassification !== result.classification);

    return {
      changed,
      isTileable,
      classification: result.classification,
      previousClassification: prevClassification,
      result
    };
  }

  public forget(windowId: string): void {
    this.classifications.delete(windowId);
    this.tileability.delete(windowId);
  }

  public getClassification(windowId: string): WindowClassification | undefined {
    return this.classifications.get(windowId);
  }

  public isTileable(windowId: string): boolean | undefined {
    return this.tileability.get(windowId);
  }

  public clear(): void {
    this.classifications.clear();
    this.tileability.clear();
  }
}


