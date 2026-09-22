import type { Rect, RuntimeWindowId } from "@tessera/protocol";
import type { RuntimeCoordinator } from "@tessera/kwin-adapter";
import type {
  SimulatedEchoMode,
  SerializableGeometryOperation
} from "./types.js";

interface QueuedEcho {
  deliverAtTick: number;
  windowId: RuntimeWindowId;
  geometry: Rect;
  duplicateCount?: number;
}

export class SimulatedKWinSession {
  private readonly windows = new Map<RuntimeWindowId, { geometry: Rect }>();
  private readonly echoMode: SimulatedEchoMode;
  private readonly echoDelayTicks: number;
  private readonly queuedEchoes: QueuedEcho[] = [];
  private totalWrites = 0;

  constructor(echoMode: SimulatedEchoMode = "immediate", echoDelayTicks = 2) {
    this.echoMode = echoMode;
    this.echoDelayTicks = echoDelayTicks;
  }

  public registerWindow(id: RuntimeWindowId, initialGeometry: Rect): void {
    this.windows.set(id, { geometry: { ...initialGeometry } });
  }

  public unregisterWindow(id: RuntimeWindowId): void {
    this.windows.delete(id);
  }

  public getWindowGeometry(id: RuntimeWindowId): Rect | undefined {
    const win = this.windows.get(id);
    return win ? { ...win.geometry } : undefined;
  }

  public setWindowGeometry(id: RuntimeWindowId, geometry: Rect): void {
    this.windows.set(id, { geometry: { ...geometry } });
  }

  public getTotalWrites(): number {
    return this.totalWrites;
  }

  public applyOperations(
    operations: readonly SerializableGeometryOperation[],
    currentTick: number,
    coordinator: RuntimeCoordinator,
    epoch: number
  ): void {
    for (const op of operations) {
      this.totalWrites++;
      coordinator.recordCommand(op.windowId, op.targetRect, epoch);
      this.windows.set(op.windowId, { geometry: { ...op.targetRect } });

      switch (this.echoMode) {
        case "immediate":
          coordinator.ingestEvent({
            type: "WindowGeometryChanged",
            windowId: op.windowId,
            geometry: op.targetRect,
            timestamp: currentTick
          });
          break;

        case "delayed":
          this.queuedEchoes.push({
            deliverAtTick: currentTick + this.echoDelayTicks,
            windowId: op.windowId,
            geometry: { ...op.targetRect }
          });
          break;

        case "missing":
          // Deliberately drop echo: coordinator never hears back
          break;

        case "mismatched": {
          // Window manager or client enforced different geometry
          const mismatched: Rect = {
            x: op.targetRect.x + 20,
            y: op.targetRect.y + 20,
            width: op.targetRect.width - 40,
            height: op.targetRect.height - 40
          };
          coordinator.ingestEvent({
            type: "WindowGeometryChanged",
            windowId: op.windowId,
            geometry: mismatched,
            timestamp: currentTick
          });
          break;
        }

        case "duplicate":
          // Send immediately twice
          coordinator.ingestEvent({
            type: "WindowGeometryChanged",
            windowId: op.windowId,
            geometry: op.targetRect,
            timestamp: currentTick
          });
          coordinator.ingestEvent({
            type: "WindowGeometryChanged",
            windowId: op.windowId,
            geometry: op.targetRect,
            timestamp: currentTick
          });
          break;
      }
    }
  }

  /**
   * Delivers any queued echoes whose deliverAtTick <= currentTick.
   */
  public flushQueuedEchoes(currentTick: number, coordinator: RuntimeCoordinator): void {
    const remaining: QueuedEcho[] = [];

    for (const echo of this.queuedEchoes) {
      if (echo.deliverAtTick <= currentTick) {
        coordinator.ingestEvent({
          type: "WindowGeometryChanged",
          windowId: echo.windowId,
          geometry: echo.geometry,
          timestamp: currentTick
        });
      } else {
        remaining.push(echo);
      }
    }

    this.queuedEchoes.length = 0;
    this.queuedEchoes.push(...remaining);
  }
}
