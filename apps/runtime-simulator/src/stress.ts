import type {
  TraceFixture,
  TraceEvent,
  SimulationResult
} from "./types.js";
import { TRACE_SCHEMA_VERSION } from "./types.js";
import { RuntimeSimulator } from "./simulator.js";

/**
 * Deterministic 32-bit PRNG (Mulberry32).
 */
export function createMulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function mulberry32(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StressOptions {
  seed: number;
  eventCount?: number;
  screens?: number;
}

export function generateStressTrace(options: StressOptions): TraceFixture {
  const { seed, eventCount = 100, screens = 2 } = options;
  const rand = createMulberry32(seed);

  const screenList = [];
  for (let s = 0; s < screens; s++) {
    screenList.push({
      outputId: `SCREEN-${s + 1}`,
      name: `Display-${s + 1}`,
      geometry: { x: s * 1920, y: 0, width: 1920, height: 1080 },
      usableArea: { x: s * 1920, y: 0, width: 1920, height: 1080 }
    });
  }

  const events: TraceEvent[] = [];
  const activeWindows = new Set<string>();
  let nextWindowNum = 1;

  for (let i = 0; i < eventCount; i++) {
    const choice = rand();

    if (choice < 0.35 || activeWindows.size === 0) {
      // Add window
      const winId = `win-stress-${nextWindowNum++}`;
      activeWindows.add(winId);
      const targetScreen = screenList[Math.floor(rand() * screenList.length)];
      events.push({
        type: "window-discovered",
        window: {
          id: winId,
          resourceClass: rand() > 0.5 ? "terminal" : "editor",
          title: `Window ${winId}`,
          outputId: targetScreen.outputId,
          frameGeometry: {
            x: targetScreen.geometry.x + 100,
            y: 100,
            width: 800,
            height: 600
          }
        }
      });
    } else if (choice < 0.50 && activeWindows.size > 1) {
      // Remove window
      const winIds = Array.from(activeWindows);
      const toRemove = winIds[Math.floor(rand() * winIds.length)];
      activeWindows.delete(toRemove);
      events.push({
        type: "window-removed",
        windowId: toRemove
      });
    } else if (choice < 0.65 && activeWindows.size > 0) {
      // Toggle fullscreen or minimize
      const winIds = Array.from(activeWindows);
      const targetWin = winIds[Math.floor(rand() * winIds.length)];
      const sub = rand();
      if (sub < 0.5) {
        events.push({
          type: "fullscreen-change",
          windowId: targetWin,
          fullScreen: rand() > 0.5
        });
      } else {
        events.push({
          type: "minimize-change",
          windowId: targetWin,
          minimized: rand() > 0.5
        });
      }
    } else if (choice < 0.80 && activeWindows.size > 0 && screenList.length > 1) {
      // Move window across outputs
      const winIds = Array.from(activeWindows);
      const targetWin = winIds[Math.floor(rand() * winIds.length)];
      const fromScreen = screenList[0];
      const toScreen = screenList[1];
      events.push({
        type: "output-move",
        windowId: targetWin,
        fromOutputId: fromScreen.outputId,
        toOutputId: toScreen.outputId
      });
    } else if (choice < 0.90) {
      // Master count / ratio / gap change
      const targetScreen = screenList[Math.floor(rand() * screenList.length)];
      const sub = rand();
      if (sub < 0.33) {
        events.push({
          type: "master-count-change",
          outputId: targetScreen.outputId,
          count: Math.floor(rand() * 4) + 1
        });
      } else if (sub < 0.66) {
        events.push({
          type: "master-ratio-change",
          outputId: targetScreen.outputId,
          ratio: 0.2 + rand() * 0.6
        });
      } else {
        events.push({
          type: "gap-change",
          outputId: targetScreen.outputId,
          gapInner: Math.floor(rand() * 16),
          gapOuter: Math.floor(rand() * 20)
        });
      }
    } else {
      // Explicit flush
      events.push({ type: "flush" });
    }
  }

  // Final flush to reconcile remaining dirty state
  events.push({ type: "flush" });

  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    name: `stress-seed-${seed}`,
    description: `Seeded deterministic stress trace with seed ${seed} (${eventCount} events)`,
    initialConfig: {
      enableTiling: true,
      defaultLayout: "master-stack",
      gapInner: 8,
      gapOuter: 10
    },
    initialScreens: screenList,
    events
  };
}

export function runSeededStressTest(seed: number, eventCount = 100): SimulationResult {
  const trace = generateStressTrace({ seed, eventCount });
  const sim = new RuntimeSimulator();
  const result = sim.run(trace);

  if (!result.invariants.passed) {
    throw new Error(
      `Stress test failed invariants for seed ${seed}:\n${JSON.stringify(result.invariants.violations, null, 2)}`
    );
  }

  return result;
}
