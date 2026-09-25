import { describe, it, expect } from "vitest";
import { resolveRegionTransition, type SnapZoneId } from "../src/snap-zones.js";
import { RuntimeCoordinator, LogicalClock } from "../src/index.js";
import { evaluateCommitGeometry, toNormalizedWindow, toNormalizedScreen } from "../src/qml-reconciler-compat.js";
import type { NormalizedScreenInput } from "../src/coordinator-types.js";
import type { Rect } from "@tessera/protocol";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";

const QML_PATH = path.resolve(__dirname, "../../../contents/ui/main.qml");
const qmlSource = fs.readFileSync(QML_PATH, "utf8");

function extractFunction(source: string, name: string): string {
  const start = source.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Missing production function in main.qml: " + name);
  const brace = source.indexOf("{", start);
  let depth = 1, end = brace + 1;
  for (; depth && end < source.length; end++) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
  }
  return source.slice(start, end);
}

const SCREEN_1: NormalizedScreenInput = {
  outputId: "HDMI-A-1",
  name: "HDMI-A-1",
  geometry: { x: 0, y: 0, width: 1920, height: 1080 },
  usableArea: { x: 0, y: 0, width: 1920, height: 1080 },
  activeDesktopId: "1"
};

const SCREEN_2: NormalizedScreenInput = {
  outputId: "DP-1",
  name: "DP-1",
  geometry: { x: 1920, y: 0, width: 1920, height: 1080 },
  usableArea: { x: 1920, y: 0, width: 1920, height: 1080 },
  activeDesktopId: "1"
};

const SCREEN_3: NormalizedScreenInput = {
  outputId: "DP-2",
  name: "DP-2",
  geometry: { x: 3840, y: 0, width: 1920, height: 1080 },
  usableArea: { x: 3840, y: 0, width: 1920, height: 1080 },
  activeDesktopId: "1"
};

interface MockWindow {
  internalId: string;
  managed: boolean;
  normalWindow: boolean;
  deleted: boolean;
  minimized: boolean;
  fullScreen: boolean;
  maximizeMode: number;
  noBorder: boolean;
  moveResized: boolean;
  output: any;
  _geometry: Rect;
  frameGeometry: Rect;
  _targetOutputName?: string | null;
  throwOnSetter?: boolean;
  clampMinSize?: { width: number; height: number };
}

function createMockWindow(id: string, initialGeom: Rect, initialScreen: any = SCREEN_1): MockWindow {
  return {
    internalId: id,
    managed: true,
    normalWindow: true,
    deleted: false,
    minimized: false,
    fullScreen: false,
    maximizeMode: 0,
    noBorder: false,
    moveResized: false,
    output: initialScreen,
    _geometry: { ...initialGeom },
    get frameGeometry() {
      return { ...this._geometry };
    },
    set frameGeometry(r: Rect) {
      if (this.throwOnSetter) {
        throw new Error("KWin frameGeometry setter rejected write");
      }
      let w = r.width;
      let h = r.height;
      if (this.clampMinSize) {
        w = Math.max(w, this.clampMinSize.width);
        h = Math.max(h, this.clampMinSize.height);
      }
      this._geometry = { x: r.x, y: r.y, width: w, height: h };
    }
  };
}

interface TestVMEnvironment {
  ctx: any;
  coordinator: RuntimeCoordinator;
  clock: LogicalClock;
  scheduledReconciles: string[];
  osdNotifications: { text: string; icon?: string }[];
  cancelledAnimations: { wid: string; clearCommand: boolean }[];
}

function setupVMEnvironment(opts: { enableAnimations?: boolean; animationDurationMs?: number } = {}): TestVMEnvironment {
  const clock = new LogicalClock(0);
  const coordinator = new RuntimeCoordinator(
    {
      enableTiling: true,
      defaultLayout: "balanced-grid",
      gapInner: 8,
      gapOuter: 10,
      primaryRegionRatio: 0.50,
      primaryRegionCount: 1,
      geometryTolerancePx: 1
    },
    clock
  );
  coordinator.getOrCreateScreen(SCREEN_1);
  coordinator.getOrCreateScreen(SCREEN_2);

  const scheduledReconciles: string[] = [];
  const osdNotifications: { text: string; icon?: string }[] = [];
  const cancelledAnimations: { wid: string; clearCommand: boolean }[] = [];
  const savedTiledGeometries: Record<string, Rect> = {};
  let timerRunning = false;

  const animTimer = {
    get running() { return timerRunning; },
    start() { timerRunning = true; },
    stop() { timerRunning = false; }
  };

  const config = {
    enableTiling: true,
    enableAnimations: opts.enableAnimations ?? false,
    animationDurationMs: opts.animationDurationMs ?? 0,
    gapInner: 8,
    gapOuter: 10,
    defaultLayout: "balanced-grid"
  };

  const ctx: any = {
    Date: { now: () => clock.now() },
    Math,
    root: { config, coordinator },
    coordinator,
    isArranging: false,
    config,
    currentDraggingWindow: null,
    activeAnimations: {},
    activeCount: 0,
    animTimer,
    isAnimating: function(wid: string) { return !!this.activeAnimations[wid]; },
    Workspace: {
      screens: [SCREEN_1, SCREEN_2],
      activeScreen: SCREEN_1,
      activeWindow: null as any,
      stackingOrder: [] as any[],
      currentDesktop: { id: "1" },
      currentActivity: "default",
      clientArea: (_areaType: any, screen: any, _desktop: any) => {
        return screen?.usableArea || screen?.geometry || { x: 0, y: 0, width: 1920, height: 1080 };
      }
    },
    KWin: {
      MaximizeArea: 1
    },
    ReconcilerModule: {
      ReconcilerBridge: {
        evaluateCommitGeometry: (w: any, target: Rect, bounds: Rect) => evaluateCommitGeometry(w, target, bounds),
        toNormalizedWindow: (w: any, screen: any, area: Rect) => toNormalizedWindow(w, screen, area),
        toNormalizedScreen: (s: any, area: Rect, d: any, a: any) => toNormalizedScreen(s, area, d, a),
        resolveRegionTransition: (reg: string, dir: string) => resolveRegionTransition(reg, dir as any)
      }
    },
    getWindowId: (w: any) => w.internalId,
    getScreenName: (s: any) => s?.name || s?.outputId || "",
    getScreenForPos: (pos: Rect) => {
      if (!pos) return SCREEN_1;
      const screens = ctx.Workspace.screens || [];
      for (const s of screens) {
        if (
          pos.x >= s.geometry.x &&
          pos.x < s.geometry.x + s.geometry.width &&
          pos.y >= s.geometry.y &&
          pos.y < s.geometry.y + s.geometry.height
        ) {
          return s;
        }
      }
      return screens[0] || SCREEN_1;
    },
    getCurrentDesktopKey: () => "1",
    getCoordinator: () => coordinator,
    Qt: {
      rect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
    },
    scheduleReconcile: (reason: string) => scheduledReconciles.push(reason),
    osdCall: {
      notify: (text: string, icon?: string) => osdNotifications.push({ text, icon })
    },
    log: () => {},
    setPreMinimizeGeometry: () => {},
    getSavedTiledGeometry: (wid: string) => savedTiledGeometries[wid] || null,
    setSavedTiledGeometry: (wid: string, geom: Rect) => { savedTiledGeometries[wid] = geom; },
    reconcileTimer: {
      running: false,
      stop: () => {}
    },
    checkFilter: () => true
  };

  ctx.windowAnimator = ctx;
  vm.createContext(ctx);

  const functionNames = [
    "cancelAnimation",
    "cancelAllAnimations",
    "cancelInvalidAnimations",
    "easeOutCubic",
    "animateWindow",
    "step",
    "getScreenByName",
    "resolveRegionTransition",
    "findTargetScreenInDirection",
    "synchronizeScreenTopology",
    "commitWindowGeometry",
    "performReconciliation",
    "retileNow",
    "moveWindowInDirection",
    "moveWindowToNextScreen",
    "moveActiveWindowToRegion",
    "resizeActiveWindow"
  ];

  for (const fn of functionNames) {
    const code = extractFunction(qmlSource, fn);
    vm.runInContext(code, ctx);
  }

  // Wrap cancelAnimation to track calls
  const origCancel = ctx.cancelAnimation;
  ctx.cancelAnimation = function(wid: string, clearCmd: boolean) {
    cancelledAnimations.push({ wid, clearCommand: clearCmd });
    return origCancel.call(ctx, wid, clearCmd);
  };

  return { ctx, coordinator, clock, scheduledReconciles, osdNotifications, cancelledAnimations };
}

describe("Keyboard Spatial Navigation: Deterministic Region Transitions", () => {
  const ALL_REGIONS: SnapZoneId[] = [
    "maximize",
    "left-half",
    "right-half",
    "top-left",
    "bottom-left",
    "top-right",
    "bottom-right",
    "left-pillar",
    "center-pillar",
    "center-top",
    "center-bottom",
    "right-pillar"
  ];

  it("regression: full center-pillar accesses center-top and center-bottom splits", () => {
    expect(resolveRegionTransition("center-pillar", "up")).toBe("center-top");
    expect(resolveRegionTransition("center-pillar", "down")).toBe("center-bottom");
  });

  it("regression: repeated vertical inputs on boundaries never jump columns horizontally", () => {
    // Top boundary
    expect(resolveRegionTransition("top-left", "up")).toBe("top-left");
    expect(resolveRegionTransition("center-top", "up")).toBe("center-top");
    expect(resolveRegionTransition("top-right", "up")).toBe("top-right");
    expect(resolveRegionTransition("right-pillar", "up")).toBe("top-right");
    expect(resolveRegionTransition("left-pillar", "up")).toBe("top-left");

    // Bottom boundary
    expect(resolveRegionTransition("bottom-left", "down")).toBe("bottom-left");
    expect(resolveRegionTransition("center-bottom", "down")).toBe("center-bottom");
    expect(resolveRegionTransition("bottom-right", "down")).toBe("bottom-right");
    expect(resolveRegionTransition("right-pillar", "down")).toBe("bottom-right");
    expect(resolveRegionTransition("left-pillar", "down")).toBe("bottom-left");
  });

  it("regression: repeated horizontal inputs on boundaries stay at current edge", () => {
    // Left boundary
    expect(resolveRegionTransition("left-half", "left")).toBe("left-half");
    expect(resolveRegionTransition("left-pillar", "left")).toBe("left-pillar");
    expect(resolveRegionTransition("top-left", "left")).toBe("top-left");
    expect(resolveRegionTransition("bottom-left", "left")).toBe("bottom-left");

    // Right boundary
    expect(resolveRegionTransition("right-half", "right")).toBe("right-half");
    expect(resolveRegionTransition("right-pillar", "right")).toBe("right-pillar");
    expect(resolveRegionTransition("top-right", "right")).toBe("top-right");
    expect(resolveRegionTransition("bottom-right", "right")).toBe("bottom-right");
  });

  it("symmetric reversals: opposite directions invert transitions across splits and pillars", () => {
    expect(resolveRegionTransition("center-top", "down")).toBe("center-bottom");
    expect(resolveRegionTransition("center-bottom", "up")).toBe("center-top");
    expect(resolveRegionTransition("top-left", "down")).toBe("bottom-left");
    expect(resolveRegionTransition("bottom-left", "up")).toBe("top-left");
    expect(resolveRegionTransition("top-right", "down")).toBe("bottom-right");
    expect(resolveRegionTransition("bottom-right", "up")).toBe("top-right");
    expect(resolveRegionTransition("left-pillar", "right")).toBe("center-pillar");
    expect(resolveRegionTransition("center-pillar", "left")).toBe("left-pillar");
    expect(resolveRegionTransition("center-pillar", "right")).toBe("right-pillar");
    expect(resolveRegionTransition("right-pillar", "left")).toBe("center-pillar");
    expect(resolveRegionTransition("left-half", "right")).toBe("right-half");
    expect(resolveRegionTransition("right-half", "left")).toBe("left-half");
  });

  it("covers every region across all four directions deterministically", () => {
    const directions = ["up", "down", "left", "right"] as const;
    for (const region of ALL_REGIONS) {
      for (const dir of directions) {
        const next = resolveRegionTransition(region, dir);
        expect(ALL_REGIONS).toContain(next);
      }
    }
  });

  it("shipped reconciler.js bundle exposes resolveRegionTransition with identical semantics", () => {
    const reconcilerPath = path.resolve(__dirname, "../../../contents/code/reconciler.js");
    const bundleCode = fs.readFileSync(reconcilerPath, "utf-8");
    const sandbox: Record<string, any> = {
      globalThis: {},
      console,
      setTimeout,
      clearTimeout
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(bundleCode, sandbox);

    const bridge = sandbox.ReconcilerModule?.ReconcilerBridge || sandbox.ReconcilerBridge;
    expect(bridge).toBeDefined();
    expect(typeof bridge.resolveRegionTransition).toBe("function");

    expect(bridge.resolveRegionTransition("center-pillar", "up")).toBe("center-top");
    expect(bridge.resolveRegionTransition("center-pillar", "down")).toBe("center-bottom");
    expect(bridge.resolveRegionTransition("top-right", "up")).toBe("top-right");
    expect(bridge.resolveRegionTransition("right-pillar", "up")).toBe("top-right");
    expect(bridge.resolveRegionTransition("center-top", "up")).toBe("center-top");
  });
});

describe("Production QML Keyboard Screen Movement & Affinity", () => {
  it("production moveWindowInDirection moves window and survives reconciliation with stale compositor output", () => {
    const env = setupVMEnvironment();
    const win = createMockWindow("win-1", { x: 10, y: 10, width: 946, height: 1060 }, SCREEN_1);
    env.ctx.Workspace.activeWindow = win;
    env.ctx.Workspace.stackingOrder = [win];

    env.ctx.performReconciliation();
    expect(env.coordinator.getRetainedWindow("win-1")?.outputId).toBe("HDMI-A-1");

    // Execute actual production moveWindowInDirection("right")
    env.ctx.moveWindowInDirection("right");

    expect(env.osdNotifications.some(n => n.text.includes("Window Moved to DP-1"))).toBe(true);
    expect(win._targetOutputName).toBe("DP-1");
    expect(win.frameGeometry.x).toBeGreaterThanOrEqual(1920);

    // CRITICAL: Compositor output is STALE (still SCREEN_1).
    expect(win.output).toBe(SCREEN_1);
    env.ctx.performReconciliation();

    // Assert that the window survives reconciliation on DP-1 and is NOT snapped back to HDMI-A-1
    const retained = env.coordinator.getRetainedWindow("win-1");
    expect(retained).toBeDefined();
    expect(retained?.outputId).toBe("DP-1");
    expect(win.frameGeometry.x).toBeGreaterThanOrEqual(1920);

    // Compositor catches up:
    win.output = SCREEN_2;
    if (win._targetOutputName && env.ctx.getScreenName(win.output) === win._targetOutputName) {
      win._targetOutputName = null;
    }
    expect(win._targetOutputName).toBeNull();

    env.ctx.performReconciliation();
    expect(env.coordinator.getRetainedWindow("win-1")?.outputId).toBe("DP-1");
  });

  it("production moveWindowInDirection rolls back target marker and workspace membership on rejected commit", () => {
    const env = setupVMEnvironment();
    const win = createMockWindow("win-1", { x: 10, y: 10, width: 946, height: 1060 }, SCREEN_1);
    env.ctx.Workspace.activeWindow = win;
    env.ctx.Workspace.stackingOrder = [win];

    env.ctx.performReconciliation();
    expect(env.coordinator.getRetainedWindow("win-1")?.outputId).toBe("HDMI-A-1");

    win.throwOnSetter = true;

    env.ctx.moveWindowInDirection("right");

    expect(win._targetOutputName).toBeNull();
    const retained = env.coordinator.getRetainedWindow("win-1");
    expect(retained?.outputId).toBe("HDMI-A-1");
  });

  it("rapid successive monitor inputs advance across screens using target affinity", () => {
    const env = setupVMEnvironment();
    env.ctx.Workspace.screens = [SCREEN_1, SCREEN_2, SCREEN_3];
    env.coordinator.getOrCreateScreen(SCREEN_3);

    const win = createMockWindow("win-1", { x: 10, y: 10, width: 946, height: 1060 }, SCREEN_1);
    env.ctx.Workspace.activeWindow = win;
    env.ctx.Workspace.stackingOrder = [win];

    env.ctx.performReconciliation();

    // 1st press: Move Right -> targets SCREEN_2 ("DP-1")
    env.ctx.moveWindowInDirection("right");
    expect(win._targetOutputName).toBe("DP-1");

    // Stale compositor output remains SCREEN_1
    expect(win.output).toBe(SCREEN_1);

    // 2nd press immediately: Move Right -> reads target affinity ("DP-1") and targets SCREEN_3 ("DP-2")
    env.ctx.moveWindowInDirection("right");
    expect(win._targetOutputName).toBe("DP-2");
    expect(win.frameGeometry.x).toBeGreaterThanOrEqual(3840);

    // Reconcile with stale output: retains on final target DP-2
    env.ctx.performReconciliation();
    expect(env.coordinator.getRetainedWindow("win-1")?.outputId).toBe("DP-2");
  });

  it("destination removal cleans up target marker safely in performReconciliation", () => {
    const env = setupVMEnvironment();
    const win = createMockWindow("win-1", { x: 10, y: 10, width: 946, height: 1060 }, SCREEN_1);
    env.ctx.Workspace.activeWindow = win;
    env.ctx.Workspace.stackingOrder = [win];

    env.ctx.performReconciliation();

    // Simulate target marker pointing to a removed/disconnected screen
    win._targetOutputName = "REMOVED_OUTPUT";
    env.ctx.Workspace.screens = [SCREEN_1];

    env.ctx.performReconciliation();
    expect(win._targetOutputName).toBeNull();
    expect(env.coordinator.getRetainedWindow("win-1")?.outputId).toBe("HDMI-A-1");
  });

  it("pending animation is cancelled before initiating monitor move", () => {
    const env = setupVMEnvironment({ enableAnimations: true, animationDurationMs: 200 });
    const win = createMockWindow("win-1", { x: 10, y: 10, width: 946, height: 1060 }, SCREEN_1);
    env.ctx.Workspace.activeWindow = win;
    env.ctx.Workspace.stackingOrder = [win];

    env.ctx.performReconciliation();

    // Start an active animation
    env.ctx.animateWindow(win, { x: 50, y: 50, width: 900, height: 1000 }, 1, 200);
    expect(env.ctx.isAnimating("win-1")).toBe(true);

    // Moving window in direction must cancel the active animation
    env.ctx.moveWindowInDirection("right");
    expect(env.cancelledAnimations.some(a => a.wid === "win-1" && a.clearCommand === true)).toBe(true);
  });

  it("clamps oversized window dimensions when moving across screens", () => {
    const env = setupVMEnvironment();
    const win = createMockWindow("win-1", { x: 0, y: 0, width: 2500, height: 1500 }, SCREEN_1);
    env.ctx.Workspace.activeWindow = win;
    env.ctx.Workspace.stackingOrder = [win];

    env.ctx.moveWindowInDirection("right");
    expect(win.frameGeometry.width).toBeLessThanOrEqual(1900);
    expect(win.frameGeometry.height).toBeLessThanOrEqual(1060);
  });
});

describe("Animator Lifecycle: Deferred Setter Rejection and Clamping Coverage", () => {
  it("deferred setter rejection after commit returned applied clears command and cancels animation", () => {
    const env = setupVMEnvironment({ enableAnimations: true, animationDurationMs: 180 });
    const win = createMockWindow("win-1", { x: 10, y: 10, width: 400, height: 300 }, SCREEN_1);
    env.ctx.Workspace.activeWindow = win;
    env.ctx.Workspace.stackingOrder = [win];

    env.coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: {
        id: "win-1",
        resourceClass: "app",
        resourceName: "app",
        title: "App",
        outputId: "HDMI-A-1",
        frameGeometry: { x: 10, y: 10, width: 400, height: 300 },
        managed: true,
        normalWindow: true
      }
    });

    const commitRes = env.ctx.commitWindowGeometry(win, { x: 200, y: 200, width: 600, height: 500 }, "test", 1);
    expect(commitRes.outcome).toBe("applied");
    expect(env.coordinator.hasRecordedCommand("win-1")).toBe(true);
    expect(env.ctx.isAnimating("win-1")).toBe(true);

    // Now setter starts throwing during animation step (deferred failure)
    win.throwOnSetter = true;
    env.clock.advance(100);
    env.ctx.step();

    // Animation cancelled and command cleared
    expect(env.ctx.isAnimating("win-1")).toBe(false);
    expect(env.coordinator.hasRecordedCommand("win-1")).toBe(false);
  });

  it("deferred clamp after commit returned applied ingests WindowGeometryChanged and schedules reconcile", () => {
    const env = setupVMEnvironment({ enableAnimations: true, animationDurationMs: 180 });
    const win = createMockWindow("win-1", { x: 10, y: 10, width: 400, height: 300 }, SCREEN_1);
    // KWin client enforces min size of 500x400
    win.clampMinSize = { width: 500, height: 400 };

    env.ctx.Workspace.activeWindow = win;
    env.ctx.Workspace.stackingOrder = [win];

    env.coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: {
        id: "win-1",
        resourceClass: "app",
        resourceName: "app",
        title: "App",
        outputId: "HDMI-A-1",
        frameGeometry: { x: 10, y: 10, width: 400, height: 300 },
        managed: true,
        normalWindow: true
      }
    });

    // Commit targets a smaller size 300x250
    const commitRes = env.ctx.commitWindowGeometry(win, { x: 50, y: 50, width: 300, height: 250 }, "test", 1);
    expect(commitRes.outcome).toBe("applied");

    // Advance to animation completion
    env.clock.advance(200);
    env.ctx.step();

    // Command was cleared because observed geometry was clamped
    expect(env.coordinator.hasRecordedCommand("win-1")).toBe(false);
    expect(env.scheduledReconciles).toContain("WindowGeometryClamped");

    // Window frameGeometry matches clamp constraint
    expect(win.frameGeometry.width).toBe(500);
    expect(win.frameGeometry.height).toBe(400);

    // Running performReconciliation adapts coordinator to clamped geometry
    env.ctx.performReconciliation();
    const retained = env.coordinator.getRetainedWindow("win-1");
    expect(retained?.frameGeometry.width).toBe(500);
    expect(retained?.frameGeometry.height).toBe(400);
  });

  it("cancellation on window state changes drops active animation without applying superseded target", () => {
    const env = setupVMEnvironment({ enableAnimations: true, animationDurationMs: 180 });
    const win = createMockWindow("win-1", { x: 10, y: 10, width: 400, height: 300 }, SCREEN_1);
    env.ctx.Workspace.activeWindow = win;
    env.ctx.Workspace.stackingOrder = [win];

    env.coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: {
        id: "win-1",
        resourceClass: "app",
        resourceName: "app",
        title: "App",
        outputId: "HDMI-A-1",
        frameGeometry: { x: 10, y: 10, width: 400, height: 300 },
        managed: true,
        normalWindow: true
      }
    });

    env.ctx.commitWindowGeometry(win, { x: 200, y: 200, width: 600, height: 500 }, "test", 1);
    expect(env.ctx.isAnimating("win-1")).toBe(true);

    // User minimizes window during animation
    win.minimized = true;
    env.clock.advance(200);
    env.ctx.step();

    // Animation ended without writing final target
    expect(env.ctx.isAnimating("win-1")).toBe(false);
    expect(win.frameGeometry.x).not.toBe(200);
  });

  it("deferred setter rejection during cross-monitor animation clears target marker and restores observed membership", () => {
    const env = setupVMEnvironment({ enableAnimations: true, animationDurationMs: 200 });
    const win = createMockWindow("win-1", { x: 10, y: 10, width: 946, height: 1060 }, SCREEN_1);
    env.ctx.Workspace.activeWindow = win;
    env.ctx.Workspace.stackingOrder = [win];

    env.ctx.performReconciliation();
    expect(env.coordinator.getRetainedWindow("win-1")?.outputId).toBe("HDMI-A-1");

    // Initiate cross-monitor move with animations enabled
    env.ctx.moveWindowInDirection("right");
    expect(win._targetOutputName).toBe("DP-1");
    expect(env.ctx.isAnimating("win-1")).toBe(true);

    // Setter throws on intermediate step (e.g. KWin rejection while in flight)
    win.throwOnSetter = true;
    env.clock.advance(100);
    env.ctx.step();

    // Animation stopped
    expect(env.ctx.activeCount).toBe(0);
    expect(env.ctx.isAnimating("win-1")).toBe(false);

    // Crucial: targetOutputName must be cleared and coordinator output restored to observed SCREEN_1
    expect(win._targetOutputName).toBeNull();
    expect(win.frameGeometry.x).toBe(10); // Window remains on source screen

    // performReconciliation does not override observed output with stale destination
    env.ctx.performReconciliation();
    const retained = env.coordinator.getRetainedWindow("win-1");
    expect(retained?.outputId).toBe("HDMI-A-1");
  });
});

describe("Production QML Keyboard Window Resizing", () => {
  it("production resizeActiveWindow persists custom geometry across reconciliation cycles", () => {
    const env = setupVMEnvironment();
    const win1 = createMockWindow("win-1", { x: 10, y: 10, width: 946, height: 1060 }, SCREEN_1);
    const win2 = createMockWindow("win-2", { x: 964, y: 10, width: 946, height: 1060 }, SCREEN_1);
    env.ctx.Workspace.activeWindow = win1;
    env.ctx.Workspace.stackingOrder = [win1, win2];

    env.ctx.performReconciliation();
    expect(win1.frameGeometry.width).toBe(946);

    // Execute actual production resizeActiveWindow(-100, 0)
    env.ctx.resizeActiveWindow(-100, 0);

    expect(win1.frameGeometry.width).toBe(846);

    const retained = env.coordinator.getRetainedWindow("win-1");
    expect(retained?.customTiledGeometry).toBeDefined();
    expect(retained?.customTiledGeometry?.width).toBe(846);

    // Reconcile again: custom geometry persists
    env.ctx.performReconciliation();
    const postReconciliation = env.coordinator.getRetainedWindow("win-1");
    expect(postReconciliation?.customTiledGeometry?.width).toBe(846);
    expect(win1.frameGeometry.width).toBe(846);
  });

  it("production resizeActiveWindow clamps negative deltas to minimum bounds", () => {
    const env = setupVMEnvironment();
    const win = createMockWindow("win-1", { x: 10, y: 10, width: 946, height: 1060 }, SCREEN_1);
    env.ctx.Workspace.activeWindow = win;
    env.ctx.Workspace.stackingOrder = [win];

    // Attempt massive shrink (-2000px)
    env.ctx.resizeActiveWindow(-2000, -2000);

    // minW = Math.max(200, Math.floor(1920 * 0.15)) = 288
    // minH = Math.max(150, Math.floor(1080 * 0.15)) = 162
    expect(win.frameGeometry.width).toBe(288);
    expect(win.frameGeometry.height).toBe(162);
  });

  it("production resizeActiveWindow clamps positive deltas to maximum bounds within screen margins", () => {
    const env = setupVMEnvironment();
    const win = createMockWindow("win-1", { x: 100, y: 100, width: 800, height: 600 }, SCREEN_1);
    env.ctx.Workspace.activeWindow = win;
    env.ctx.Workspace.stackingOrder = [win];

    // Attempt massive expansion (+3000px)
    env.ctx.resizeActiveWindow(3000, 3000);

    // Clamped within area bounds (1920 - 2*10 = 1900 width, 1080 - 2*10 = 1060 height)
    expect(win.frameGeometry.width).toBe(1900);
    expect(win.frameGeometry.height).toBe(1060);
    expect(win.frameGeometry.x + win.frameGeometry.width).toBeLessThanOrEqual(1920 - 10);
    expect(win.frameGeometry.y + win.frameGeometry.height).toBeLessThanOrEqual(1080 - 10);
    expect(win.frameGeometry.x).toBeGreaterThanOrEqual(10);
    expect(win.frameGeometry.y).toBeGreaterThanOrEqual(10);
  });
});
