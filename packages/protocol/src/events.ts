import type { Rect } from "./geometry.js";
import type { RuntimeWindowId, LogicalWindowIdentity } from "./identity.js";
import type { LayoutAlgorithm } from "./commands.js";

export type DomainEvent =
  | { readonly type: "WindowDiscovered"; readonly windowId: RuntimeWindowId; readonly identity: LogicalWindowIdentity; readonly rect: Rect }
  | { readonly type: "WindowDestroyed"; readonly windowId: RuntimeWindowId }
  | { readonly type: "WindowFocusShifted"; readonly previous: RuntimeWindowId | null; readonly current: RuntimeWindowId }
  | { readonly type: "WindowMovedOutput"; readonly windowId: RuntimeWindowId; readonly fromOutput: string; readonly toOutput: string }
  | { readonly type: "WindowMovedDesktop"; readonly windowId: RuntimeWindowId; readonly fromDesktop: string; readonly toDesktop: string }
  | { readonly type: "InteractiveResizeActive"; readonly windowId: RuntimeWindowId; readonly deltaRect: Rect }
  | { readonly type: "InteractiveResizeCommitted"; readonly windowId: RuntimeWindowId }
  | { readonly type: "OutputTopologyAdjusted"; readonly outputs: readonly { id: string; rect: Rect }[] }
  | { readonly type: "UsableAreaContracted"; readonly outputId: string; readonly desktopId: string; readonly usableArea: Rect }
  | { readonly type: "LayoutChanged"; readonly outputId: string; readonly desktopId: string; readonly layout: LayoutAlgorithm }
  | { readonly type: "DaemonConnected" }
  | { readonly type: "DaemonDisconnected" };
