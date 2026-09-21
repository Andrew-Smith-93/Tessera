import type { Direction } from "./geometry.js";
import type { RuntimeWindowId } from "./identity.js";

export type LayoutAlgorithm =
  | "balanced-grid"
  | "master-stack"
  | "binary-split"
  | "columns"
  | "rows"
  | "monocle"
  | "floating";

export type DomainCommand =
  | { readonly cmd: "FocusDirection"; readonly direction: Direction }
  | { readonly cmd: "SwapDirection"; readonly direction: Direction }
  | { readonly cmd: "PromoteToMaster"; readonly windowId?: RuntimeWindowId }
  | { readonly cmd: "ToggleFloating"; readonly windowId?: RuntimeWindowId }
  | { readonly cmd: "AdjustSplitRatio"; readonly delta: number }
  | { readonly cmd: "SetMasterCount"; readonly count: number }
  | { readonly cmd: "SetLayout"; readonly layout: LayoutAlgorithm }
  | { readonly cmd: "SendToOutput"; readonly targetOutputId: string }
  | { readonly cmd: "SendToDesktop"; readonly targetDesktopId: string }
  | { readonly cmd: "Undo" }
  | { readonly cmd: "Redo" }
  | { readonly cmd: "SyncConfiguration"; readonly payloadToml: string }
  | { readonly cmd: "RequestStateSnapshot" };
