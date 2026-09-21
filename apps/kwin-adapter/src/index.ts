import { TilingEngine, type EngineConfig } from "./tiling-engine.js";
import { registerShortcuts } from "./shortcuts.js";
import type { LayoutAlgorithm } from "@tessera/protocol";

export { RuntimeCoordinator } from "./runtime-coordinator.js";
export { ReconcilerBridge, createCoordinator, getOrCreateCoordinator, toNormalizedWindow, toNormalizedScreen } from "./qml-reconciler-compat.js";
export * from "./coordinator-types.js";

export function initTessera(): TilingEngine {
  const readStr = (key: string, def: string) => String(KWin.readConfig(key, def));
  const readNum = (key: string, def: number) => Number(KWin.readConfig(key, def));
  const readBool = (key: string, def: boolean) => Boolean(KWin.readConfig(key, def));

  const config: EngineConfig = {
    enableTiling: readBool("enableTiling", true),
    defaultLayout: (readStr("defaultLayout", "master-stack") as LayoutAlgorithm),
    gapInner: readNum("gapInner", 8),
    gapOuter: readNum("gapOuter", 10),
    masterRatio: readNum("masterRatio", 0.50),
    masterCount: readNum("masterCount", 1),
    ignoreMinimized: readBool("ignoreMinimized", true),
    showOsd: readBool("showOsd", true),
    userFilterPatterns: readStr("floatFilter", "").split(","),
  };

  const engine = new TilingEngine(workspace, config);

  // Hook all existing windows in the current stacking order
  const existingWins = workspace.stackingOrder || [];
  for (const win of existingWins) {
    engine.hookWindow(win);
  }

  // Workspace signals
  workspace.windowAdded.connect((win) => {
    engine.hookWindow(win);
    engine.retile();
  });

  workspace.windowRemoved.connect(() => {
    // Retile to fill vacated slot
    engine.retile();
  });

  workspace.currentDesktopChanged.connect(() => {
    engine.retile();
  });

  workspace.screensChanged.connect(() => {
    engine.retile();
  });

  // Options config changed (e.g. reconfigure via qdbus)
  if (typeof options !== "undefined" && options.configChanged) {
    options.configChanged.connect(() => {
      engine.retile();
    });
  }

  // Register user shortcuts
  registerShortcuts(KWin, engine);

  // Initial retile
  engine.retile();

  print("[Tessera] Monorepo KWin Adapter 2.0 initialized successfully.");
  return engine;
}

// Auto-run if running inside KWin script host
if (typeof workspace !== "undefined" && typeof KWin !== "undefined") {
  initTessera();
}
