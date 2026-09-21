import type { Rect, RuntimeWindowId } from "@tessera/protocol";
import { rectEquals } from "@tessera/layout-core";

interface InFlightEntry {
  target: Rect;
  timestamp: number;
}

export class EchoFilter {
  private readonly inFlight = new Map<RuntimeWindowId, InFlightEntry>();
  private readonly maxAgeMs: number;

  constructor(maxAgeMs: number = 300) {
    this.maxAgeMs = maxAgeMs;
  }

  /**
   * Records an intended programmatic geometry change.
   */
  public recordCommand(windowId: RuntimeWindowId, target: Rect): void {
    this.inFlight.set(windowId, {
      target,
      timestamp: Date.now()
    });
  }

  /**
   * Checks if an incoming geometry change event is an echo of a programmatic change.
   * If it matches within the time window, consumes the record and returns true.
   */
  public isEcho(windowId: RuntimeWindowId, current: Rect): boolean {
    const entry = this.inFlight.get(windowId);
    if (!entry) return false;

    const elapsed = Date.now() - entry.timestamp;
    if (elapsed > this.maxAgeMs) {
      this.inFlight.delete(windowId);
      return false;
    }

    if (rectEquals(entry.target, current)) {
      this.inFlight.delete(windowId);
      return true;
    }

    return false;
  }

  /**
   * Cleans up expired entries to avoid memory retention.
   */
  public purgeStale(): void {
    const now = Date.now();
    for (const [id, entry] of this.inFlight.entries()) {
      if (now - entry.timestamp > this.maxAgeMs) {
        this.inFlight.delete(id);
      }
    }
  }

  public clear(): void {
    this.inFlight.clear();
  }
}
