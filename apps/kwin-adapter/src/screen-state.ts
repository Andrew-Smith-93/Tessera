import type { LayoutAlgorithm, Rect, RuntimeWindowId, GapConfig } from "@tessera/protocol";
import type { LayoutNode } from "@tessera/layout-core";

export interface ScreenState {
  readonly screenName: string;
  activeLayout: LayoutAlgorithm;
  masterCount: number;
  masterRatio: number;
  gaps: GapConfig;
  treeRoot: LayoutNode | null;
  persistentOrder: RuntimeWindowId[];
  readonly savedTiledGeometries: Map<RuntimeWindowId, Rect>;
  readonly savedMinimGeometries: Map<RuntimeWindowId, Rect>;
  readonly floatingWindows: Set<RuntimeWindowId>;
}

export const SUPPORTED_LAYOUTS: readonly LayoutAlgorithm[] = Object.freeze([
  "master-stack",
  "balanced-grid",
  "binary-split",
  "columns",
  "rows",
  "monocle",
  "floating"
]);

export class ScreenStateManager {
  private readonly states = new Map<string, ScreenState>();
  private readonly defaultLayout: LayoutAlgorithm;
  private readonly defaultMasterCount: number;
  private readonly defaultMasterRatio: number;
  private readonly defaultGaps: GapConfig;

  constructor(
    defaultLayout: LayoutAlgorithm = "master-stack",
    defaultMasterCount: number = 1,
    defaultMasterRatio: number = 0.50,
    defaultGaps: GapConfig = { inner: 8, outer: 10 }
  ) {
    this.defaultLayout = defaultLayout;
    this.defaultMasterCount = defaultMasterCount;
    this.defaultMasterRatio = defaultMasterRatio;
    this.defaultGaps = defaultGaps;
  }

  public getScreenState(screenName: string): ScreenState {
    const key = screenName || "default";
    let state = this.states.get(key);
    if (!state) {
      state = {
        screenName: key,
        activeLayout: this.defaultLayout,
        masterCount: this.defaultMasterCount,
        masterRatio: this.defaultMasterRatio,
        gaps: { ...this.defaultGaps },
        treeRoot: null,
        persistentOrder: [],
        savedTiledGeometries: new Map(),
        savedMinimGeometries: new Map(),
        floatingWindows: new Set(),
      };
      this.states.set(key, state);
    }
    return state;
  }

  /**
   * Adjusts master count on the given screen only.
   * Returns the new master count for that screen.
   */
  public adjustMasterCount(screenName: string, delta: number): number {
    const state = this.getScreenState(screenName);
    state.masterCount = Math.max(0, state.masterCount + delta);
    return state.masterCount;
  }

  /**
   * Adjusts master ratio on the given screen only.
   */
  public adjustMasterRatio(screenName: string, delta: number): number {
    const state = this.getScreenState(screenName);
    state.masterRatio = Math.max(0.10, Math.min(0.90, state.masterRatio + delta));
    return state.masterRatio;
  }

  /**
   * Cycles layout algorithm for the specified screen only.
   */
  public cycleLayout(screenName: string, forward: boolean = true): LayoutAlgorithm {
    const state = this.getScreenState(screenName);
    const currentIndex = SUPPORTED_LAYOUTS.indexOf(state.activeLayout);
    const len = SUPPORTED_LAYOUTS.length;
    let nextIndex = currentIndex === -1 ? 0 : currentIndex + (forward ? 1 : -1);
    if (nextIndex >= len) nextIndex = 0;
    if (nextIndex < 0) nextIndex = len - 1;

    state.activeLayout = SUPPORTED_LAYOUTS[nextIndex];
    return state.activeLayout;
  }

  /**
   * Sets active layout algorithm on the specified screen only.
   */
  public setLayout(screenName: string, layout: LayoutAlgorithm): void {
    const state = this.getScreenState(screenName);
    state.activeLayout = layout;
  }

  /**
   * Cleans up windows that have been closed across all screen states.
   */
  public removeWindowGlobally(windowId: RuntimeWindowId): void {
    for (const state of this.states.values()) {
      const idx = state.persistentOrder.indexOf(windowId);
      if (idx !== -1) {
        state.persistentOrder.splice(idx, 1);
      }
      state.savedTiledGeometries.delete(windowId);
      state.savedMinimGeometries.delete(windowId);
      state.floatingWindows.delete(windowId);
    }
  }
}
