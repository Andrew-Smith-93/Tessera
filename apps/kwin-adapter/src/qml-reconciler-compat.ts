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
    desktopId: w.desktops && w.desktops.length > 0 ? String(w.desktops[0]) : "1",
    activityId: w.activities && w.activities.length > 0 ? String(w.activities[0]) : undefined,
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

export function toNormalizedScreen(scr: any, usableArea?: Rect): NormalizedScreenInput {
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
    usableArea: area
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
