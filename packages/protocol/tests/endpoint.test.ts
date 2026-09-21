import { describe, it, expect, beforeEach } from "vitest";
import {
  ReferenceServer,
  ReferenceClient,
  ProtocolErrorCode,
  encodeFrame,
  type CoordinatorRuntimeTarget,
  type ProtocolRequest,
  type StateCapabilitiesResult,
  type RuntimeCommandAckResult
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
    await client.hello("test-client", "1.0");

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

  it("11. Per-session event subscriptions filter events per client", async () => {
    const server = new ReferenceServer(mockRuntime);
    const clientA = new ReferenceClient(server, "client-A");
    const clientB = new ReferenceClient(server, "client-B");

    await clientA.hello("Client A", "1.0");
    await clientB.hello("Client B", "1.0");

    // Client A subscribes only to runtime.stateChanged
    await clientA.unsubscribe([
      "runtime.ready",
      "runtime.transactionCommitted",
      "runtime.configurationChanged",
      "runtime.capabilitiesChanged",
      "runtime.warning"
    ]);

    // Client B subscribes only to runtime.warning
    await clientB.unsubscribe([
      "runtime.ready",
      "runtime.stateChanged",
      "runtime.transactionCommitted",
      "runtime.configurationChanged",
      "runtime.capabilitiesChanged"
    ]);

    const eventsA: unknown[] = [];
    const eventsB: unknown[] = [];

    clientA.onEvent("runtime.stateChanged", data => eventsA.push(data));
    clientA.onEvent("runtime.warning", data => eventsA.push(data));

    clientB.onEvent("runtime.stateChanged", data => eventsB.push(data));
    clientB.onEvent("runtime.warning", data => eventsB.push(data));

    server.emitEvent("runtime.stateChanged", { tick: 1 });
    server.emitEvent("runtime.warning", { code: "WARN_TEST", message: "Warning test" });

    expect(eventsA).toHaveLength(1);
    expect((eventsA[0] as { tick: number }).tick).toBe(1);

    expect(eventsB).toHaveLength(1);
    expect((eventsB[0] as { code: string }).code).toBe("WARN_TEST");
  });

  it("12. Subscribing beyond MAX_SUBSCRIPTION_COUNT returns RESOURCE_LIMIT_EXCEEDED", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server, "client-limit");
    await client.hello("Client Limit", "1.0");

    // Try to subscribe to 105 channels
    const tooMany = Array.from({ length: 105 }, (_, i) => `custom.event.${i}`);
    await expect(client.subscribe(tooMany)).rejects.toThrowError();

    const req: ProtocolRequest = {
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-sub-limit",
      method: "system.subscribe",
      params: { events: tooMany }
    };

    const resp = await server.handleRequest(req, "client-limit");
    expect(resp.ok).toBe(false);
    expect(resp.error?.code).toBe(ProtocolErrorCode.RESOURCE_LIMIT_EXCEEDED);
  });

  it("13. Exceeding MAX_QUEUE_LENGTH returns RESOURCE_LIMIT_EXCEEDED", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server, "client-queue");
    await client.hello("Client Queue", "1.0");

    // Fill queue to limit
    for (let i = 0; i < 1000; i++) {
      const resp = await server.handleRequest({
        protocol: "tessera.ipc",
        majorVersion: 1,
        minorVersion: 0,
        kind: "request",
        id: `req-fill-${i}`,
        method: "runtime.requestReconcile",
        params: {}
      }, "client-queue");
      expect(resp.ok).toBe(true);
    }

    // 1001st command should be rejected with RESOURCE_LIMIT_EXCEEDED
    const overflowResp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-overflow",
      method: "runtime.requestReconcile",
      params: {}
    }, "client-queue");

    expect(overflowResp.ok).toBe(false);
    expect(overflowResp.error?.code).toBe(ProtocolErrorCode.RESOURCE_LIMIT_EXCEEDED);
  });

  it("14. Centralized outbound redaction verifies secret markers NEVER appear on wire bytes", async () => {
    const sensitiveRuntime: CoordinatorRuntimeTarget = {
      getRetainedScreens: () => [
        {
          outputId: "HDMI-A-1",
          name: "HDMI-A-1",
          geometry: { x: 0, y: 0, width: 1920, height: 1080 },
          usableArea: { x: 0, y: 0, width: 1920, height: 1080 },
          activeLayout: "master-stack",
          masterCount: 1,
          masterRatio: 0.5,
          gaps: { inner: 0, outer: 0 },
          orderedWindowIds: ["win-secret-1"],
          persistentOrder: ["win-secret-1"]
        }
      ],
      getRetainedWindows: () => [
        {
          id: "win-secret-1",
          title: "CONFIDENTIAL_BANK_RECORD_12345",
          resourceClass: "SECRET_APP_CLASS_67890",
          resourceName: "SECRET_APP_NAME_ABCDE",
          appId: "SECRET_APP_ID_FGHIJ",
          desktopFileName: "SECRET_DESKTOP_FILE_KLMNO",
          role: "SECRET_ROLE_PQRST",
          outputId: "HDMI-A-1",
          classification: "tiled",
          tileable: true,
          minimized: false,
          fullScreen: false,
          noBorder: false,
          maximizeMode: 0,
          isManualFloating: false,
          frameGeometry: { x: 0, y: 0, width: 960, height: 1080 },
          desiredGeometry: { x: 0, y: 0, width: 960, height: 1080 },
          preMinimizeGeometry: null
        }
      ],
      getRetainedScreen: () => null,
      reconcile: () => null,
      getDiagnostics: () => ({ secretDiagKey: "SECRET_DIAG_VALUE" }),
      getConfig: () => ({ redactIdentities: true }),
      getTraceRecorder: () => ({
        isEnabled: () => true,
        getEntries: () => [
          {
            tick: 1,
            event: { title: "SECRET_IN_TRACE_111", resourceClass: "SECRET_IN_TRACE_222" }
          }
        ],
        clear: () => 0
      })
    };

    const server = new ReferenceServer(sensitiveRuntime);
    const client = new ReferenceClient(server, "redaction-tester");
    await client.hello("Tester", "1.0");

    // 1. Snapshot over wire
    const snapshotBytes = await server.processBytes(
      encodeFrame({
        protocol: "tessera.ipc",
        majorVersion: 1,
        minorVersion: 0,
        kind: "request",
        id: "req-wire-snap",
        method: "state.getSnapshot"
      }),
      "redaction-tester"
    );

    const wireTextSnapshot = new TextDecoder().decode(snapshotBytes[0]);
    expect(wireTextSnapshot).not.toContain("CONFIDENTIAL_BANK_RECORD_12345");
    expect(wireTextSnapshot).not.toContain("SECRET_APP_CLASS_67890");
    expect(wireTextSnapshot).not.toContain("SECRET_APP_NAME_ABCDE");
    expect(wireTextSnapshot).not.toContain("SECRET_APP_ID_FGHIJ");
    expect(wireTextSnapshot).not.toContain("SECRET_DESKTOP_FILE_KLMNO");
    expect(wireTextSnapshot).not.toContain("SECRET_ROLE_PQRST");

    // 2. Trace over wire
    const traceBytes = await server.processBytes(
      encodeFrame({
        protocol: "tessera.ipc",
        majorVersion: 1,
        minorVersion: 0,
        kind: "request",
        id: "req-wire-trace",
        method: "trace.getRecent"
      }),
      "redaction-tester"
    );

    const wireTextTrace = new TextDecoder().decode(traceBytes[0]);
    expect(wireTextTrace).not.toContain("SECRET_IN_TRACE_111");
    expect(wireTextTrace).not.toContain("SECRET_IN_TRACE_222");
  });

  it("15. Safe internal errors never leak exception details or file paths across wire", async () => {
    const errorRuntime: CoordinatorRuntimeTarget = {
      getRetainedScreens: () => {
        throw new Error("CRITICAL_DATABASE_FAILURE at /home/secret-victim/.private_keys/id_ed25519");
      },
      getRetainedWindows: () => [],
      getRetainedScreen: () => null,
      reconcile: () => null,
      getDiagnostics: () => ({})
    };

    const server = new ReferenceServer(errorRuntime);
    const client = new ReferenceClient(server, "error-tester");
    await client.hello("Tester", "1.0");

    const responseFrames = await server.processBytes(
      encodeFrame({
        protocol: "tessera.ipc",
        majorVersion: 1,
        minorVersion: 0,
        kind: "request",
        id: "req-fail",
        method: "state.getSnapshot"
      }),
      "error-tester"
    );

    expect(responseFrames).toHaveLength(1);
    const wireText = new TextDecoder().decode(responseFrames[0]);

    // Sensitive error strings MUST NOT appear anywhere on wire
    expect(wireText).not.toContain("secret-victim");
    expect(wireText).not.toContain("private_keys");
    expect(wireText).not.toContain("id_ed25519");
    expect(wireText).not.toContain("CRITICAL_DATABASE_FAILURE");

    // Must return generic message and correlation token
    expect(wireText).toContain("INTERNAL_ERROR");
    expect(wireText).toContain("An internal server error occurred");
    expect(wireText).toContain("err-token-");
  });

  it("16. Validates target window and output existence before acknowledging commands", async () => {
    const targetRuntime: CoordinatorRuntimeTarget = {
      getRetainedScreens: () => [
        {
          outputId: "HDMI-A-1",
          name: "HDMI-A-1",
          geometry: { x: 0, y: 0, width: 1920, height: 1080 },
          usableArea: { x: 0, y: 0, width: 1920, height: 1080 },
          activeLayout: "master-stack",
          masterCount: 1,
          masterRatio: 0.5,
          gaps: { inner: 0, outer: 0 },
          orderedWindowIds: ["win-1"],
          persistentOrder: ["win-1"]
        }
      ],
      getRetainedWindows: () => [
        {
          id: "win-1",
          resourceClass: "terminal",
          outputId: "HDMI-A-1",
          classification: "tiled",
          tileable: true,
          minimized: false,
          fullScreen: false,
          noBorder: false,
          maximizeMode: 0,
          isManualFloating: false,
          frameGeometry: { x: 0, y: 0, width: 960, height: 1080 },
          desiredGeometry: { x: 0, y: 0, width: 960, height: 1080 },
          preMinimizeGeometry: null
        }
      ],
      getRetainedScreen: () => null,
      reconcile: () => null,
      getDiagnostics: () => ({})
    };

    const server = new ReferenceServer(targetRuntime);
    const client = new ReferenceClient(server, "target-validator");
    await client.hello("TargetValidator", "1.0");

    // 1. Non-existent output
    const layoutResp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-missing-output",
      method: "runtime.setLayout",
      params: { outputId: "NON_EXISTENT_SCREEN", layout: "columns" }
    }, "target-validator");

    expect(layoutResp.ok).toBe(false);
    expect(layoutResp.error?.code).toBe(ProtocolErrorCode.OUTPUT_NOT_FOUND);

    // 2. Non-existent window
    const floatResp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-missing-window",
      method: "runtime.setWindowFloating",
      params: { windowId: "NON_EXISTENT_WINDOW", floating: true }
    }, "target-validator");

    expect(floatResp.ok).toBe(false);
    expect(floatResp.error?.code).toBe(ProtocolErrorCode.WINDOW_NOT_FOUND);
  });

  it("17. Reads adapter capabilities dynamically from runtime target", async () => {
    const customCapsRuntime: CoordinatorRuntimeTarget = {
      getRetainedScreens: () => [],
      getRetainedWindows: () => [],
      getRetainedScreen: () => null,
      reconcile: () => null,
      getDiagnostics: () => ({}),
      getCapabilities: () => 0x155 // Custom capability mask
    };

    const server = new ReferenceServer(customCapsRuntime);
    const client = new ReferenceClient(server, "caps-client");
    await client.hello("CapsClient", "1.0");

    const capsResp = await client.sendRequest<StateCapabilitiesResult>("state.getCapabilities");
    expect(capsResp.adapterCapabilities).toBe(0x155);
  });

  it("18. Reusing idempotency key with conflicting payload returns IDEMPOTENCY_CONFLICT", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server, "idempotency-client");
    await client.hello("IdempotencyClient", "1.0");

    const req1: ProtocolRequest = {
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-idem-1",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "columns", idempotencyKey: "idem-key-123" }
    };

    const resp1 = await server.handleRequest(req1, "idempotency-client");
    expect(resp1.ok).toBe(true);

    // Replay exact same payload: succeeds and returns cached response
    const resp2 = await server.handleRequest({ ...req1, id: "req-idem-2" }, "idempotency-client");
    expect(resp2.ok).toBe(true);
    expect((resp2.result as RuntimeCommandAckResult).commandId).toBe((resp1.result as RuntimeCommandAckResult).commandId);

    // Conflicting payload with SAME idempotency key: MUST fail with IDEMPOTENCY_CONFLICT
    const reqConflicting: ProtocolRequest = {
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-idem-conflict",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "grid", idempotencyKey: "idem-key-123" }
    };

    const respConflict = await server.handleRequest(reqConflicting, "idempotency-client");
    expect(respConflict.ok).toBe(false);
    expect(respConflict.error?.code).toBe(ProtocolErrorCode.IDEMPOTENCY_CONFLICT);
  });

  it("19. Cross-client idempotency keys are isolated per client", async () => {
    const server = new ReferenceServer(mockRuntime);
    const clientA = new ReferenceClient(server, "client-A");
    const clientB = new ReferenceClient(server, "client-B");

    await clientA.hello("Client A", "1.0");
    await clientB.hello("Client B", "1.0");

    const respA = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-A",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "columns", idempotencyKey: "shared-key-name" }
    }, "client-A");

    const respB = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-B",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "rows", idempotencyKey: "shared-key-name" }
    }, "client-B");

    // Both succeed independently because idempotency scope is (client, method, key)
    expect(respA.ok).toBe(true);
    expect(respB.ok).toBe(true);
    expect((respA.result as RuntimeCommandAckResult).commandId).not.toBe(
      (respB.result as RuntimeCommandAckResult).commandId
    );
  });

  it("20. Bounded idempotency cache uses FIFO eviction", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server, "cache-bounded");
    await client.hello("CacheBounded", "1.0");

    // Fill 1,000 keys (drain queue after each to stay under MAX_QUEUE_LENGTH)
    for (let i = 0; i < 1000; i++) {
      await server.handleRequest({
        protocol: "tessera.ipc",
        majorVersion: 1,
        minorVersion: 0,
        kind: "request",
        id: `req-${i}`,
        method: "runtime.setLayout",
        params: { outputId: "HDMI-A-1", layout: "columns", idempotencyKey: `k-${i}` }
      }, "cache-bounded");
      server.advance();
    }

    // Insert 1001st key (should evict k-0)
    await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-1001",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "columns", idempotencyKey: "k-1000" }
    }, "cache-bounded");

    // Reusing k-0 with different payload is now allowed (old key was evicted)
    const resp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-reuse-evicted",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "rows", idempotencyKey: "k-0" }
    }, "cache-bounded");

    expect(resp.ok).toBe(true);
  });

  it("21. Two simultaneous sessions using identical clientName, method, and idempotency key but different payloads remain isolated", async () => {
    const server = new ReferenceServer(mockRuntime);
    // Two distinct connections/sessions sharing the identical clientName
    const session1 = new ReferenceClient(server, "conn-session-1");
    const session2 = new ReferenceClient(server, "conn-session-2");

    await session1.hello("IdenticalAppClient", "1.0");
    await session2.hello("IdenticalAppClient", "1.0");

    // Both sessions use the exact same idempotencyKey but DIFFERENT payloads
    const resp1 = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-s1",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "columns", idempotencyKey: "duplicate-app-key" }
    }, "conn-session-1");

    const resp2 = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-s2",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "grid", idempotencyKey: "duplicate-app-key" }
    }, "conn-session-2");

    // Both must succeed independently without conflict
    expect(resp1.ok).toBe(true);
    expect(resp2.ok).toBe(true);

    const ack1 = resp1.result as RuntimeCommandAckResult;
    const ack2 = resp2.result as RuntimeCommandAckResult;
    expect(ack1.commandId).not.toBe(ack2.commandId);

    // Session 1 replays its key: gets ack1
    const replay1 = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-s1-replay",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "columns", idempotencyKey: "duplicate-app-key" }
    }, "conn-session-1");
    expect(replay1.ok).toBe(true);
    expect((replay1.result as RuntimeCommandAckResult).commandId).toBe(ack1.commandId);

    // Session 2 replays its key: gets ack2
    const replay2 = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-s2-replay",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "grid", idempotencyKey: "duplicate-app-key" }
    }, "conn-session-2");
    expect(replay2.ok).toBe(true);
    expect((replay2.result as RuntimeCommandAckResult).commandId).toBe(ack2.commandId);

    // Reconnecting/new session has clean idempotency slate:
    // Disconnecting session 1 removes connection state
    server.removeSession("conn-session-1");
  });

  it("22. Canonical capability inventory: colon aliases and unknown capabilities are rejected during hello", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server, "conn-caps");

    const helloResp = await client.hello("CapsClient", "1.0", [
      "state:read",
      "runtime:control",
      "config:mutate",
      "unknown.capability",
      "state.inspect"
    ]);

    expect(helloResp.capabilities).toEqual(["state.inspect"]);
    expect(helloResp.capabilities).not.toContain("state:read");
    expect(helloResp.capabilities).not.toContain("runtime:control");

    // state.getCapabilities returns all 4 canonical capabilities
    const getCapsResp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-caps-query",
      method: "state.getCapabilities"
    }, "conn-caps");

    expect(getCapsResp.ok).toBe(true);
    const res = getCapsResp.result as StateCapabilitiesResult;
    expect(res.capabilities).toEqual([
      "state.inspect",
      "config.mutate",
      "runtime.control",
      "trace.inspect"
    ]);
  });

  it("23. Method authorization per capability: client without runtime.control cannot invoke runtime.setLayout", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server, "conn-auth");

    await client.hello("AuthClient", "1.0", ["state.inspect"]);

    // Allowed under state.inspect
    const snapResp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-snap-ok",
      method: "state.getSnapshot"
    }, "conn-auth");
    expect(snapResp.ok).toBe(true);

    // Forbidden without runtime.control
    const layoutResp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-layout-fail",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "columns" }
    }, "conn-auth");
    expect(layoutResp.ok).toBe(false);
    expect(layoutResp.error?.code).toBe(ProtocolErrorCode.CAPABILITY_NOT_NEGOTIATED);
  });
});
