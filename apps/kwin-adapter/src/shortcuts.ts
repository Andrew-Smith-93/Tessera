import type { KWinGlobal } from "./kwin-api.js";
import type { TilingEngine } from "./tiling-engine.js";

export function registerShortcuts(kwin: KWinGlobal, engine: TilingEngine): void {
  // Cycle Layout on active screen
  kwin.registerShortcut(
    "Tessera: Cycle Layout Forward",
    "Cycle forward through layout algorithms on active screen",
    "Meta+Space",
    () => engine.cycleCurrentScreenLayout(true)
  );

  kwin.registerShortcut(
    "Tessera: Cycle Layout Backward",
    "Cycle backward through layout algorithms on active screen",
    "Meta+Shift+Space",
    () => engine.cycleCurrentScreenLayout(false)
  );

  // Master count adjustments (active screen only)
  kwin.registerShortcut(
    "Tessera: Increase Master Count",
    "Add one master window slot to active screen",
    "Meta+]",
    () => engine.adjustCurrentScreenMasterCount(1)
  );

  kwin.registerShortcut(
    "Tessera: Decrease Master Count",
    "Remove one master window slot from active screen",
    "Meta+[",
    () => engine.adjustCurrentScreenMasterCount(-1)
  );

  // Master ratio adjustments
  kwin.registerShortcut(
    "Tessera: Expand Master Area",
    "Increase master pane width ratio on active screen",
    "Meta+L",
    () => engine.adjustCurrentScreenMasterRatio(0.05)
  );

  kwin.registerShortcut(
    "Tessera: Shrink Master Area",
    "Decrease master pane width ratio on active screen",
    "Meta+H",
    () => engine.adjustCurrentScreenMasterRatio(-0.05)
  );

  // Directional Focus
  kwin.registerShortcut(
    "Tessera: Focus Left",
    "Focus window to the left",
    "Meta+Left",
    () => engine.focusDirection("left")
  );

  kwin.registerShortcut(
    "Tessera: Focus Right",
    "Focus window to the right",
    "Meta+Right",
    () => engine.focusDirection("right")
  );

  kwin.registerShortcut(
    "Tessera: Focus Up",
    "Focus window above",
    "Meta+Up",
    () => engine.focusDirection("up")
  );

  kwin.registerShortcut(
    "Tessera: Focus Down",
    "Focus window below",
    "Meta+Down",
    () => engine.focusDirection("down")
  );

  // Toggle float
  kwin.registerShortcut(
    "Tessera: Toggle Floating",
    "Toggle active window between floating and tiled mode",
    "Meta+F",
    () => engine.toggleFloating()
  );
}
