import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { RuntimeCoordinator, LogicalClock } from "../src/index.js";
import { evaluateCommitGeometry } from "../src/qml-reconciler-compat.js";
import type { NormalizedScreenInput, NormalizedWindowInput } from "../src/coordinator-types.js";
import type { Rect } from "@tessera/protocol";

const QML_PATH = resolve(__dirname, "../../../contents/ui/main.qml");
const qmlSource = readFileSync(QML_PATH, "utf8");

function extractFunction(source: string, name: string): string {
  const start = source.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Missing production function: " + name);
  const brace = source.indexOf("{", start);
  let depth = 1, end = brace + 1;
  for (; depth && end < source.length; end++) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
  }
  return source.slice(start, end);
}

const SCREEN: NormalizedScreenInput = {
  outputId: "HDMI-A-1",
  name: "HDMI-A-1",
  geometry: { x: 0, y: 0, width: 1920, height: 1080 },
  usableArea: { x: 0, y: 0, width: 1920, height: 1080 },
  activeDesktopId: "1"
};

function makeWin(id: string, geom?: Rect): NormalizedWindowInput {
  return {
    id,
    resourceClass: "app",
    resourceName: "app",
    title: "App " + id,
    outputId: "HDMI-A-1",
    frameGeometry: geom || { x: 100, y: 100, width: 600, height: 400 },
    managed: true,
    normalWindow: true
  };
}

interface MockWindow {
  internalId: string;
  managed: boolean;
  normalWindow: boolean;
  deleted: boolean;
  fullScreen: boolean;
  moveResized: boolean;
  minimized: boolean;
  maximizeMode: number;
  output: any;
  desktops: any[];
  activities: any[];
  _geometry: Rect;
  frameGeometry: Rect;
  _tesseraHooks?: any;
  throwOnSetter?: boolean;
  clampMinSize?: { width: number; height: number };
  onFrameGeometryChanged?: () => void;
  delaySignalDelivery?: boolean;
  delayedSignalQueue?: (() => void)[];
  minimizedChanged?: { connect: (fn: any) => void; disconnect: (fn: any) => void };
  maximizedChanged?: { connect: (fn: any) => void; disconnect: (fn: any) => void };
  fullScreenChanged?: { connect: (fn: any) => void; disconnect: (fn: any) => void };
  interactiveMoveResizeStarted?: { connect: (fn: any) => void; disconnect: (fn: any) => void };
  interactiveMoveResizeStepped?: { connect: (fn: any) => void; disconnect: (fn: any) => void };
  interactiveMoveResizeFinished?: { connect: (fn: any) => void; disconnect: (fn: any) => void };
  frameGeometryChanged?: { connect: (fn: any) => void; disconnect: (fn: any) => void };
}

function createMockWindow(id: string, initialGeom: Rect): MockWindow {
  const win: MockWindow = {
    internalId: id,
    managed: true,
    normalWindow: true,
    deleted: false,
    fullScreen: false,
    moveResized: false,
    minimized: false,
    maximizeMode: 0,
    output: SCREEN,
    desktops: [{ id: "1" }],
    activities: [{ id: "act-1" }],
    minimizedChanged: { connect: () => {}, disconnect: () => {} },
    maximizedChanged: { connect: () => {}, disconnect: () => {} },
    fullScreenChanged: { connect: () => {}, disconnect: () => {} },
    interactiveMoveResizeStarted: { connect: () => {}, disconnect: () => {} },
    interactiveMoveResizeStepped: { connect: () => {}, disconnect: () => {} },
    interactiveMoveResizeFinished: { connect: () => {}, disconnect: () => {} },
    frameGeometryChanged: { connect: () => {}, disconnect: () => {} },
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
      if (this.onFrameGeometryChanged) {
        if (this.delaySignalDelivery && this.delayedSignalQueue) {
          const fn = this.onFrameGeometryChanged;
          this.delayedSignalQueue.push(fn);
        } else {
          this.onFrameGeometryChanged();
        }
      }
    }
  };
  return win;
}

interface TestVMEnvironment {
  ctx: any;
  coordinator: RuntimeCoordinator;
  clock: LogicalClock;
  scheduledReconciles: string[];
  osdNotifications: string[];
}

function setupVMEnvironment(sourceOverride?: string): TestVMEnvironment {
  const source = sourceOverride || qmlSource;
  const clock = new LogicalClock(0);
  const coordinator = new RuntimeCoordinator(
    { enableTiling: true, defaultLayout: "balanced-grid" },
    clock
  );
  coordinator.getOrCreateScreen(SCREEN);

  const scheduledReconciles: string[] = [];
  const osdNotifications: string[] = [];
  let timerRunning = false;

  const animTimer = {
    get running() { return timerRunning; },
    start() { timerRunning = true; },
    stop() { timerRunning = false; }
  };

  const config = { enableTiling: true, enableAnimations: true, animationDurationMs: 180 };

  const ctx: any = {
    Date: { now: () => clock.now() },
    Math,
    root: { config, coordinator },
    coordinator,
    isArranging: false,
    config,
    currentDraggingWindow: null,
    activeAnimations: {},
    targetOutputsByWid: {},
    activeCount: 0,
    writingWindowId: null,
    animTimer,
    isAnimating: function(wid: string) { return !!this.activeAnimations[wid]; },
    Workspace: {
      screens: [SCREEN],
      activeScreen: SCREEN,
      currentDesktop: { id: "1" },
      clientArea: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
      cursorPos: { x: 500, y: 500 }
    },
    KWin: {
      MaximizeArea: 1
    },
    ReconcilerModule: {
      ReconcilerBridge: {
        evaluateCommitGeometry: (w: any, target: Rect, bounds: Rect) => evaluateCommitGeometry(w, target, bounds)
      }
    },
    getWindowId: (w: any) => w.internalId,
    getScreenForPos: () => SCREEN,
    getScreenName: () => "HDMI-A-1",
    getCoordinator: () => coordinator,
    Qt: {
      rect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
    },
    scheduleReconcile: (reason: string) => scheduledReconciles.push(reason),
    osdCall: {
      notify: (text: string) => osdNotifications.push(text)
    },
    log: () => {},
    setPreMinimizeGeometry: () => {},
    getSavedTiledGeometry: () => null,
    setSavedTiledGeometry: () => {},
    retileNow: () => scheduledReconciles.push("retileNow"),
    checkFilter: () => true
  };

  ctx.windowAnimator = ctx;
  vm.createContext(ctx);

  const functionNames = [
    "setTargetOutputName",
    "getTargetOutputName",
    "cancelAnimation",
    "cancelAllAnimations",
    "cancelInvalidAnimations",
    "easeOutCubic",
    "isExpectedIntermediate",
    "animateWindow",
    "step",
    "commitWindowGeometry",
    "unhookWindow",
    "hookWindow",
    "toggleTiling"
  ];

  for (const fn of functionNames) {
    const code = extractFunction(source, fn);
    vm.runInContext(code, ctx);
  }

  return { ctx, coordinator, clock, scheduledReconciles, osdNotifications };
}

describe("Production QML Animation Engine & Lifecycle Behavioral Verification", () => {
  describe("Coordinator In-Flight Command Tracking", () => {
    it("tracks, verifies, and clears commands authoritatively", () => {
      const clock = new LogicalClock(0);
      const coord = new RuntimeCoordinator({ enableTiling: true }, clock);
      coord.getOrCreateScreen(SCREEN);

      expect(coord.hasRecordedCommand("win-1")).toBe(false);
      coord.recordCommand("win-1", { x: 10, y: 10, width: 400, height: 300 }, 1);
      expect(coord.hasRecordedCommand("win-1")).toBe(true);
      expect(coord.getRecordedCommand("win-1")?.target).toEqual({ x: 10, y: 10, width: 400, height: 300 });

      coord.clearRecordedCommand("win-1");
      expect(coord.hasRecordedCommand("win-1")).toBe(false);
    });
  });

  describe("Execution of Actual Extracted Production QML Functions", () => {
    it("1. Unchanged-valid target cancels active older animation and clears superseded command", () => {
      const env = setupVMEnvironment();
      const initialGeom = { x: 0, y: 0, width: 500, height: 500 };
      const win = createMockWindow("win-1", initialGeom);
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-1", initialGeom) });

      // First commit: applied, starts animation
      const target1 = { x: 200, y: 200, width: 800, height: 600 };
      const res1 = env.ctx.commitWindowGeometry(win, target1, "retile", 1);
      expect(res1.outcome).toBe("applied");
      expect(env.ctx.isAnimating("win-1")).toBe(true);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(true);

      // Step halfway (90ms of 180ms)
      env.clock.advance(90);
      env.ctx.step();
      expect(win.frameGeometry.x).toBeGreaterThan(0);
      const currentObserved = { ...win.frameGeometry };

      // Second commit arrives with targetRect exactly equal to current observed intermediate geometry
      const res2 = env.ctx.commitWindowGeometry(win, currentObserved, "retile", 2);
      expect(res2.outcome).toBe("unchanged-valid");

      // Production QML commitWindowGeometry must have cancelled the active animation and cleared command!
      expect(env.ctx.isAnimating("win-1")).toBe(false);
      expect(env.ctx.activeCount).toBe(0);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(false);

      // Further step does NOT advance window
      env.clock.advance(150);
      env.ctx.step();
      expect(win.frameGeometry).toEqual(currentObserved);
    });

    it("2. Setter throws on animation completion: catches error, clears pending command, and suppresses 0 echoes", () => {
      const env = setupVMEnvironment();
      const initialGeom = { x: 100, y: 100, width: 600, height: 400 };
      const win = createMockWindow("win-1", initialGeom);
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-1", initialGeom) });

      const target = { x: 200, y: 200, width: 800, height: 600 };
      env.ctx.commitWindowGeometry(win, target, "retile", 1);
      expect(env.ctx.isAnimating("win-1")).toBe(true);

      // Simulate KWin rejection / throw on final write
      win.throwOnSetter = true;

      // Complete animation
      env.clock.advance(200);
      expect(() => env.ctx.step()).not.toThrow();

      // Animation stopped, pending command cleared, 0 echoes suppressed
      expect(env.ctx.isAnimating("win-1")).toBe(false);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(false);
      expect(env.coordinator.getDiagnostics().suppressedGeometryEchoes).toBe(0);
    });

    it("3. Setter clamps on animation completion: feeds actual observed geometry, clears command, and triggers reconcile", () => {
      const env = setupVMEnvironment();
      const initialGeom = { x: 100, y: 100, width: 600, height: 400 };
      const win = createMockWindow("win-1", initialGeom);
      // Window minimum size constraint clamps geometry to min 700x500
      win.clampMinSize = { width: 700, height: 500 };
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-1", initialGeom) });

      // Target is 400x300, smaller than minimum size
      const target = { x: 100, y: 100, width: 400, height: 300 };
      env.ctx.commitWindowGeometry(win, target, "retile", 1);
      expect(env.ctx.isAnimating("win-1")).toBe(true);

      // Complete animation
      env.clock.advance(200);
      env.ctx.step();

      // Window was clamped to 700x500
      expect(win.frameGeometry).toEqual({ x: 100, y: 100, width: 700, height: 500 });
      // Pending command must be cleared
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(false);
      // Suppressed echo count must NOT increment
      expect(env.coordinator.getDiagnostics().suppressedGeometryEchoes).toBe(0);
      // Coordinator retained window must reflect ACTUAL clamped geometry
      expect(env.coordinator.getRetainedWindow("win-1")?.frameGeometry).toEqual({
        x: 100,
        y: 100,
        width: 700,
        height: 500
      });
      // Reconcile was scheduled for clamped state
      expect(env.scheduledReconciles).toContain("WindowGeometryClamped");
    });

    it("4. Synchronous signal completion: echo consumed during signal without duplicate mismatch reporting", () => {
      const env = setupVMEnvironment();
      const initialGeom = { x: 100, y: 100, width: 600, height: 400 };
      const win = createMockWindow("win-1", initialGeom);
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-1", initialGeom) });

      // Hook window with production hookWindow callback
      env.ctx.hookWindow(win);
      // Set up frameGeometry setter to fire synchronous hook
      win.onFrameGeometryChanged = () => {
        if (win._tesseraHooks && win._tesseraHooks.geom) {
          win._tesseraHooks.geom();
        }
      };

      const target = { x: 200, y: 200, width: 800, height: 600 };
      env.ctx.commitWindowGeometry(win, target, "retile", 1);

      // Complete animation
      env.clock.advance(200);
      env.ctx.step();

      expect(env.ctx.isAnimating("win-1")).toBe(false);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(false);
      // Suppressed echo count must be 1
      expect(env.coordinator.getDiagnostics().suppressedGeometryEchoes).toBe(1);
      expect(env.coordinator.getRetainedWindow("win-1")?.frameGeometry).toEqual(target);
      // Synchronous echo match did not trigger spurious reconcile
      expect(env.scheduledReconciles).not.toContain("WindowGeometryClamped");
    });

    it("5. No-signal completion: completion handler validates actual geometry and acknowledges echo", () => {
      const env = setupVMEnvironment();
      const initialGeom = { x: 100, y: 100, width: 600, height: 400 };
      const win = createMockWindow("win-1", initialGeom);
      win.onFrameGeometryChanged = undefined; // No signal fired
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-1", initialGeom) });

      const target = { x: 250, y: 250, width: 850, height: 550 };
      env.ctx.commitWindowGeometry(win, target, "retile", 1);

      // Complete animation
      env.clock.advance(200);
      env.ctx.step();

      expect(env.ctx.isAnimating("win-1")).toBe(false);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(false);
      // Suppressed echo count must be 1 (acknowledged via completion block)
      expect(env.coordinator.getDiagnostics().suppressedGeometryEchoes).toBe(1);
      expect(env.coordinator.getRetainedWindow("win-1")?.frameGeometry).toEqual(target);
    });

    it("6. Lifecycle cancellations: minimize, maximize, interactive move/resize, screen removal, tiling disabled, unhook", () => {
      const env = setupVMEnvironment();
      const win = createMockWindow("win-1", { x: 100, y: 100, width: 600, height: 400 });
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-1") });
      env.ctx.hookWindow(win);

      const target = { x: 300, y: 300, width: 700, height: 500 };

      // A. Minimize cancellation
      env.ctx.commitWindowGeometry(win, target, "retile", 1);
      expect(env.ctx.isAnimating("win-1")).toBe(true);
      win.minimized = true;
      win._tesseraHooks.minimized();
      expect(env.ctx.isAnimating("win-1")).toBe(false);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(false);
      win.minimized = false;

      // B. Maximize cancellation
      env.ctx.commitWindowGeometry(win, target, "retile", 2);
      expect(env.ctx.isAnimating("win-1")).toBe(true);
      win.maximizeMode = 3;
      win._tesseraHooks.maxChanged();
      expect(env.ctx.isAnimating("win-1")).toBe(false);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(false);
      win.maximizeMode = 0;

      // C. Interactive move/resize start
      env.ctx.commitWindowGeometry(win, target, "retile", 3);
      expect(env.ctx.isAnimating("win-1")).toBe(true);
      win._tesseraHooks.started();
      expect(env.ctx.isAnimating("win-1")).toBe(false);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(false);

      // D. Screen removal
      env.ctx.commitWindowGeometry(win, target, "retile", 4);
      expect(env.ctx.isAnimating("win-1")).toBe(true);
      env.ctx.Workspace.screens = [];
      env.ctx.cancelInvalidAnimations();
      expect(env.ctx.isAnimating("win-1")).toBe(false);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(false);
      env.ctx.Workspace.screens = [SCREEN];

      // E. Tiling disabled
      env.ctx.commitWindowGeometry(win, target, "retile", 5);
      expect(env.ctx.isAnimating("win-1")).toBe(true);
      env.ctx.toggleTiling(); // toggles enableTiling to false
      expect(env.ctx.isAnimating("win-1")).toBe(false);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(false);
      env.ctx.toggleTiling(); // toggles back to true

      // F. Unhook / Window destruction
      env.ctx.commitWindowGeometry(win, target, "retile", 6);
      expect(env.ctx.isAnimating("win-1")).toBe(true);
      env.ctx.unhookWindow(win);
      expect(env.ctx.isAnimating("win-1")).toBe(false);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(false);
    });

    it("7. External programmatic geometry change during active animation cancels animation, clears command, and reconciles observed geometry", () => {
      const env = setupVMEnvironment();
      const initialGeom = { x: 100, y: 100, width: 600, height: 400 };
      const win = createMockWindow("win-1", initialGeom);
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-1", initialGeom) });

      // Hook window with production hookWindow callback
      env.ctx.hookWindow(win);
      win.onFrameGeometryChanged = () => {
        if (win._tesseraHooks && win._tesseraHooks.geom) {
          win._tesseraHooks.geom();
        }
      };

      const target = { x: 200, y: 200, width: 800, height: 600 };
      env.ctx.commitWindowGeometry(win, target, "retile", 1);

      expect(env.ctx.isAnimating("win-1")).toBe(true);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(true);

      // Step halfway (90ms of 180ms)
      env.clock.advance(90);
      env.ctx.step();

      // Intermediate frame write from Tessera's animator did not cancel animation or clear command
      expect(env.ctx.isAnimating("win-1")).toBe(true);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(true);
      expect(win.frameGeometry.x).toBeGreaterThan(100);

      // Programmatic geometry change from the application during the animation window
      const externalGeom = { x: 50, y: 50, width: 320, height: 240 };
      win.frameGeometry = externalGeom;

      // The external change MUST have:
      // 1. Cancelled the active animation
      expect(env.ctx.isAnimating("win-1")).toBe(false);
      expect(env.ctx.activeCount).toBe(0);
      // 2. Cleared the recorded in-flight command
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(false);
      // 3. Updated coordinator retained window with the observed geometry
      expect(env.coordinator.getRetainedWindow("win-1")?.frameGeometry).toEqual(externalGeom);
      // 4. Scheduled reconciliation from observed geometry
      expect(env.scheduledReconciles).toContain("WindowGeometryChanged");

      // Further timer ticks must NOT overwrite the application's external geometry
      env.clock.advance(150);
      env.ctx.step();
      expect(win.frameGeometry).toEqual(externalGeom);
    });

    it("8. Two-window reentrant external change: window B's external change during window A's intermediate write is NOT suppressed", () => {
      const env = setupVMEnvironment();
      const geomA = { x: 100, y: 100, width: 600, height: 400 };
      const geomB = { x: 800, y: 100, width: 600, height: 400 };
      const winA = createMockWindow("win-A", geomA);
      const winB = createMockWindow("win-B", geomB);
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-A", geomA) });
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-B", geomB) });

      env.ctx.hookWindow(winA);
      env.ctx.hookWindow(winB);

      winB.onFrameGeometryChanged = () => {
        if (winB._tesseraHooks && winB._tesseraHooks.geom) {
          winB._tesseraHooks.geom();
        }
      };

      // When window A's setter writes an intermediate frame, simulate a synchronous reentrant
      // external change on window B from client B
      let reentrantTriggered = false;
      const externalB = { x: 50, y: 50, width: 300, height: 200 };
      winA.onFrameGeometryChanged = () => {
        if (!reentrantTriggered && env.ctx.writingWindowId === "win-A") {
          reentrantTriggered = true;
          // Reentrantly mutate window B while window A is being written
          winB.frameGeometry = externalB;
        }
        if (winA._tesseraHooks && winA._tesseraHooks.geom) {
          winA._tesseraHooks.geom();
        }
      };

      const targetA = { x: 150, y: 150, width: 650, height: 450 };
      const targetB = { x: 850, y: 150, width: 650, height: 450 };
      env.ctx.commitWindowGeometry(winA, targetA, "retile", 1);
      env.ctx.commitWindowGeometry(winB, targetB, "retile", 2);

      expect(env.ctx.isAnimating("win-A")).toBe(true);
      expect(env.ctx.isAnimating("win-B")).toBe(true);

      // Step halfway (90ms): steps winA, which triggers reentrant external change on winB
      env.clock.advance(90);
      env.ctx.step();

      expect(reentrantTriggered).toBe(true);
      // Window B's external change must NOT have been suppressed by Window A's write!
      expect(env.ctx.isAnimating("win-B")).toBe(false);
      expect(env.coordinator.hasRecordedCommand("win-B")).toBe(false);
      expect(env.coordinator.getRetainedWindow("win-B")?.frameGeometry).toEqual(externalB);
      expect(env.scheduledReconciles).toContain("WindowGeometryChanged");

      // Window A was NOT cancelled and continues animating
      expect(env.ctx.isAnimating("win-A")).toBe(true);
      expect(env.coordinator.hasRecordedCommand("win-A")).toBe(true);
    });

    it("9. Delayed-signal delivery: queued intermediate frame write does not self-cancel, while newer mismatching external geometry cancels", () => {
      const env = setupVMEnvironment();
      const initialGeom = { x: 100, y: 100, width: 600, height: 400 };
      const win = createMockWindow("win-1", initialGeom);
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-1", initialGeom) });

      env.ctx.hookWindow(win);

      // Configure window to queue frameGeometryChanged signals instead of firing synchronously
      const delayedQueue: (() => void)[] = [];
      win.delaySignalDelivery = true;
      win.delayedSignalQueue = delayedQueue;
      win.onFrameGeometryChanged = () => {
        if (win._tesseraHooks && win._tesseraHooks.geom) {
          win._tesseraHooks.geom();
        }
      };

      const target = { x: 200, y: 200, width: 800, height: 600 };
      env.ctx.commitWindowGeometry(win, target, "retile", 1);
      expect(env.ctx.isAnimating("win-1")).toBe(true);

      // Step halfway (90ms)
      env.clock.advance(90);
      env.ctx.step();

      // step() returned, so writingWindowId is null
      expect(env.ctx.writingWindowId).toBeNull();
      // Exactly 1 delayed intermediate signal was queued by the setter
      expect(delayedQueue.length).toBe(1);
      expect(env.ctx.isAnimating("win-1")).toBe(true);

      // Now flush the delayed intermediate frame write signal from KWin
      const flushSignal = delayedQueue.shift()!;
      flushSignal();

      // Because the delayed signal geometry matches Tessera's expected intermediate write,
      // it MUST NOT self-cancel!
      expect(env.ctx.isAnimating("win-1")).toBe(true);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(true);

      // Now simulate a newer mismatching external geometry arriving while still animating
      const externalGeom = { x: 40, y: 40, width: 350, height: 250 };
      win.frameGeometry = externalGeom;
      expect(delayedQueue.length).toBe(1);

      // Flush the external change signal
      const flushExternal = delayedQueue.shift()!;
      flushExternal();

      // The mismatching external geometry MUST NOT be swallowed: it cancels animation and reconciles!
      expect(env.ctx.isAnimating("win-1")).toBe(false);
      expect(env.ctx.activeCount).toBe(0);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(false);
      expect(env.coordinator.getRetainedWindow("win-1")?.frameGeometry).toEqual(externalGeom);
      expect(env.scheduledReconciles).toContain("WindowGeometryChanged");

      // Further timer ticks do not overwrite the application's external geometry
      env.clock.advance(150);
      env.ctx.step();
      expect(win.frameGeometry).toEqual(externalGeom);
    });
  });

  describe("Negative Mutations (Proving Non-Vacuity & Rejecting False-Greens)", () => {
    it("mutation 1: omitting unchanged-valid cancellation leaves superseded animation running", () => {
      // Create broken QML source by removing cancelAnimation on unchanged-valid
      const brokenSource = qmlSource.replace(
        "windowAnimator.cancelAnimation(wid, true);",
        "/* MUTATION: omitted cancelAnimation */"
      );
      expect(brokenSource).not.toEqual(qmlSource);

      const env = setupVMEnvironment(brokenSource);
      const initialGeom = { x: 0, y: 0, width: 500, height: 500 };
      const win = createMockWindow("win-1", initialGeom);
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-1", initialGeom) });

      env.ctx.commitWindowGeometry(win, { x: 200, y: 200, width: 800, height: 600 }, "retile", 1);
      env.clock.advance(90);
      env.ctx.step();
      const currentObserved = { ...win.frameGeometry };

      const res = env.ctx.commitWindowGeometry(win, currentObserved, "retile", 2);
      expect(res.outcome).toBe("unchanged-valid");

      // In the broken code, isAnimating is STILL TRUE and command was NOT cleared!
      expect(env.ctx.isAnimating("win-1")).toBe(true);
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(true);
    });

    it("mutation 2: fabricating requested target on clamp causes false echo acknowledgement", () => {
      // Create broken QML source that feeds requested target instead of actual observed geometry
      const brokenSource = qmlSource.replace(
        "var echoCheck = coord.checkAndHandleEcho(c.wid, observed);",
        "var echoCheck = coord.checkAndHandleEcho(c.wid, { x: c.targetX, y: c.targetY, width: c.targetW, height: c.targetH });"
      );
      expect(brokenSource).not.toEqual(qmlSource);

      const env = setupVMEnvironment(brokenSource);
      const initialGeom = { x: 100, y: 100, width: 600, height: 400 };
      const win = createMockWindow("win-1", initialGeom);
      win.clampMinSize = { width: 700, height: 500 };
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-1", initialGeom) });

      const target = { x: 100, y: 100, width: 400, height: 300 };
      env.ctx.commitWindowGeometry(win, target, "retile", 1);

      env.clock.advance(200);
      env.ctx.step();

      // In the broken code, the fabricated requested target caused a FALSE echo acknowledgment!
      expect(env.coordinator.getDiagnostics().suppressedGeometryEchoes).toBe(1);
      // And the coordinator retained window has the unachievable requested target (400x300), NOT actual (700x500)!
      expect(env.coordinator.getRetainedWindow("win-1")?.frameGeometry).toEqual(target);
    });

    it("mutation 3: swallowing setter throw without clearing command leaves orphaned pending command", () => {
      // Create broken QML source that does not clear command on write failure
      const brokenSource = qmlSource.replace(
        "coord.clearRecordedCommand(c.wid);",
        "/* MUTATION: omitted clearRecordedCommand */"
      );
      expect(brokenSource).not.toEqual(qmlSource);

      const env = setupVMEnvironment(brokenSource);
      const initialGeom = { x: 100, y: 100, width: 600, height: 400 };
      const win = createMockWindow("win-1", initialGeom);
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-1", initialGeom) });

      env.ctx.commitWindowGeometry(win, { x: 200, y: 200, width: 800, height: 600 }, "retile", 1);
      win.throwOnSetter = true;

      env.clock.advance(200);
      env.ctx.step();

      // In the broken code, the command was NEVER cleared and remains orphaned in coordinator!
      expect(env.coordinator.hasRecordedCommand("win-1")).toBe(true);
    });

    it("mutation 4: omitting external geometry cancellation leaves animation running and overwrites external change", () => {
      // Create broken QML source by omitting cancellation on external geometry change in onFrameGeometryChanged
      const targetComment = "// External geometry change during active animation cancels animation and clears command\n                windowAnimator.cancelAnimation(wid, true);";
      const brokenSource = qmlSource.replace(
        targetComment,
        "/* MUTATION: omitted external geometry cancellation */"
      );
      expect(brokenSource).not.toEqual(qmlSource);

      const env = setupVMEnvironment(brokenSource);
      const initialGeom = { x: 100, y: 100, width: 600, height: 400 };
      const win = createMockWindow("win-1", initialGeom);
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-1", initialGeom) });

      env.ctx.hookWindow(win);
      win.onFrameGeometryChanged = () => {
        if (win._tesseraHooks && win._tesseraHooks.geom) {
          win._tesseraHooks.geom();
        }
      };

      const target = { x: 200, y: 200, width: 800, height: 600 };
      env.ctx.commitWindowGeometry(win, target, "retile", 1);

      env.clock.advance(90);
      env.ctx.step();
      expect(env.ctx.isAnimating("win-1")).toBe(true);

      const externalGeom = { x: 50, y: 50, width: 320, height: 240 };
      win.frameGeometry = externalGeom;

      // In the broken code, animation is STILL active because external change was ignored!
      expect(env.ctx.isAnimating("win-1")).toBe(true);

      // And stepping to completion clobbers the external geometry with the target!
      env.clock.advance(150);
      env.ctx.step();
      expect(win.frameGeometry).not.toEqual(externalGeom);
    });

    it("mutation 5: global writing check suppresses reentrant external change for another window", () => {
      // Create broken QML source where own-write guard checks writingWindowId !== null instead of writingWindowId === wid
      const targetCheck = "if (windowAnimator.writingWindowId === wid) {\n                    return;\n                }";
      const brokenSource = qmlSource.replace(
        targetCheck,
        "if (windowAnimator.writingWindowId !== null) {\n                    return;\n                }"
      );
      expect(brokenSource).not.toEqual(qmlSource);

      const env = setupVMEnvironment(brokenSource);
      const geomA = { x: 100, y: 100, width: 600, height: 400 };
      const geomB = { x: 800, y: 100, width: 600, height: 400 };
      const winA = createMockWindow("win-A", geomA);
      const winB = createMockWindow("win-B", geomB);
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-A", geomA) });
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-B", geomB) });

      env.ctx.hookWindow(winA);
      env.ctx.hookWindow(winB);

      winB.onFrameGeometryChanged = () => {
        if (winB._tesseraHooks && winB._tesseraHooks.geom) {
          winB._tesseraHooks.geom();
        }
      };

      let reentrantTriggered = false;
      const externalB = { x: 50, y: 50, width: 300, height: 200 };
      winA.onFrameGeometryChanged = () => {
        if (!reentrantTriggered && env.ctx.writingWindowId === "win-A") {
          reentrantTriggered = true;
          winB.frameGeometry = externalB;
        }
        if (winA._tesseraHooks && winA._tesseraHooks.geom) {
          winA._tesseraHooks.geom();
        }
      };

      env.ctx.commitWindowGeometry(winA, { x: 150, y: 150, width: 650, height: 450 }, "retile", 1);
      env.ctx.commitWindowGeometry(winB, { x: 850, y: 150, width: 650, height: 450 }, "retile", 2);

      env.clock.advance(90);
      env.ctx.step();

      // In the broken code, winB's external change was falsely suppressed because writingWindowId was not null!
      expect(env.ctx.isAnimating("win-B")).toBe(true);
    });

    it("mutation 6: omitting isExpectedIntermediate causes delayed own-write signal to self-cancel animation", () => {
      // Create broken QML source by omitting isExpectedIntermediate check
      const targetBlock = "if (windowAnimator.isExpectedIntermediate && windowAnimator.isExpectedIntermediate(wid, w.frameGeometry)) {\n                    return;\n                }";
      const brokenSource = qmlSource.replace(
        targetBlock,
        "/* MUTATION: omitted isExpectedIntermediate */"
      );
      expect(brokenSource).not.toEqual(qmlSource);

      const env = setupVMEnvironment(brokenSource);
      const initialGeom = { x: 100, y: 100, width: 600, height: 400 };
      const win = createMockWindow("win-1", initialGeom);
      env.coordinator.ingestEvent({ type: "WindowDiscovered", window: makeWin("win-1", initialGeom) });

      env.ctx.hookWindow(win);
      const delayedQueue: (() => void)[] = [];
      win.delaySignalDelivery = true;
      win.delayedSignalQueue = delayedQueue;
      win.onFrameGeometryChanged = () => {
        if (win._tesseraHooks && win._tesseraHooks.geom) {
          win._tesseraHooks.geom();
        }
      };

      env.ctx.commitWindowGeometry(win, { x: 200, y: 200, width: 800, height: 600 }, "retile", 1);
      env.clock.advance(90);
      env.ctx.step();

      // Deliver the delayed intermediate frame write signal
      const flushSignal = delayedQueue.shift()!;
      flushSignal();

      // In the broken code, the delayed signal falsely self-cancelled the animation!
      expect(env.ctx.isAnimating("win-1")).toBe(false);
    });
  });

  describe("Guarded FrameGeometry Write Invariants", () => {
    it("guarantees exactly 4 guarded frameGeometry writes in main.qml", () => {
      const assignments = qmlSource
        .split("\n")
        .filter((line) => line.includes("frameGeometry =") && !line.trim().startsWith("//"));
      expect(assignments.length).toBe(4);
      expect(assignments.every((l) => l.includes("win.frameGeometry = Qt.rect("))).toBe(true);
    });
  });
});
