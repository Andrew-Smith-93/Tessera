import { RuntimeCoordinator } from "./runtime-coordinator.js";
import type {
  CoordinatorConfig,
  NormalizedWindowInput,
  NormalizedScreenInput,
  NormalizedEvent,
  ReconciliationTransaction,
  CoordinatorDiagnostics,
  RetainedWindowState,
  RetainedScreenState
} from "./coordinator-types.js";
import {
  resolveScreenAffinity,
  resolveCursorTargetScreen,
  pointToRectDistance,
  rectIntersectionArea,
  rectContainsPoint,
  type ScreenAffinityInputs
} from "./screen-affinity.js";
import {
  computeSnapZones,
  matchSnapZoneHover,
  type SnapZoneTarget,
  type SnapZoneType,
  type SnapZoneId
} from "./snap-zones.js";

export type {
  CoordinatorConfig,
  NormalizedWindowInput,
  NormalizedScreenInput,
  NormalizedEvent,
  ReconciliationTransaction,
  CoordinatorDiagnostics,
  RetainedWindowState,
  RetainedScreenState,
  ScreenAffinityInputs,
  SnapZoneTarget,
  SnapZoneType,
  SnapZoneId
};
export {
  resolveScreenAffinity,
  resolveCursorTargetScreen,
  pointToRectDistance,
  rectIntersectionArea,
  rectContainsPoint,
  computeSnapZones,
  matchSnapZoneHover
};
import type { Rect, RuntimeWindowId } from "@tessera/protocol";

function stableObjectId(value: any, fallback: string = ""): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value.id !== undefined && value.id !== null) return String(value.id);
  if (value.name !== undefined && value.name !== null) return String(value.name);
  return fallback;
}

function finiteNumber(value: any): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeCommitGeometry(target: any, bounds?: Rect): Rect | null {
  if (!target) return null;
  const x = finiteNumber(target.x);
  const y = finiteNumber(target.y);
  const width = finiteNumber(target.width);
  const height = finiteNumber(target.height);
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }

  let normalized: Rect = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height))
  };
  if (![normalized.x, normalized.y, normalized.width, normalized.height].every(Number.isSafeInteger)) {
    return null;
  }

  if (bounds) {
    const boundX = finiteNumber(bounds.x);
    const boundY = finiteNumber(bounds.y);
    const boundWidth = finiteNumber(bounds.width);
    const boundHeight = finiteNumber(bounds.height);
    if (boundX === null || boundY === null || boundWidth === null || boundHeight === null ||
        boundWidth <= 0 || boundHeight <= 0) {
      return null;
    }
    const boundedWidth = Math.min(normalized.width, Math.round(boundWidth));
    const boundedHeight = Math.min(normalized.height, Math.round(boundHeight));
    const minX = Math.round(boundX);
    const minY = Math.round(boundY);
    const maxX = Math.round(boundX + boundWidth - boundedWidth);
    const maxY = Math.round(boundY + boundHeight - boundedHeight);
    normalized = {
      x: Math.max(minX, Math.min(maxX, normalized.x)),
      y: Math.max(minY, Math.min(maxY, normalized.y)),
      width: boundedWidth,
      height: boundedHeight
    };
  }

  return normalized;
}

export type CommitOutcome = "applied" | "unchanged-valid" | "rejected";

export interface CommitGeometryEvaluation {
  outcome: CommitOutcome;
  normalized: Rect | null;
}

export function evaluateCommitGeometry(
  win: { deleted?: boolean; managed?: boolean; frameGeometry?: Rect } | null | undefined,
  targetRect: any,
  bounds?: Rect
): CommitGeometryEvaluation {
  if (!win || win.deleted === true || win.managed === false || !win.frameGeometry || !targetRect) {
    return { outcome: "rejected", normalized: null };
  }

  const normalized = normalizeCommitGeometry(targetRect, bounds);
  if (!normalized) {
    return { outcome: "rejected", normalized: null };
  }

  const current = win.frameGeometry;
  if (
    current.x === normalized.x &&
    current.y === normalized.y &&
    current.width === normalized.width &&
    current.height === normalized.height
  ) {
    return { outcome: "unchanged-valid", normalized };
  }

  return { outcome: "applied", normalized };
}

export function toNormalizedWindow(w: any, screen?: any, usableArea?: Rect): NormalizedWindowInput {
  if (!w) return { id: "unknown", managed: false, normalWindow: false };

  const wid: RuntimeWindowId = w.internalId
    ? String(w.internalId)
    : (w.caption ? `${w.caption}_${w.resourceClass || ""}` : (w.id || "unknown"));

  return {
    id: wid,
    resourceClass: w.resourceClass ? String(w.resourceClass) : "",
    resourceName: w.resourceName ? String(w.resourceName) : "",
    appId: w.appId ? String(w.appId) : "",
    desktopFileName: w.desktopFileName ? String(w.desktopFileName) : "",
    title: w.caption ? String(w.caption) : (w.title ? String(w.title) : ""),
    role: w.windowRole ? String(w.windowRole) : "",
    outputId: screen?.name ? String(screen.name) : (w.output?.name ? String(w.output.name) : "default"),
    desktopId: w.desktops && w.desktops.length > 0 ? stableObjectId(w.desktops[0], "1") : stableObjectId(w.desktopId, "1"),
    desktopIds: Array.isArray(w.desktops) ? w.desktops.map((d: any) => stableObjectId(d)).filter(Boolean) : (w.desktopId ? [stableObjectId(w.desktopId)] : ["1"]),
    onAllDesktops: Boolean(w.onAllDesktops),
    activityId: w.activities && w.activities.length > 0 ? stableObjectId(w.activities[0]) : undefined,
    activities: Array.isArray(w.activities) ? w.activities.map((a: any) => stableObjectId(a)).filter(Boolean) : [],
    minimized: Boolean(w.minimized),
    fullScreen: Boolean(w.fullScreen),
    noBorder: Boolean(w.noBorder),
    maximizeMode: typeof w.maximizeMode === "number" ? w.maximizeMode : 0,
    frameGeometry: w.frameGeometry ? {
      x: Number(w.frameGeometry.x || 0),
      y: Number(w.frameGeometry.y || 0),
      width: Number(w.frameGeometry.width || 0),
      height: Number(w.frameGeometry.height || 0)
    } : undefined,
    outputGeometry: screen?.geometry ? {
      x: Number(screen.geometry.x || 0),
      y: Number(screen.geometry.y || 0),
      width: Number(screen.geometry.width || 0),
      height: Number(screen.geometry.height || 0)
    } : undefined,
    outputUsableArea: usableArea ? {
      x: Number(usableArea.x || 0),
      y: Number(usableArea.y || 0),
      width: Number(usableArea.width || 0),
      height: Number(usableArea.height || 0)
    } : undefined,
    managed: w.managed !== undefined ? Boolean(w.managed) : true,
    normalWindow: w.normalWindow !== undefined ? Boolean(w.normalWindow) : true,
    dialog: Boolean(w.dialog),
    transient: Boolean(w.transient),
    desktopWindow: Boolean(w.desktopWindow),
    dock: Boolean(w.dock),
    splash: Boolean(w.splash),
    notification: Boolean(w.notification),
    onScreenDisplay: Boolean(w.onScreenDisplay),
    popupMenu: Boolean(w.popupMenu),
    tooltip: Boolean(w.tooltip),
    specialWindow: Boolean(w.specialWindow),
    isManualFloating: Boolean(w.isManualFloating),
    isDragging: Boolean(w.isDragging),
    isPreTiled: Boolean(w.isPreTiled),
    outputAffinity: w.outputAffinity ? String(w.outputAffinity) : undefined
  };
}

export function toNormalizedScreen(
  scr: any,
  usableArea?: Rect,
  activeDesktop?: any,
  activeActivity?: any
): NormalizedScreenInput {
  const outputId = scr?.name ? String(scr.name) : "default";
  const geom: Rect = scr?.geometry ? {
    x: Number(scr.geometry.x || 0),
    y: Number(scr.geometry.y || 0),
    width: Number(scr.geometry.width || 0),
    height: Number(scr.geometry.height || 0)
  } : { x: 0, y: 0, width: 1920, height: 1080 };

  const area: Rect = usableArea ? {
    x: Number(usableArea.x || 0),
    y: Number(usableArea.y || 0),
    width: Number(usableArea.width || 0),
    height: Number(usableArea.height || 0)
  } : geom;

  return {
    outputId,
    name: scr?.name ? String(scr.name) : outputId,
    geometry: geom,
    usableArea: area,
    activeDesktopId: stableObjectId(activeDesktop, "1"),
    activeActivityId: activeActivity === undefined || activeActivity === null
      ? undefined
      : stableObjectId(activeActivity)
  };
}

let activeCoordinator: RuntimeCoordinator | null = null;

export function getOrCreateCoordinator(config?: Partial<CoordinatorConfig>): RuntimeCoordinator {
  if (!activeCoordinator) {
    activeCoordinator = new RuntimeCoordinator(config);
  } else if (config) {
    activeCoordinator.updateConfig(config);
  }
  return activeCoordinator;
}

export function createCoordinator(config?: Partial<CoordinatorConfig>): RuntimeCoordinator {
  return new RuntimeCoordinator(config);
}

export const ReconcilerBridge = {
  createCoordinator,
  getOrCreateCoordinator,
  toNormalizedWindow,
  toNormalizedScreen,
  normalizeCommitGeometry,
  evaluateCommitGeometry,
  resolveScreenAffinity,
  resolveCursorTargetScreen,
  computeSnapZones,
  matchSnapZoneHover,
  pointToRectDistance,
  rectIntersectionArea,
  rectContainsPoint,
  RuntimeCoordinator
};

// Export for global QML scope
(globalThis as unknown as { ReconcilerModule: typeof ReconcilerBridge }).ReconcilerModule = ReconcilerBridge;
(globalThis as unknown as { RuntimeCoordinator: typeof RuntimeCoordinator }).RuntimeCoordinator = RuntimeCoordinator;
