import type { NormalizedEvent, NormalizedWindowInput } from "./coordinator-types.js";

export interface TraceRecorderOptions {
  readonly enabled?: boolean;
  readonly maxCapacity?: number;
  readonly recordTitles?: boolean;
  readonly redactAppIds?: boolean;
  readonly redactResourceClass?: boolean;
}

export interface RecordedEventEntry {
  readonly sequence: number;
  readonly timestamp: number;
  readonly event: NormalizedEvent;
}

/**
 * Optional in-memory trace recorder.
 * - Disabled by default.
 * - Bounded capacity (drops oldest or stops recording when full).
 * - Zero disk I/O, zero network access.
 * - Titles omitted unless explicitly requested.
 * - App ID and resourceClass can be redacted.
 */
export class TraceRecorder {
  private enabled: boolean;
  private maxCapacity: number;
  private recordTitles: boolean;
  private redactAppIds: boolean;
  private redactResourceClass: boolean;

  private sequence = 0;
  private readonly buffer: RecordedEventEntry[] = [];

  constructor(options?: TraceRecorderOptions) {
    this.enabled = Boolean(options?.enabled);
    this.maxCapacity = Math.max(1, options?.maxCapacity ?? 1000);
    this.recordTitles = Boolean(options?.recordTitles);
    this.redactAppIds = Boolean(options?.redactAppIds);
    this.redactResourceClass = Boolean(options?.redactResourceClass);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public clear(): void {
    this.buffer.length = 0;
    this.sequence = 0;
  }

  public getRecordedEvents(): readonly RecordedEventEntry[] {
    return [...this.buffer];
  }

  public getEntries(): readonly RecordedEventEntry[] {
    return [...this.buffer];
  }

  public getCapacity(): number {
    return this.maxCapacity;
  }

  public setCapacity(capacity: number): void {
    this.maxCapacity = Math.max(1, capacity);
    while (this.buffer.length > this.maxCapacity) {
      this.buffer.shift();
    }
  }

  private sanitizeWindowInput(win: NormalizedWindowInput): NormalizedWindowInput {
    const copy: NormalizedWindowInput = { ...win };
    if (!this.recordTitles) {
      delete copy.title;
    }
    if (this.redactAppIds && copy.appId) {
      copy.appId = "[REDACTED]";
    }
    if (this.redactResourceClass && copy.resourceClass) {
      copy.resourceClass = "[REDACTED]";
    }
    return copy;
  }

  private sanitizeEvent(event: NormalizedEvent): NormalizedEvent {
    if (event.type === "WindowDiscovered") {
      return {
        type: "WindowDiscovered",
        window: this.sanitizeWindowInput(event.window)
      };
    }
    if (event.type === "WindowStateChanged") {
      const updates = { ...event.updates };
      if (!this.recordTitles) {
        delete updates.title;
      }
      if (this.redactAppIds && updates.appId) {
        updates.appId = "[REDACTED]";
      }
      if (this.redactResourceClass && updates.resourceClass) {
        updates.resourceClass = "[REDACTED]";
      }
      return {
        type: "WindowStateChanged",
        windowId: event.windowId,
        updates
      };
    }
    return event;
  }

  public recordEvent(event: NormalizedEvent, timestamp: number): void {
    if (!this.enabled) return;

    if (this.buffer.length >= this.maxCapacity) {
      this.buffer.shift(); // Bound capacity by evicting oldest
    }

    this.buffer.push({
      sequence: ++this.sequence,
      timestamp,
      event: this.sanitizeEvent(event)
    });
  }
}
