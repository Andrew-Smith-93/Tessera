import { describe, it, expect, beforeEach } from "vitest";
import {
  ReferenceServer,
  ReferenceClient,
  ProtocolErrorCode,
  type CoordinatorRuntimeTarget
} from "../src/index.js";

describe("Tessera Protocol V1 Reference Endpoint & Command Queue", () => {
  let mockRuntime: CoordinatorRuntimeTarget;
  let mockConfig: Record<string, unknown>;
  let mockScreens: any[];
  let mockWindows: any[];
  let mockTraceEntries: any[];
  let traceEnabled = false;

  beforeEach(() => {
    mockConfig = {
      enableTiling: true,
      defaultLayout: "master-stack",
      gapInner: 8,
      gapOuter: 10,
      masterRatio: 0.5,
      masterCount: 1,
      redactIdentities: false
    };

    mockScreens = [
      {
        outputId: "HDMI-A-1",
        name: "HDMI-A-1",
        geometry: { x: 0, y: 0, width: 1920, height: 1080 },
        usableArea: { x: 0, y: 0, width: 1920, height: 1080 },
        activeLayout: "master-stack",
        masterCount: 1,
        masterRatio: 0.5,
        gaps: { inner: 8, outer: 10 },
        orderedWindowIds: ["win-1"],
        persistentOrder: ["win-1"]
      }
    ];

    mockWindows = [
      {
        id: "win-1",
        title: "Secret User Document",
        resourceClass: "kitty",
        resourceName: "terminal",
        appId: "kitty.desktop",
        desktopFileName: "kitty.desktop",
        role: "terminal-window",
        outputId: "HDMI-A-1",
        classification: "tiled",
        tileable: true,
        minimized: false,
        fullScreen: false,
        noBorder: false,
        maximizeMode: 0,
        isManualFloating: false,
        frameGeometry: { x: 10, y: 10, width: 946, height: 1060 },
        currentDesiredTiledGeometry: { x: 10, y: 10, width: 946, height: 1060 },
        preMinimizeGeometry: null,
        outputAffinity: "HDMI-A-1"
      }
    ];

    mockTraceEntries = [
      { tick: 1, event: { type: "WindowDiscovered", windowId: "win-1" } }
    ];
    traceEnabled = false;

    mockRuntime = {
      getRetainedScreens: () => mockScreens,
      getRetainedWindows: () => mockWindows,
      getRetainedScreen: (outputId: string) => mockScreens.find(s => s.outputId === outputId),
      reconcile: (_forceScreenId?: string) => ({
        epoch: 1,
        reasons: ["TestReconcile"],
        affectedScreens: ["HDMI-A-1"],
        operations: [{ windowId: "win-1", targetRect: { x: 10, y: 10, width: 946, height: 1060 } }],
        skippedWrites: 0
      }),
      getDiagnostics: () => ({
        totalEvents: 5,
        totalTransactions: 1,
        totalGeometryWrites: 1
      }),
      getConfig: () => mockConfig,
      updateConfig: (cfg: any) => {
        Object.assign(mockConfig, cfg);
      },
      setLayout: (outputId: string, layout: string) => {
        const screen = mockScreens.find(s => s.outputId === outputId);
        if (screen) screen.activeLayout = layout;
      },
      setMasterCount: (outputId: string, count: number) => {
        const screen = mockScreens.find(s => s.outputId === outputId);
        if (screen) screen.masterCount = count;
      },
      setMasterRatio: (outputId: string, ratio: number) => {
        const screen = mockScreens.find(s => s.outputId === outputId);
        if (screen) screen.masterRatio = ratio;
      },
      setWindowFloating: (windowId: string, floating: boolean) => {
        const win = mockWindows.find(w => w.id === windowId);
        if (win) {
          win.isManualFloating = floating;
          win.tileable = !floating;
        }
      },
      getTraceRecorder: () => ({
        isEnabled: () => traceEnabled,
        getEntries: () => mockTraceEntries,
        clear: () => {
          const count = mockTraceEntries.length;
          mockTraceEntries = [];
          return count;
        }
      })
    };
  });

  it("1. Unnegotiated method call fails with CAPABILITY_NOT_NEGOTIATED", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server);

    await expect(
      client.sendRequest("config.get")
    ).rejects.toMatchObject({
      code: ProtocolErrorCode.CAPABILITY_NOT_NEGOTIATED
    });
  });

  it("2. system.hello negotiates version range and capabilities", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server);

    // Major version mismatch is rejected
    await expect(
      client.sendRequest("system.hello", {
        clientName: "bad-client",
        clientVersion: "1.0",
        minMajor: 2,
        maxMajor: 2
      })
    ).rejects.toMatchObject({
      code: ProtocolErrorCode.UNSUPPORTED_MAJOR_VERSION
    });

    // Valid handshake negotiates highest minor version and granted capabilities
    const res = await client.hello("good-client", "1.0.0", ["state.inspect", "config.mutate"]);
    expect(res.serverName).toBe("tessera-runtime");
    expect(res.negotiatedMajor).toBe(1);
    expect(res.negotiatedMinor).toBe(0);
    expect(res.capabilities).toEqual(["state.inspect", "config.mutate"]);
  });

  it("3. Mutation acknowledgement does NOT synchronously run layout", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server);
    await client.hello("test-cli", "1.0.0", ["config.mutate", "runtime.control"]);

    let layoutRun = false;
    mockRuntime.reconcile = () => {
      layoutRun = true;
      return null;
    };

    // Send mutation command
    const ack = await client.sendRequest<{ acknowledged: boolean; stateRevision: number }>(
      "config.applyPatch",
      { patch: { gapInner: 14 } }
    );

    // Acknowledged immediately
    expect(ack.acknowledged).toBe(true);
    expect(ack.stateRevision).toBe(2);

    // Layout has NOT executed synchronously!
    expect(layoutRun).toBe(false);
    expect(server.getPendingCommandCount()).toBe(1);
    // Config not yet applied
    expect(mockConfig.gapInner).toBe(8);

    // Advance runtime
    const advanceResult = server.advance();
    expect(advanceResult.processedCommands).toBe(1);
    expect(layoutRun).toBe(true);
    expect(mockConfig.gapInner).toBe(14);
    expect(server.getCurrentRevision()).toBe(2);
  });

  it("4. Stale expected revision returns REVISION_CONFLICT", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server);
    await client.hello("test-cli", "1.0.0", ["config.mutate"]);

    // Current revision is 1, but client expects revision 99
    await expect(
      client.sendRequest("config.applyPatch", {
        patch: { gapInner: 16 },
        expectedRevision: 99
      })
    ).rejects.toMatchObject({
      code: ProtocolErrorCode.REVISION_CONFLICT
    });
  });

  it("5. Duplicate idempotency key does not apply mutation twice", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server);
    await client.hello("test-cli", "1.0.0", ["config.mutate"]);

    const key = "idem-key-abc";
    const res1 = await client.sendRequest<{ acknowledged: boolean; commandId: string }>(
      "config.applyPatch",
      { patch: { gapInner: 16 }, idempotencyKey: key }
    );

    expect(server.getPendingCommandCount()).toBe(1);

    // Second call with same idempotency key
    const res2 = await client.sendRequest<{ acknowledged: boolean; commandId: string }>(
      "config.applyPatch",
      { patch: { gapInner: 16 }, idempotencyKey: key }
    );

    expect(res2.commandId).toBe(res1.commandId);
    // Did not enqueue a second command
    expect(server.getPendingCommandCount()).toBe(1);
  });

  it("6. Redaction policy strips all 6 protected identity fields when enabled", async () => {
    mockConfig.redactIdentities = true;
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server);
    await client.hello("test-cli", "1.0.0", ["state.inspect"]);

    const snap = await client.sendRequest<{ windows: any[] }>("state.getSnapshot");
    const win = snap.windows[0];

    expect(win.title).toBeUndefined();
    expect(win.resourceClass).toBe("[REDACTED]");
    expect(win.resourceName).toBe("[REDACTED]");
    expect(win.appId).toBe("[REDACTED]");
    expect(win.desktopFileName).toBe("[REDACTED]");
    expect(win.role).toBe("[REDACTED]");
  });

  it("7. Trace getRecent returns TRACE_DISABLED when recording is inactive", async () => {
    traceEnabled = false;
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server);
    await client.hello("test-cli", "1.0.0", ["trace.inspect"]);

    await expect(
      client.sendRequest("trace.getRecent")
    ).rejects.toMatchObject({
      code: ProtocolErrorCode.TRACE_DISABLED
    });

    // When enabled, it returns entries
    traceEnabled = true;
    const res = await client.sendRequest<{ entries: any[] }>("trace.getRecent");
    expect(res.entries).toHaveLength(1);
  });

  it("8. Streaming client decoders are isolated per-session", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client1 = new ReferenceClient(server, "client-1");
    const client2 = new ReferenceClient(server, "client-2");

    // Client 1 sends partial chunk
    await server.processBytes(new Uint8Array([0x00, 0x00]), "client-1");

    // Client 2 sends a complete hello request over wire
    const res = await client2.sendRequestOverWire<any>("system.hello", {
      clientName: "wire-c2",
      clientVersion: "1.0",
      minMajor: 1,
      maxMajor: 1
    });

    expect(res.serverName).toBe("tessera-runtime");
    // Client 1 buffer is not corrupted
    const session1 = server.getSession("client-1");
    expect(session1.decoder.getPendingBytes()).toBe(2);
  });

  it("9. Asynchronous event subscription and notification delivery", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server);

    const received: any[] = [];
    const unsub = client.onEvent("runtime.transactionCommitted", (data: any) => {
      received.push(data);
    });

    server.emitEvent("runtime.transactionCommitted", { epoch: 10 });
    expect(received).toHaveLength(1);
    expect(received[0].epoch).toBe(10);

    unsub();
    server.emitEvent("runtime.transactionCommitted", { epoch: 11 });
    expect(received).toHaveLength(1);
  });

  it("10. Disconnecting client removes session without affecting runtime", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server, "temp-client");
    await client.hello("temp", "1.0");

    expect(server.getSession("temp-client").helloCompleted).toBe(true);
    client.dispose();

    // Session cleaned up
    expect(server.getSession("temp-client").helloCompleted).toBe(false);
  });
});
