import type {
  Rect,
  RuntimeWindowId,
  LayoutAlgorithm,
  LogicalWindowIdentity,
  Direction
} from "@tessera/protocol";
import { solveLayout, findDirectionalNeighbor } from "@tessera/layout-core";
import { WindowRuleEngine } from "@tessera/rules-engine";
import { EchoFilter } from "./echo-filter.js";
import { ScreenStateManager, type ScreenState } from "./screen-state.js";
import type {
  KWinWindow,
  KWinOutput,
  KWinWorkspace
} from "./kwin-api.js";

export interface EngineConfig {
  enableTiling: boolean;
  defaultLayout: LayoutAlgorithm;
  gapInner: number;
  gapOuter: number;
  masterRatio: number;
  masterCount: number;
  ignoreMinimized: boolean;
  showOsd: boolean;
  userFilterPatterns?: string[];
}

export class TilingEngine {
  private readonly workspace: KWinWorkspace;
  private readonly echoFilter: EchoFilter;
  private readonly screenManager: ScreenStateManager;
  private readonly ruleEngine: WindowRuleEngine;
  private readonly windowHookMap = new WeakSet<KWinWindow>();
  private readonly windowMap = new Map<RuntimeWindowId, KWinWindow>();

  private isArranging = false;
  private config: EngineConfig;

  constructor(
    workspaceObj: KWinWorkspace,
    config: EngineConfig
  ) {
    this.workspace = workspaceObj;
    this.config = config;

    this.echoFilter = new EchoFilter(300);
    this.screenManager = new ScreenStateManager(
      config.defaultLayout,
      config.masterCount,
      config.masterRatio,
      { inner: config.gapInner, outer: config.gapOuter }
    );
    this.ruleEngine = new WindowRuleEngine({
      userFilterPatterns: config.userFilterPatterns,
    });
  }

  public getWindowId(w: KWinWindow | null): RuntimeWindowId {
    if (!w) return "";
    if (w.internalId) {
      return typeof w.internalId === "string" ? w.internalId : w.internalId.toString();
    }
    return `${w.caption}_${w.resourceClass || ""}`;
  }

  public getScreenName(screen: KWinOutput | null): string {
    return screen?.name || "default";
  }

  /**
   * Determine the physical screen covering the center of a given rectangle.
   */
  public getScreenForPos(rect: Rect): KWinOutput {
    const screens = this.workspace.screens || [this.workspace.activeScreen];
    if (!screens || screens.length === 0) return this.workspace.activeScreen;

    const cx = rect.x + Math.floor(rect.width / 2);
    const cy = rect.y + Math.floor(rect.height / 2);

    for (const scr of screens) {
      const area = this.workspace.clientArea(0, scr, this.workspace.currentDesktop);
      if (cx >= area.x && cx < area.x + area.width && cy >= area.y && cy < area.y + area.height) {
        return scr;
      }
    }

    return this.workspace.activeScreen || screens[0];
  }

  /**
   * Identifies the current target screen based on active window or cursor position.
   */
  public getCurrentTargetScreen(): KWinOutput {
    const active = this.workspace.activeWindow;
    if (active && active.normalWindow) {
      return this.getScreenForPos(active.frameGeometry);
    }

    const curPos = this.workspace.cursorPos;
    if (curPos) {
      return this.getScreenForPos({ x: curPos.x, y: curPos.y, width: 1, height: 1 });
    }

    return this.workspace.activeScreen || this.workspace.screens[0];
  }

  /**
   * Converts a KWinWindow to a LogicalWindowIdentity for rule classification.
   */
  private toLogicalIdentity(w: KWinWindow): LogicalWindowIdentity {
    return {
      appId: w.resourceName || "",
      windowClass: w.resourceClass || "",
      title: w.caption || "",
      role: w.windowRole || "",
      isManaged: w.managed,
      isNormal: w.normalWindow && !w.desktopWindow && !w.dock && !w.notification,
    };
  }

  public isWindowOnCurrentDesktop(w: KWinWindow): boolean {
    if (!w) return false;
    if (w.onAllDesktops) return true;
    if (w.desktops && w.desktops.length > 0) {
      for (const d of w.desktops) {
        if (d === this.workspace.currentDesktop) return true;
      }
      return false;
    }
    return true;
  }

  public shouldTileWindow(w: KWinWindow, screenState: ScreenState): boolean {
    if (!w || !w.managed) return false;
    if (!this.isWindowOnCurrentDesktop(w)) return false;

    const wid = this.getWindowId(w);
    if (screenState.floatingWindows.has(wid)) return false;

    if (this.config.ignoreMinimized && w.minimized) return false;

    const identity = this.toLogicalIdentity(w);
    const result = this.ruleEngine.classify(identity);
    return result.classification === "tiled";
  }

  /**
   * Gathers and orders the tileable windows for a specific screen,
   * preserving slot indexes across minimize/restore.
   */
  public getTileableWindows(screen: KWinOutput): KWinWindow[] {
    const sName = this.getScreenName(screen);
    const state = this.screenManager.getScreenState(sName);
    const allWindows = this.workspace.stackingOrder || [];

    const activeTileable: KWinWindow[] = [];

    for (const w of allWindows) {
      if (!w) continue;
      const wScreen = this.getScreenForPos(w.frameGeometry);
      if (this.getScreenName(wScreen) !== sName) continue;

      if (this.shouldTileWindow(w, state)) {
        activeTileable.push(w);
      }
    }

    // Reconstruct list aligned with persistentOrder
    const ordered: KWinWindow[] = [];
    const remaining = new Set(activeTileable);

    for (const wid of state.persistentOrder) {
      const match = activeTileable.find(w => this.getWindowId(w) === wid);
      if (match) {
        ordered.push(match);
        remaining.delete(match);
      }
    }

    // Append newly arrived windows
    for (const newWin of remaining) {
      const newWid = this.getWindowId(newWin);
      ordered.push(newWin);
      if (!state.persistentOrder.includes(newWid)) {
        state.persistentOrder.push(newWid);
      }
    }

    return ordered;
  }

  /**
   * Primary layout calculation and frame application hot path.
   */
  public retile(targetScreen?: KWinOutput): void {
    if (!this.config.enableTiling || this.isArranging) return;
    this.isArranging = true;

    try {
      const screens = targetScreen ? [targetScreen] : (this.workspace.screens || [this.workspace.activeScreen]);

      for (const screen of screens) {
        if (!screen) continue;
        const sName = this.getScreenName(screen);
        const state = this.screenManager.getScreenState(sName);

        if (state.activeLayout === "floating") continue;

        const area = this.workspace.clientArea(0, screen, this.workspace.currentDesktop);
        if (!area || area.width <= 0 || area.height <= 0) continue;

        const windows = this.getTileableWindows(screen);
        if (windows.length === 0) continue;

        const windowIds = windows.map(w => this.getWindowId(w));

        const solution = solveLayout(
          state.activeLayout,
          { x: area.x, y: area.y, width: area.width, height: area.height },
          windowIds,
          state.gaps,
          {
            masterCount: state.masterCount,
            masterRatio: state.masterRatio,
          },
          state.treeRoot
        );

        for (const win of windows) {
          const wid = this.getWindowId(win);
          const targetRect = solution.get(wid);
          if (!targetRect) continue;

          // Cache target slot
          state.savedTiledGeometries.set(wid, targetRect);

          // If currently maximized, allow it to remain peacefully maximized.
          // Its assigned tile is saved so it immediately restores when unmaximized.
          if (win.maximizeMode !== 0) {
            continue;
          }

          // Programmatic geometry change with feedback loop suppression
          this.echoFilter.recordCommand(wid, targetRect);
          win.frameGeometry = {
            x: targetRect.x,
            y: targetRect.y,
            width: targetRect.width,
            height: targetRect.height,
          };
        }
      }
    } finally {
      this.isArranging = false;
    }
  }

  /**
   * Hooks lifecycle signals for a window.
   */
  public hookWindow(win: KWinWindow): void {
    if (!win || this.windowHookMap.has(win)) return;
    this.windowHookMap.add(win);

    const wid = this.getWindowId(win);
    this.windowMap.set(wid, win);

    // Frame geometry changed (detect user resizing vs programmatic echo)
    win.frameGeometryChanged.connect(() => {
      const current = win.frameGeometry;
      if (this.echoFilter.isEcho(wid, current)) {
        return; // Swallowed feedback loop echo!
      }

      // If window moved to another screen, trigger retile on both
      if (!this.isArranging) {
        this.retile();
      }
    });

    // Minimized changed
    win.minimizedChanged.connect(() => {
      const sName = this.getScreenName(win.output || this.getScreenForPos(win.frameGeometry));
      const state = this.screenManager.getScreenState(sName);

      if (win.minimized) {
        state.savedMinimGeometries.set(wid, win.frameGeometry);
      } else {
        // Window unminimized: restore cleanly to its designated slot
        const saved = state.savedTiledGeometries.get(wid);
        if (saved) {
          this.echoFilter.recordCommand(wid, saved);
          win.frameGeometry = { ...saved };
        }
      }
      this.retile();
    });

    // Fullscreen changed
    win.fullScreenChanged.connect(() => {
      this.retile();
    });
  }

  // =========================================================================
  // User Actions & Shortcut Callbacks
  // =========================================================================

  public cycleCurrentScreenLayout(forward: boolean = true): void {
    const scr = this.getCurrentTargetScreen();
    const sName = this.getScreenName(scr);
    const nextLayout = this.screenManager.cycleLayout(sName, forward);
    this.notify(`Screen: ${sName} | Layout: ${nextLayout.toUpperCase()}`);
    this.retile(scr);
  }

  public adjustCurrentScreenMasterCount(delta: number): void {
    const scr = this.getCurrentTargetScreen();
    const sName = this.getScreenName(scr);
    const newCount = this.screenManager.adjustMasterCount(sName, delta);
    this.notify(`Screen: ${sName} | Masters: ${newCount}`);
    this.retile(scr);
  }

  public adjustCurrentScreenMasterRatio(delta: number): void {
    const scr = this.getCurrentTargetScreen();
    const sName = this.getScreenName(scr);
    const newRatio = this.screenManager.adjustMasterRatio(sName, delta);
    this.notify(`Screen: ${sName} | Ratio: ${Math.round(newRatio * 100)}%`);
    this.retile(scr);
  }

  public focusDirection(direction: Direction): void {
    const active = this.workspace.activeWindow;
    if (!active) return;

    const scr = this.getScreenForPos(active.frameGeometry);
    const sName = this.getScreenName(scr);
    const state = this.screenManager.getScreenState(sName);

    const activeId = this.getWindowId(active);
    const neighborId = findDirectionalNeighbor(activeId, direction, state.savedTiledGeometries);

    if (neighborId) {
      const targetWin = this.windowMap.get(neighborId);
      if (targetWin) {
        this.workspace.activeWindow = targetWin;
      }
    }
  }

  public toggleFloating(): void {
    const active = this.workspace.activeWindow;
    if (!active) return;

    const scr = this.getScreenForPos(active.frameGeometry);
    const sName = this.getScreenName(scr);
    const state = this.screenManager.getScreenState(sName);
    const wid = this.getWindowId(active);

    if (state.floatingWindows.has(wid)) {
      state.floatingWindows.delete(wid);
      this.notify("Window: Tiled");
    } else {
      state.floatingWindows.add(wid);
      this.notify("Window: Floating");
    }

    this.retile(scr);
  }

  public notify(message: string): void {
    if (!this.config.showOsd) return;
    if (typeof callDBus === "function") {
      callDBus(
        "org.kde.plasmashell",
        "/org/kde/osdService",
        "org.kde.osdService",
        "showText",
        "preferences-desktop-virtual",
        `Tessera: ${message}`
      );
    }
  }
}
