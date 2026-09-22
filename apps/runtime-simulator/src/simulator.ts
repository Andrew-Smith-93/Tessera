import { readFileSync } from "node:fs";
import {
  RuntimeCoordinator,
  LogicalClock,
  TraceRecorder,
  computeSnapZones,
  type RetainedScreenState,
  type RetainedWindowState,
  type GeometryOperation
} from "@tessera/kwin-adapter";
import type { Rect } from "@tessera/protocol";
import type {
  TraceFixture,
  SimulationResult,
  SerializableRetainedScreen,
  SerializableRetainedWindow,
  SerializableTransaction,
  SimulationDiagnostics
} from "./types.js";
import { TRACE_SCHEMA_VERSION } from "./types.js";
import { SimulatedKWinSession } from "./session.js";
import { validateInvariants } from "./invariants.js";
import { canonicalizeState, computeDigest } from "./canonical.js";

export class RuntimeSimulator {
  private fixture: TraceFixture | null = null;
  private readonly tolerancePx: number;

  constructor(options?: { tolerancePx?: number }) {
    this.tolerancePx = options?.tolerancePx ?? 1;
  }

  public loadFixture(fixtureOrPath: TraceFixture | string): TraceFixture {
    let fixture: TraceFixture;

    if (typeof fixtureOrPath === "string") {
      try {
        const fileContent = readFileSync(fixtureOrPath, "utf8");
        fixture = JSON.parse(fileContent);
      } catch (err: unknown) {
        throw new Error(
          `Failed to load trace fixture from "${fixtureOrPath}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    } else {
      fixture = fixtureOrPath;
    }

    if (!fixture || typeof fixture !== "object") {
      throw new Error("Trace fixture must be a valid JSON object");
    }

    if (fixture.schemaVersion !== TRACE_SCHEMA_VERSION) {
      throw new Error(
        `Invalid or unsupported trace schema version: expected "${TRACE_SCHEMA_VERSION}", received "${fixture.schemaVersion}"`
      );
    }

    if (!Array.isArray(fixture.events)) {
      throw new Error("Trace fixture missing required 'events' array");
    }

    this.fixture = fixture;
    return fixture;
  }

  public run(fixtureInput?: TraceFixture): SimulationResult {
    const fixture = fixtureInput ?? this.fixture;
    if (!fixture) {
      throw new Error("No trace fixture loaded to run");
    }

    if (fixture.schemaVersion !== TRACE_SCHEMA_VERSION) {
      throw new Error(
        `Invalid or unsupported trace schema version: expected "${TRACE_SCHEMA_VERSION}", received "${fixture.schemaVersion}"`
      );
    }

    const clock = new LogicalClock(0);
    const traceRecorder = new TraceRecorder({ maxCapacity: 2000 });
    const coordinator = new RuntimeCoordinator(fixture.initialConfig, clock, traceRecorder);
    const session = new SimulatedKWinSession(fixture.echoMode ?? "immediate", fixture.echoDelayTicks ?? 2);

    const transactions: SerializableTransaction[] = [];
    let previewOnlyOperations = 0;
    let committedSnapOperations = 0;

    // Helper to perform reconciliation and record transaction
    const performReconciliation = () => {
      const tx = coordinator.reconcile();
      if (tx) {
        const serializableTx: SerializableTransaction = {
          epoch: tx.epoch,
          tick: clock.now(),
          reasons: [...tx.reasons],
          affectedScreens: [...tx.affectedScreens],
          operations: tx.operations.map((op: GeometryOperation) => ({
            windowId: op.windowId,
            targetRect: { ...op.targetRect },
            previousRect: op.previousRect ? { ...op.previousRect } : undefined
          })),
          skippedWrites: tx.skippedWrites
        };
        transactions.push(serializableTx);
        session.applyOperations(serializableTx.operations, clock.now(), coordinator, serializableTx.epoch);
      }
    };

    // 1. Initialize screens
    if (fixture.initialScreens) {
      for (const scr of fixture.initialScreens) {
        coordinator.getOrCreateScreen(scr);
      }
    }

    // 2. Initialize windows
    if (fixture.initialWindows) {
      for (const win of fixture.initialWindows) {
        coordinator.ingestEvent({
          type: "WindowDiscovered",
          window: win
        });
        session.registerWindow(
          win.id,
          win.frameGeometry ?? { x: 0, y: 0, width: 800, height: 600 }
        );
      }
    }

    // Initial reconciliation if initial state was dirty
    performReconciliation();

    // 3. Process ordered trace events
    for (const event of fixture.events) {
      // Clock advancement
      if (event.tick !== undefined && event.tick > clock.now()) {
        clock.set(event.tick);
        session.flushQueuedEchoes(clock.now(), coordinator);
      }

      if (event.deltaTicks !== undefined && event.deltaTicks > 0) {
        clock.advance(event.deltaTicks);
        session.flushQueuedEchoes(clock.now(), coordinator);
      }

      switch (event.type) {
        case "window-discovered": {
          if (!event.window) break;
          coordinator.ingestEvent({
            type: "WindowDiscovered",
            window: event.window
          });
          session.registerWindow(
            event.window.id,
            event.window.frameGeometry ?? { x: 0, y: 0, width: 800, height: 600 }
          );
          break;
        }

        case "window-removed": {
          if (!event.windowId) break;
          coordinator.ingestEvent({
            type: "WindowRemoved",
            windowId: event.windowId
          });
          session.unregisterWindow(event.windowId);
          break;
        }

        case "geometry-change": {
          if (!event.windowId || !event.geometry) break;
          coordinator.ingestEvent({
            type: "WindowGeometryChanged",
            windowId: event.windowId,
            geometry: event.geometry,
            timestamp: clock.now()
          });
          session.setWindowGeometry(event.windowId, event.geometry);
          break;
        }

        case "fullscreen-change": {
          if (!event.windowId) break;
          coordinator.ingestEvent({
            type: "WindowStateChanged",
            windowId: event.windowId,
            updates: { fullScreen: event.fullScreen }
          });
          break;
        }

        case "no-border-change": {
          if (!event.windowId) break;
          coordinator.ingestEvent({
            type: "WindowStateChanged",
            windowId: event.windowId,
            updates: { noBorder: event.noBorder }
          });
          break;
        }

        case "maximize-change": {
          if (!event.windowId) break;
          coordinator.ingestEvent({
            type: "WindowStateChanged",
            windowId: event.windowId,
            updates: { maximizeMode: event.maximizeMode }
          });
          break;
        }

        case "minimize-change": {
          if (!event.windowId) break;
          coordinator.ingestEvent({
            type: "WindowStateChanged",
            windowId: event.windowId,
            updates: { minimized: event.minimized }
          });
          break;
        }

        case "output-move": {
          if (!event.windowId || !event.fromOutputId || !event.toOutputId) break;
          coordinator.ingestEvent({
            type: "WindowMovedOutput",
            windowId: event.windowId,
            fromOutputId: event.fromOutputId,
            toOutputId: event.toOutputId
          });
          break;
        }

        case "desktop-move": {
          if (!event.windowId || !event.toDesktopId) break;
          coordinator.ingestEvent({
            type: "WindowMovedDesktop",
            windowId: event.windowId,
            fromDesktopId: event.fromDesktopId ?? "1",
            toDesktopId: event.toDesktopId
          });
          break;
        }

        case "screen-added": {
          if (!event.screen) break;
          coordinator.getOrCreateScreen(event.screen);
          coordinator.markScreenDirty(event.screen.outputId, "ScreenAdded");
          break;
        }

        case "screen-removed": {
          if (!event.outputId) break;
          const remainingScreens = coordinator
            .getRetainedScreens()
            .map((s: RetainedScreenState) => ({
              outputId: s.outputId,
              name: s.name,
              geometry: s.geometry,
              usableArea: s.usableArea
            }))
            .filter((s: { outputId: string }) => s.outputId !== event.outputId);
          coordinator.ingestEvent({
            type: "ScreenTopologyChanged",
            screens: remainingScreens
          });
          break;
        }

        case "screen-geometry-change": {
          if (!event.outputId || !event.screen) break;
          const scr = coordinator.getRetainedScreen(event.outputId);
          if (scr) {
            scr.geometry = { ...event.screen.geometry };
            scr.usableArea = { ...event.screen.usableArea };
            coordinator.markScreenDirty(event.outputId, "ScreenGeometryChanged");
          }
          break;
        }

        case "layout-change": {
          if (!event.outputId || !event.layout) break;
          coordinator.ingestEvent({
            type: "ScreenLayoutChanged",
            outputId: event.outputId,
            layout: event.layout
          });
          break;
        }

        case "gap-change": {
          if (!event.outputId) break;
          coordinator.ingestEvent({
            type: "ScreenGapsChanged",
            outputId: event.outputId,
            gaps: {
              inner: event.gapInner ?? 8,
              outer: event.gapOuter ?? 10
            }
          });
          break;
        }

        case "master-count-change": {
          if (!event.outputId) break;
          coordinator.ingestEvent({
            type: "ScreenMasterConfigChanged",
            outputId: event.outputId,
            count: event.count
          });
          break;
        }

        case "master-ratio-change": {
          if (!event.outputId) break;
          coordinator.ingestEvent({
            type: "ScreenMasterConfigChanged",
            outputId: event.outputId,
            ratio: event.ratio
          });
          break;
        }

        case "rules-config-change": {
          if (!event.config) break;
          coordinator.ingestEvent({
            type: "GlobalConfigChanged",
            config: event.config
          });
          break;
        }

        case "cursor-position-update":
        case "snap-preview": {
          previewOnlyOperations++;
          break;
        }

        case "snap-commit": {
          committedSnapOperations++;
          const targetScreen = event.outputId
            ? coordinator.getRetainedScreen(event.outputId)
            : coordinator.getRetainedScreens()[0];
          if (!targetScreen) break;

          const windowId = event.windowId || (coordinator.getRetainedWindows()[0]?.id);
          if (!windowId) break;

          let targetRect: Rect;
          let slotIndex = 0;
          if (event.geometry) {
            targetRect = event.geometry;
          } else {
            const zones = computeSnapZones(
              targetScreen.usableArea,
              targetScreen.gaps.outer,
              targetScreen.gaps.inner
            );
            const zoneIdx =
              event.zoneIndex !== undefined && event.zoneIndex >= 0 && event.zoneIndex < zones.length
                ? event.zoneIndex
                : 1;
            const selectedZone = zones[zoneIdx];
            targetRect = selectedZone.targetRect;
            slotIndex = selectedZone.slotIndex;
          }

          const tx = coordinator.applySnapCommit(
            windowId,
            targetScreen.outputId,
            targetRect,
            slotIndex
          );
          if (tx && tx.operations.length > 0) {
            const serializableTx: SerializableTransaction = {
              epoch: tx.epoch,
              tick: clock.now(),
              reasons: [...tx.reasons],
              affectedScreens: [...tx.affectedScreens],
              operations: tx.operations.map((op: GeometryOperation) => ({
                windowId: op.windowId,
                targetRect: { ...op.targetRect },
                previousRect: op.previousRect ? { ...op.previousRect } : undefined
              })),
              skippedWrites: tx.skippedWrites
            };
            transactions.push(serializableTx);
            session.applyOperations(serializableTx.operations, clock.now(), coordinator, serializableTx.epoch);
          }
          break;
        }

        case "flush": {
          performReconciliation();
          break;
        }

        case "advance-clock": {
          // Handled above or default +1
          if (!event.deltaTicks) {
            clock.advance(1);
            session.flushQueuedEchoes(clock.now(), coordinator);
          }
          break;
        }
      }
    }

    // Final reconciliation pass to ensure any dirty states or queued echoes settle
    session.flushQueuedEchoes(clock.now(), coordinator);
    performReconciliation();

    // Map retained screens
    const retainedScreens: SerializableRetainedScreen[] = coordinator
      .getRetainedScreens()
      .map((s: RetainedScreenState) => ({
        outputId: s.outputId,
        name: s.name,
        geometry: { ...s.geometry },
        usableArea: { ...s.usableArea },
        activeLayout: s.activeLayout,
        masterCount: s.masterCount,
        masterRatio: s.masterRatio,
        gaps: { ...s.gaps },
        orderedWindowIds: [...s.orderedWindowIds],
        persistentOrder: [...s.persistentOrder]
      }));

    // Map retained windows
    const retainedWindows: SerializableRetainedWindow[] = coordinator
      .getRetainedWindows()
      .map((w: RetainedWindowState) => ({
        id: w.id,
        resourceClass: w.resourceClass,
        outputId: w.outputId,
        classification: w.classification,
        tileable: w.tileable,
        minimized: w.minimized,
        fullScreen: w.fullScreen,
        noBorder: w.noBorder,
        maximizeMode: w.maximizeMode,
        isManualFloating: w.isManualFloating,
        frameGeometry: { ...w.frameGeometry },
        desiredGeometry: w.currentDesiredTiledGeometry
          ? { ...w.currentDesiredTiledGeometry }
          : null,
        preMinimizeGeometry: w.preMinimizeGeometry
          ? { ...w.preMinimizeGeometry }
          : null,
        outputAffinity: w.outputAffinity
      }));

    // Diagnostics
    const diag = coordinator.getDiagnostics();
    const diagnostics: SimulationDiagnostics = {
      totalEvents: fixture.events.length,
      totalTransactions: transactions.length,
      totalLayoutComputations: diag.totalLayoutComputations,
      totalGeometryWrites: session.getTotalWrites(),
      skippedWrites: diag.skippedIdenticalWrites,
      suppressedEchoes: diag.suppressedGeometryEchoes,
      previewOnlyOperations,
      committedSnapOperations,
      unaffectedScreensRecomputed: 0
    };

    // Invariant validation
    const invariants = validateInvariants(
      retainedScreens,
      retainedWindows,
      transactions,
      { tolerancePx: this.tolerancePx }
    );

    const result: SimulationResult = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      fixtureName: fixture.name,
      finalTick: clock.now(),
      retainedScreens,
      retainedWindows,
      transactions,
      diagnostics,
      invariants,
      digest: ""
    };

    const canonicalJson = canonicalizeState(result);
    result.digest = computeDigest(canonicalJson);

    return result;
  }
}
