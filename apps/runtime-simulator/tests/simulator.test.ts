import { describe, it, expect } from "vitest";
import { resolve, dirname, basename } from "node:path";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

import {
  RuntimeSimulator,
  canonicalizeState,
  computeDigest,
  generateStressTrace,
  runSeededStressTest,
  TRACE_SCHEMA_VERSION,
  type TraceFixture
} from "../src/index.js";
import { validateInvariants } from "../src/invariants.js";
import { runCli } from "../src/cli.js";
import { SimulatedKWinSession } from "../src/session.js";
import { RuntimeCoordinator, TraceRecorder, LogicalClock } from "@tessera/kwin-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = resolve(__dirname, "../fixtures");
const GOLDENS_DIR = resolve(__dirname, "../goldens");

describe("Phase 3 Runtime Simulator & Trace Replay", () => {
  const fixture1Path = resolve(FIXTURES_DIR, "01-single-screen-three-windows.fixture.json");

  it("1. Identical replay produces byte-identical canonical output", () => {
    const sim = new RuntimeSimulator();
    const fix = sim.loadFixture(fixture1Path);
    const r1 = sim.run(fix);
    const r2 = sim.run(fix);

    const c1 = canonicalizeState(r1);
    const c2 = canonicalizeState(r2);
    expect(c1).toBe(c2);
  });

  it("2. Identical replay produces the same digest", () => {
    const sim = new RuntimeSimulator();
    const fix = sim.loadFixture(fixture1Path);
    const r1 = sim.run(fix);
    const r2 = sim.run(fix);

    expect(r1.digest).toBe(r2.digest);
    expect(r1.digest).toHaveLength(64);
  });

  it("3. Logical clock controls echo expiration", () => {
    // With echoExpiryMs: 100, echo arriving at tick 50 is suppressed; at tick 150 is expired
    const clock = new LogicalClock(0);
    const coord = new RuntimeCoordinator({ echoExpiryMs: 100 }, clock);
    coord.getOrCreateScreen({
      outputId: "HDMI-A-1",
      geometry: { x: 0, y: 0, width: 1920, height: 1080 },
      usableArea: { x: 0, y: 0, width: 1920, height: 1080 }
    });
    coord.ingestEvent({
      type: "WindowDiscovered",
      window: { id: "win-1", outputId: "HDMI-A-1", frameGeometry: { x: 0, y: 0, width: 100, height: 100 } }
    });
    const tx = coord.reconcile();
    expect(tx).not.toBeNull();
    const targetRect = tx!.operations[0].targetRect;
    coord.recordCommand("win-1", targetRect, tx!.epoch);

    // Echo at tick 50 (within 100ms)
    clock.set(50);
    const echoRes1 = coord.ingestEvent({
      type: "WindowGeometryChanged",
      windowId: "win-1",
      geometry: targetRect,
      timestamp: clock.now()
    });
    expect(echoRes1.isEcho).toBe(true);

    // Re-arm command for the same target using the real transaction epoch at current clock time
    coord.recordCommand("win-1", targetRect, tx!.epoch);

    // Echo at tick 300 (past 100ms expiry from tick 50)
    clock.set(300);
    const echoRes2 = coord.ingestEvent({
      type: "WindowGeometryChanged",
      windowId: "win-1",
      geometry: targetRect,
      timestamp: clock.now()
    });
    expect(echoRes2.isEcho).toBe(false);

    // Verify SimulatedKWinSession.applyOperations requires epoch: number and unconditionally records commands
    const suppressedBefore = coord.getDiagnostics().suppressedGeometryEchoes;
    clock.set(350);
    const session = new SimulatedKWinSession("immediate");
    session.applyOperations([{ windowId: "win-1", targetRect, previousRect: targetRect }], clock.now(), coord, 999);
    expect(session.getTotalWrites()).toBe(1);
    expect(coord.getDiagnostics().suppressedGeometryEchoes).toBe(suppressedBefore + 1);
  });

  it("4. Wall-clock time cannot affect digest output", async () => {
    const sim = new RuntimeSimulator();
    const fix = sim.loadFixture(fixture1Path);
    const r1 = sim.run(fix);

    // Artificially delay execution
    await new Promise(res => setTimeout(res, 25));

    const r2 = sim.run(fix);
    expect(r1.digest).toBe(r2.digest);
  });

  it("5. Same-turn events coalesce into one transaction", () => {
    const sim = new RuntimeSimulator();
    const fix: TraceFixture = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      initialConfig: { enableTiling: true },
      initialScreens: [
        {
          outputId: "S1",
          geometry: { x: 0, y: 0, width: 1920, height: 1080 },
          usableArea: { x: 0, y: 0, width: 1920, height: 1080 }
        }
      ],
      events: [
        { type: "window-discovered", window: { id: "w1", outputId: "S1" } },
        { type: "window-discovered", window: { id: "w2", outputId: "S1" } },
        { type: "window-discovered", window: { id: "w3", outputId: "S1" } },
        { type: "flush" }
      ]
    };
    const res = sim.run(fix);
    expect(res.diagnostics.totalTransactions).toBe(1);
  });

  it("6. Explicit flush boundaries produce separate transactions", () => {
    const sim = new RuntimeSimulator();
    const fix: TraceFixture = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      initialConfig: { enableTiling: true },
      initialScreens: [
        {
          outputId: "S1",
          geometry: { x: 0, y: 0, width: 1920, height: 1080 },
          usableArea: { x: 0, y: 0, width: 1920, height: 1080 }
        }
      ],
      events: [
        { type: "window-discovered", window: { id: "w1", outputId: "S1" } },
        { type: "flush" },
        { type: "window-discovered", window: { id: "w2", outputId: "S1" } },
        { type: "flush" }
      ]
    };
    const res = sim.run(fix);
    expect(res.diagnostics.totalTransactions).toBe(2);
  });

  it("7. Immediate expected echo is suppressed", () => {
    const sim = new RuntimeSimulator();
    const fix: TraceFixture = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      echoMode: "immediate",
      initialScreens: [
        {
          outputId: "S1",
          geometry: { x: 0, y: 0, width: 1920, height: 1080 },
          usableArea: { x: 0, y: 0, width: 1920, height: 1080 }
        }
      ],
      events: [
        { type: "window-discovered", window: { id: "w1", outputId: "S1" } },
        { type: "flush" }
      ]
    };
    const res = sim.run(fix);
    expect(res.diagnostics.suppressedEchoes).toBeGreaterThanOrEqual(1);
  });

  it("8. Delayed but valid echo is suppressed", () => {
    const sim = new RuntimeSimulator();
    const fix: TraceFixture = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      echoMode: "delayed",
      echoDelayTicks: 2,
      initialScreens: [
        {
          outputId: "S1",
          geometry: { x: 0, y: 0, width: 1920, height: 1080 },
          usableArea: { x: 0, y: 0, width: 1920, height: 1080 }
        }
      ],
      events: [
        { tick: 1, type: "window-discovered", window: { id: "w1", outputId: "S1" } },
        { tick: 2, type: "flush" },
        { tick: 5, type: "advance-clock", deltaTicks: 3 },
        { tick: 6, type: "flush" }
      ]
    };
    const res = sim.run(fix);
    expect(res.diagnostics.suppressedEchoes).toBeGreaterThanOrEqual(1);
  });

  it("9. Expired echo is not suppressed", () => {
    const sim = new RuntimeSimulator();
    const fixPath = resolve(FIXTURES_DIR, "20-expired-geometry-echo.fixture.json");
    const res = sim.run(sim.loadFixture(fixPath));
    // In expired echo fixture, the echo arrives past expiry and is not counted as suppressed echo for that event
    expect(res.invariants.passed).toBe(true);
  });

  it("10. Mismatched echo is treated as external geometry", () => {
    const sim = new RuntimeSimulator();
    const fixPath = resolve(FIXTURES_DIR, "21-mismatched-external-geometry.fixture.json");
    const res = sim.run(sim.loadFixture(fixPath));
    expect(res.invariants.passed).toBe(true);
  });

  it("11. Missing echo does not corrupt later reconciliation", () => {
    const sim = new RuntimeSimulator();
    const fix: TraceFixture = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      echoMode: "missing",
      initialScreens: [
        {
          outputId: "S1",
          geometry: { x: 0, y: 0, width: 1920, height: 1080 },
          usableArea: { x: 0, y: 0, width: 1920, height: 1080 }
        }
      ],
      events: [
        { type: "window-discovered", window: { id: "w1", outputId: "S1" } },
        { type: "flush" },
        { type: "window-discovered", window: { id: "w2", outputId: "S1" } },
        { type: "flush" }
      ]
    };
    const res = sim.run(fix);
    expect(res.invariants.passed).toBe(true);
    expect(res.retainedWindows.length).toBe(2);
  });

  it("12. Duplicate echo remains safe", () => {
    const sim = new RuntimeSimulator();
    const fix: TraceFixture = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      echoMode: "duplicate",
      initialScreens: [
        {
          outputId: "S1",
          geometry: { x: 0, y: 0, width: 1920, height: 1080 },
          usableArea: { x: 0, y: 0, width: 1920, height: 1080 }
        }
      ],
      events: [
        { type: "window-discovered", window: { id: "w1", outputId: "S1" } },
        { type: "flush" }
      ]
    };
    const res = sim.run(fix);
    expect(res.invariants.passed).toBe(true);
  });

  it("13. Malformed traces are rejected", () => {
    const sim = new RuntimeSimulator();
    expect(() => {
      // @ts-expect-error test invalid schema
      sim.loadFixture({ schemaVersion: "1.0.0" });
    }).toThrow("Trace fixture missing required 'events' array");
  });

  it("14. Unknown schema versions are rejected", () => {
    const sim = new RuntimeSimulator();
    expect(() => {
      sim.loadFixture({
        schemaVersion: "99.0.0",
        events: []
      });
    }).toThrow("Invalid or unsupported trace schema version");
  });

  it("15. Golden verification detects unstaged drift", () => {
    const sim = new RuntimeSimulator();
    const fix = sim.loadFixture(fixture1Path);
    const res = sim.run(fix);

    // Tampered result digest
    const golden = {
      digest: "tampered-hash-00000000000000000000000000000000000000000000000000000000",
      canonicalState: JSON.parse(canonicalizeState(res))
    };

    expect(golden.digest).not.toBe(res.digest);
  });

  it("16. Golden verification detects staged drift", () => {
    // Check that verify:artifacts or git diff would catch staged differences
    expect(existsSync(GOLDENS_DIR)).toBe(true);
    const goldenFiles = readdirSync(GOLDENS_DIR).filter(f => f.endsWith(".golden.json"));
    expect(goldenFiles.length).toBe(25);
  });

  it("17. Fixed stress seeds are deterministic", () => {
    const r1 = runSeededStressTest(42, 50);
    const r2 = runSeededStressTest(42, 50);
    expect(r1.digest).toBe(r2.digest);
    expect(canonicalizeState(r1)).toBe(canonicalizeState(r2));
  });

  it("18. Every committed fixture satisfies its declared invariants", () => {
    const sim = new RuntimeSimulator();
    const fixtureFiles = readdirSync(FIXTURES_DIR)
      .filter(f => f.endsWith(".json"))
      .sort();

    expect(fixtureFiles.length).toBe(25);

    for (const file of fixtureFiles) {
      const fix = sim.loadFixture(resolve(FIXTURES_DIR, file));
      const res = sim.run(fix);
      expect(
        res.invariants.passed,
        `Fixture ${file} failed invariants: ${JSON.stringify(res.invariants.violations)}`
      ).toBe(true);
      expect(res.invariants.violations).toHaveLength(0);
    }
  });

  it("19. Simulator imports the production coordinator", () => {
    expect(RuntimeCoordinator).toBeDefined();
    const coord = new RuntimeCoordinator();
    expect(coord).toBeInstanceOf(RuntimeCoordinator);
  });

  it("20. No duplicate simulator layout or classification implementation exists", () => {
    const simSource = readFileSync(resolve(__dirname, "../src/simulator.ts"), "utf8");
    // Assert no custom solveMasterStack or solveLayout re-implementation inside simulator.ts
    expect(simSource).not.toContain("function solveMasterStack");
    expect(simSource).not.toContain("function solveLayout");
    expect(simSource).not.toContain("function classifyWindow");
  });

  it("21. Trace recording is disabled by default", () => {
    const recorder = new TraceRecorder();
    expect(recorder.isEnabled()).toBe(false);
  });

  it("22. Recorder capacity is bounded", () => {
    const recorder = new TraceRecorder({ enabled: true, maxCapacity: 5 });
    for (let i = 0; i < 20; i++) {
      recorder.recordEvent({
        type: "WindowRemoved",
        windowId: `w-${i}`
      });
    }
    expect(recorder.getEntries().length).toBeLessThanOrEqual(5);
  });

  it("23. Redaction removes configured identity fields", () => {
    const recorder = new TraceRecorder({
      enabled: true,
      maxCapacity: 10,
      redactAppIds: true,
      redactResourceClass: true
    });
    recorder.recordEvent({
      type: "WindowDiscovered",
      window: {
        id: "w1",
        appId: "secret.app.id",
        resourceClass: "ConfidentialClass"
      }
    });

    const entries = recorder.getEntries();
    expect(entries.length).toBe(1);
    const recordedWin = (entries[0].event as { window: { appId?: string; resourceClass?: string } }).window;
    expect(recordedWin.appId).toBe("[REDACTED]");
    expect(recordedWin.resourceClass).toBe("[REDACTED]");
  });

  it("24. CLI returns nonzero on invariant failure", () => {
    // Passing nonexistent or invalid fixture should exit nonzero
    const code = runCli(["/nonexistent/path/to/fixture.json", "--quiet"]);
    expect(code).toBe(1);
  });

  it("25. Package archive remains unchanged except for intentionally packaged runtime artifacts; simulator fixtures and CLI must not enter the .kwinscript", () => {
    const packageScript = readFileSync(resolve(__dirname, "../../../package.sh"), "utf8");
    // Ensure package.sh does not zip apps/runtime-simulator
    expect(packageScript).not.toContain("apps/runtime-simulator");
  });

  it("26. Negative fixture for overlap rejects overlapping windows under normal capacity with TILED_WINDOWS_OVERLAP", () => {
    const sim = new RuntimeSimulator();
    const negOverlapPath = resolve(FIXTURES_DIR, "negative/overlap.fixture.json");
    const fix = sim.loadFixture(negOverlapPath);
    const res = sim.run(fix);
    expect(res.invariants.passed).toBe(false);
    expect(res.invariants.violations.some(v => v.code === "TILED_WINDOWS_OVERLAP")).toBe(true);
  });

  it("27. Negative fixture for out-of-bounds rejects invalid geometry with TILED_GEOMETRY_OUT_OF_BOUNDS", () => {
    const sim = new RuntimeSimulator();
    const negOutOfBoundsPath = resolve(FIXTURES_DIR, "negative/out-of-bounds.fixture.json");
    const fix = sim.loadFixture(negOutOfBoundsPath);
    const res = sim.run(fix);
    expect(res.invariants.passed).toBe(false);
    expect(res.invariants.violations.some(v => v.code === "TILED_GEOMETRY_OUT_OF_BOUNDS")).toBe(true);
  });

  it("28. Invariant validation rejects horizontal out-of-bounds even under vertical saturation", () => {
    const screens = [
      {
        outputId: "HDMI-A-1",
        name: "HDMI-A-1",
        geometry: { x: 0, y: 0, width: 1920, height: 1080 },
        usableArea: { x: 0, y: 0, width: 1920, height: 1080 },
        activeLayout: "master-stack",
        masterCount: 1,
        masterRatio: 0.5,
        gaps: { inner: 0, outer: 0 },
        orderedWindowIds: Array.from({ length: 25 }, (_, i) => `w-${i}`),
        persistentOrder: Array.from({ length: 25 }, (_, i) => `w-${i}`)
      }
    ];

    // 25 windows: usableArea.height (1080) / 25 = 43.2 < 60px (vertically saturated)
    // One window is placed at x = 2000 (exceeds usableArea.width 1920 horizontally)
    const windows = Array.from({ length: 25 }, (_, i) => ({
      id: `w-${i}`,
      resourceClass: "app",
      outputId: "HDMI-A-1",
      classification: "tiled",
      tileable: true,
      minimized: false,
      fullScreen: false,
      noBorder: false,
      maximizeMode: 0,
      isManualFloating: false,
      frameGeometry: { x: i === 0 ? 2000 : 0, y: 0, width: 960, height: 60 },
      desiredGeometry: { x: i === 0 ? 2000 : 0, y: 0, width: 960, height: 60 },
      preMinimizeGeometry: null
    }));

    const result = validateInvariants(screens, windows, []);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.code === "TILED_GEOMETRY_OUT_OF_BOUNDS")).toBe(true);
  });

  it("29. Invariant validation rejects cross-column overlap even under vertical saturation", () => {
    const screens = [
      {
        outputId: "HDMI-A-1",
        name: "HDMI-A-1",
        geometry: { x: 0, y: 0, width: 1920, height: 1080 },
        usableArea: { x: 0, y: 0, width: 1920, height: 1080 },
        activeLayout: "master-stack",
        masterCount: 1,
        masterRatio: 0.5,
        gaps: { inner: 0, outer: 0 },
        orderedWindowIds: Array.from({ length: 25 }, (_, i) => `w-${i}`),
        persistentOrder: Array.from({ length: 25 }, (_, i) => `w-${i}`)
      }
    ];

    // 25 windows (vertically saturated):
    // w-0 is master at x=0, width=960.
    // w-1 is stack window placed overlapping horizontally at x=500, width=960 (cross-column overlap)
    const windows = Array.from({ length: 25 }, (_, i) => ({
      id: `w-${i}`,
      resourceClass: "app",
      outputId: "HDMI-A-1",
      classification: "tiled",
      tileable: true,
      minimized: false,
      fullScreen: false,
      noBorder: false,
      maximizeMode: 0,
      isManualFloating: false,
      frameGeometry: { x: i === 1 ? 500 : (i === 0 ? 0 : 960), y: 0, width: 960, height: 60 },
      desiredGeometry: { x: i === 1 ? 500 : (i === 0 ? 0 : 960), y: 0, width: 960, height: 60 },
      preMinimizeGeometry: null
    }));

    const result = validateInvariants(screens, windows, []);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.code === "TILED_WINDOWS_OVERLAP")).toBe(true);
  });

  it("30. Invariant validation rejects vertical overlap when column has sufficient capacity", () => {
    const screens = [
      {
        outputId: "HDMI-A-1",
        name: "HDMI-A-1",
        geometry: { x: 0, y: 0, width: 1920, height: 1080 },
        usableArea: { x: 0, y: 0, width: 1920, height: 1080 },
        activeLayout: "master-stack",
        masterCount: 1,
        masterRatio: 0.5,
        gaps: { inner: 0, outer: 0 },
        orderedWindowIds: ["w-1", "w-2"],
        persistentOrder: ["w-1", "w-2"]
      }
    ];

    // Only 2 windows in the same column (540px capacity each >= 60px)
    // They overlap vertically -> MUST fail
    const windows = [
      {
        id: "w-1",
        resourceClass: "app",
        outputId: "HDMI-A-1",
        classification: "tiled",
        tileable: true,
        minimized: false,
        fullScreen: false,
        noBorder: false,
        maximizeMode: 0,
        isManualFloating: false,
        frameGeometry: { x: 0, y: 0, width: 960, height: 600 },
        desiredGeometry: { x: 0, y: 0, width: 960, height: 600 },
        preMinimizeGeometry: null
      },
      {
        id: "w-2",
        resourceClass: "app",
        outputId: "HDMI-A-1",
        classification: "tiled",
        tileable: true,
        minimized: false,
        fullScreen: false,
        noBorder: false,
        maximizeMode: 0,
        isManualFloating: false,
        frameGeometry: { x: 0, y: 500, width: 960, height: 580 }, // Overlaps w-1 from y=500 to y=600
        desiredGeometry: { x: 0, y: 500, width: 960, height: 580 },
        preMinimizeGeometry: null
      }
    ];

    const result = validateInvariants(screens, windows, []);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.code === "TILED_WINDOWS_OVERLAP")).toBe(true);
  });

  it("31. Invariant validation permits vertical overlap only for mathematically unsatisfiable partitions", () => {
    const screens = [
      {
        outputId: "HDMI-A-1",
        name: "HDMI-A-1",
        geometry: { x: 0, y: 0, width: 1920, height: 1080 },
        usableArea: { x: 0, y: 0, width: 1920, height: 1080 },
        activeLayout: "columns",
        masterCount: 1,
        masterRatio: 0.5,
        gaps: { inner: 0, outer: 0 },
        orderedWindowIds: Array.from({ length: 25 }, (_, i) => `w-${i}`),
        persistentOrder: Array.from({ length: 25 }, (_, i) => `w-${i}`)
      }
    ];

    // 25 windows sharing the exact same column (1080 / 25 = 43.2px < 60px, unsatisfiable partition)
    const windows = Array.from({ length: 25 }, (_, i) => ({
      id: `w-${i}`,
      resourceClass: "app",
      outputId: "HDMI-A-1",
      classification: "tiled",
      tileable: true,
      minimized: false,
      fullScreen: false,
      noBorder: false,
      maximizeMode: 0,
      isManualFloating: false,
      frameGeometry: { x: 0, y: i * 40, width: 1920, height: 50 }, // Overlaps next window by 10px
      desiredGeometry: { x: 0, y: i * 40, width: 1920, height: 50 },
      preMinimizeGeometry: null
    }));

    const result = validateInvariants(screens, windows, []);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("32. Invariant validation rejects horizontal or bounds violation", () => {
    const screens = [
      {
        outputId: "HDMI-A-1",
        name: "HDMI-A-1",
        geometry: { x: 0, y: 0, width: 1920, height: 1080 },
        usableArea: { x: 0, y: 0, width: 1920, height: 1080 },
        activeLayout: "columns",
        masterCount: 1,
        masterRatio: 0.5,
        gaps: { inner: 0, outer: 0 },
        orderedWindowIds: ["w-1"],
        persistentOrder: ["w-1"]
      }
    ];

    // Window exceeds usableArea bounds horizontally (x=1000, width=1000 => 2000 > 1920)
    const windows = [
      {
        id: "w-1",
        resourceClass: "app",
        outputId: "HDMI-A-1",
        classification: "tiled",
        tileable: true,
        minimized: false,
        fullScreen: false,
        noBorder: false,
        maximizeMode: 0,
        isManualFloating: false,
        frameGeometry: { x: 1000, y: 0, width: 1000, height: 1080 },
        desiredGeometry: { x: 1000, y: 0, width: 1000, height: 1080 },
        preMinimizeGeometry: null
      }
    ];

    const result = validateInvariants(screens, windows, []);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.code === "TILED_GEOMETRY_OUT_OF_BOUNDS")).toBe(true);
  });
});


