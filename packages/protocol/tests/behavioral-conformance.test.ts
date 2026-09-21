import { describe, it, expect, beforeEach } from "vitest";
import {
  ReferenceServer,
  ReferenceClient,
  ProtocolErrorCode,
  V1_CAPABILITIES,
  type ProtocolRequest,
  type StateCapabilitiesResult,
  type StateSnapshotResult,
  type RuntimeCommandAckResult,
  type SystemSubscribeResult,
  type SystemUnsubscribeResult
} from "../src/index.js";

describe("Tessera Protocol V1 Behavioral Cross-Language Conformance Suite (TypeScript)", () => {
  let mockConfig: Record<string, unknown>;
  let mockScreens: any[];
  let mockWindows: any[];
  let server: ReferenceServer;

  beforeEach(() => {
    mockConfig = {
      enableTiling: true,
      defaultLayout: "master-stack",
      gapInner: 8,
      gapOuter: 10,
      masterRatio: 0.5,
      masterCount: 1,
      redactIdentities: false,
      gameWindowPolicy: "floating"
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

    const mockRuntime = {
      getRetainedScreens: () => mockScreens,
      getRetainedWindows: () => mockWindows,
      getConfig: () => mockConfig,
      updateConfig: (patch: Record<string, unknown>) => {
        Object.assign(mockConfig, patch);
      },
      getDiagnostics: () => ({ invariantsSatisfied: true }),
      reconcile: () => ({
        epoch: 1,
        reasons: ["manual"],
        affectedScreens: ["HDMI-A-1"],
        operations: [],
        skippedWrites: 0
      }),
      traceRecorder: null,
      getCapabilities: () => 1
    };

    server = new ReferenceServer(mockRuntime);
  });

  it("1. system.hello version negotiation", async () => {
    // Valid hello
    const respValid = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h-valid",
      method: "system.hello",
      params: { clientName: "TestClient", clientVersion: "1.0", minMajor: 1, maxMajor: 1, minMinor: 0, maxMinor: 0 }
    }, "c1");
    expect(respValid.ok).toBe(true);
    expect(respValid.result).toMatchObject({
      negotiatedMajor: 1,
      negotiatedMinor: 0
    });

    // Unsupported major version
    const respBadMajor = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h-bad-major",
      method: "system.hello",
      params: { clientName: "TestClient", clientVersion: "1.0", minMajor: 2, maxMajor: 2 }
    }, "c2");
    expect(respBadMajor.ok).toBe(false);
    expect(respBadMajor.error?.code).toBe(ProtocolErrorCode.UNSUPPORTED_MAJOR_VERSION);

    // Unsupported minor version
    const respBadMinor = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h-bad-minor",
      method: "system.hello",
      params: { clientName: "TestClient", clientVersion: "1.0", minMinor: 5 }
    }, "c3");
    expect(respBadMinor.ok).toBe(false);
    expect(respBadMinor.error?.code).toBe(ProtocolErrorCode.UNSUPPORTED_MINOR_VERSION);
  });

  it("2. capability grants", async () => {
    const resp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h-cap",
      method: "system.hello",
      params: {
        clientName: "CapClient",
        clientVersion: "1.0",
        requestedCapabilities: ["state.inspect", "runtime.control", "state:read", "invalid.cap"]
      }
    }, "c-cap");

    expect(resp.ok).toBe(true);
    const caps = (resp.result as any).capabilities;
    expect(caps).toEqual(["state.inspect", "runtime.control"]);
    expect(caps).not.toContain("state:read");
    expect(caps).not.toContain("invalid.cap");
  });

  it("3. requests before hello", async () => {
    const resp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "snap-pre-hello",
      method: "state.getSnapshot"
    }, "unauth-session");

    expect(resp.ok).toBe(false);
    expect(resp.error?.code).toBe(ProtocolErrorCode.CAPABILITY_NOT_NEGOTIATED);
  });

  it("4. state.getCapabilities", async () => {
    await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h",
      method: "system.hello",
      params: { clientName: "C", clientVersion: "1.0", requestedCapabilities: V1_CAPABILITIES }
    }, "c-caps");

    const resp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "get-caps",
      method: "state.getCapabilities"
    }, "c-caps");

    expect(resp.ok).toBe(true);
    const res = resp.result as StateCapabilitiesResult;
    expect(res.capabilities).toEqual([...V1_CAPABILITIES]);
  });

  it("5. subscribe and unsubscribe", async () => {
    await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h",
      method: "system.hello",
      params: { clientName: "C", clientVersion: "1.0" }
    }, "c-sub");

    const subResp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "sub-1",
      method: "system.subscribe",
      params: { events: ["runtime.stateChanged", "runtime.warning"] }
    }, "c-sub");
    expect(subResp.ok).toBe(true);
    expect((subResp.result as SystemSubscribeResult).subscribed).toEqual([
      "runtime.stateChanged",
      "runtime.warning"
    ]);

    const unsubResp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "unsub-1",
      method: "system.unsubscribe",
      params: { events: ["runtime.warning"] }
    }, "c-sub");
    expect(unsubResp.ok).toBe(true);
    expect((unsubResp.result as SystemUnsubscribeResult).subscribed).toEqual([
      "runtime.stateChanged"
    ]);
  });

  it("6. unauthorized methods", async () => {
    await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h",
      method: "system.hello",
      params: { clientName: "C", clientVersion: "1.0", requestedCapabilities: ["state.inspect"] }
    }, "c-unauth");

    const resp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "lay-unauth",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "columns" }
    }, "c-unauth");
    expect(resp.ok).toBe(false);
    expect(resp.error?.code).toBe(ProtocolErrorCode.CAPABILITY_NOT_NEGOTIATED);
  });

  it("7. unknown methods", async () => {
    await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h",
      method: "system.hello",
      params: { clientName: "C", clientVersion: "1.0" }
    }, "c-unk");

    const resp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "unk-1",
      method: "unknown.method" as any,
      params: {}
    }, "c-unk");
    expect(resp.ok).toBe(false);
    expect([ProtocolErrorCode.UNKNOWN_METHOD, ProtocolErrorCode.INVALID_ENVELOPE]).toContain(
      resp.error?.code
    );
  });

  it("8. invalid parameters", async () => {
    await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h",
      method: "system.hello",
      params: { clientName: "C", clientVersion: "1.0", requestedCapabilities: V1_CAPABILITIES }
    }, "c-inv");

    // Missing layout in runtime.setLayout
    const resp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "inv-param",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1" } as any
    }, "c-inv");
    expect(resp.ok).toBe(false);
    expect(resp.error?.code).toBe(ProtocolErrorCode.INVALID_PAYLOAD);
  });

  it("9. revision conflict", async () => {
    await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h",
      method: "system.hello",
      params: { clientName: "C", clientVersion: "1.0", requestedCapabilities: V1_CAPABILITIES }
    }, "c-rev");

    const resp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "rev-conflict",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "columns", expectedRevision: 9999 }
    }, "c-rev");
    expect(resp.ok).toBe(false);
    expect(resp.error?.code).toBe(ProtocolErrorCode.REVISION_CONFLICT);
  });

  it("10. idempotent replay", async () => {
    await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h",
      method: "system.hello",
      params: { clientName: "C", clientVersion: "1.0", requestedCapabilities: V1_CAPABILITIES }
    }, "c-idem");

    const resp1 = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "id-1",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "columns", idempotencyKey: "idem-key-10" }
    }, "c-idem");
    expect(resp1.ok).toBe(true);
    const ack1 = resp1.result as RuntimeCommandAckResult;

    const resp2 = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "id-2",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "columns", idempotencyKey: "idem-key-10" }
    }, "c-idem");
    expect(resp2.ok).toBe(true);
    const ack2 = resp2.result as RuntimeCommandAckResult;
    expect(ack2.commandId).toBe(ack1.commandId);
    expect(ack2.stateRevision).toBe(ack1.stateRevision);
  });

  it("11. idempotency conflict", async () => {
    await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h",
      method: "system.hello",
      params: { clientName: "C", clientVersion: "1.0", requestedCapabilities: V1_CAPABILITIES }
    }, "c-conflict");

    await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "id-c1",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "columns", idempotencyKey: "conflict-key" }
    }, "c-conflict");

    const conflictResp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "id-c2",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "rows", idempotencyKey: "conflict-key" }
    }, "c-conflict");
    expect(conflictResp.ok).toBe(false);
    expect(conflictResp.error?.code).toBe(ProtocolErrorCode.IDEMPOTENCY_CONFLICT);
  });

  it("12. same clientName across two isolated sessions", async () => {
    await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h-s1",
      method: "system.hello",
      params: { clientName: "SharedApp", clientVersion: "1.0", requestedCapabilities: V1_CAPABILITIES }
    }, "session-1");

    await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h-s2",
      method: "system.hello",
      params: { clientName: "SharedApp", clientVersion: "1.0", requestedCapabilities: V1_CAPABILITIES }
    }, "session-2");

    const resp1 = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-1",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "columns", idempotencyKey: "shared-key" }
    }, "session-1");

    const resp2 = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-2",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "grid", idempotencyKey: "shared-key" }
    }, "session-2");

    expect(resp1.ok).toBe(true);
    expect(resp2.ok).toBe(true);
    expect((resp1.result as RuntimeCommandAckResult).commandId).not.toBe(
      (resp2.result as RuntimeCommandAckResult).commandId
    );
  });

  it("13. target-not-found errors", async () => {
    await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h",
      method: "system.hello",
      params: { clientName: "C", clientVersion: "1.0", requestedCapabilities: V1_CAPABILITIES }
    }, "c-targets");

    const outErr = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "bad-out",
      method: "runtime.setLayout",
      params: { outputId: "NONEXISTENT-OUTPUT", layout: "columns" }
    }, "c-targets");
    expect(outErr.ok).toBe(false);
    expect(outErr.error?.code).toBe(ProtocolErrorCode.OUTPUT_NOT_FOUND);

    const winErr = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "bad-win",
      method: "runtime.setWindowFloating",
      params: { windowId: "NONEXISTENT-WINDOW", floating: true }
    }, "c-targets");
    expect(winErr.ok).toBe(false);
    expect(winErr.error?.code).toBe(ProtocolErrorCode.WINDOW_NOT_FOUND);
  });

  it("14. disconnected backend behavior", async () => {
    // Construct a disconnected runtime target with 0 capabilities
    const discRuntime = {
      getRetainedScreens: () => [],
      getRetainedWindows: () => [],
      getConfig: () => ({}),
      updateConfig: () => {},
      getDiagnostics: () => ({}),
      reconcile: () => null,
      traceRecorder: null,
      getCapabilities: () => 0
    };
    const discServer = new ReferenceServer(discRuntime);

    const helloResp = await discServer.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h-disc",
      method: "system.hello",
      params: { clientName: "DiscClient", clientVersion: "1.0", requestedCapabilities: V1_CAPABILITIES }
    }, "c-disc");

    expect(helloResp.ok).toBe(true);
    // Disconnected target provides 0 capabilities
    expect((helloResp.result as any).capabilities).toBeDefined();

    // Invoking method requiring capabilities returns CAPABILITY_NOT_NEGOTIATED
    const snapResp = await discServer.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "snap-disc",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "columns" }
    }, "c-disc");
    expect(snapResp.ok).toBe(false);
    expect(snapResp.error?.code).toBe(ProtocolErrorCode.CAPABILITY_NOT_NEGOTIATED);
  });

  it("15. redaction", async () => {
    mockConfig.redactIdentities = true;

    await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h",
      method: "system.hello",
      params: { clientName: "C", clientVersion: "1.0", requestedCapabilities: V1_CAPABILITIES }
    }, "c-redact");

    const snapResp = await server.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "snap-redacted",
      method: "state.getSnapshot"
    }, "c-redact");

    expect(snapResp.ok).toBe(true);
    const snap = snapResp.result as StateSnapshotResult;
    expect(snap.windows.length).toBeGreaterThan(0);
    const win = snap.windows[0];

    // title is omitted or undefined
    expect(win.title).toBeUndefined();
    // Identities masked with "[REDACTED]"
    expect(win.resourceClass).toBe("[REDACTED]");
    expect(win.resourceName).toBe("[REDACTED]");
    expect(win.appId).toBe("[REDACTED]");
    expect(win.desktopFileName).toBe("[REDACTED]");
    expect(win.role).toBe("[REDACTED]");
  });

  it("16. safe internal errors", async () => {
    const errorThrowingRuntime = {
      getRetainedScreens: () => {
        throw new Error("Sensitive internal stack trace /home/user/code/database.ts:42");
      },
      getRetainedWindows: () => [],
      getConfig: () => ({}),
      updateConfig: () => {},
      getDiagnostics: () => ({}),
      reconcile: () => null,
      traceRecorder: null
    };
    const errServer = new ReferenceServer(errorThrowingRuntime);

    await errServer.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "h",
      method: "system.hello",
      params: { clientName: "C", clientVersion: "1.0", requestedCapabilities: V1_CAPABILITIES }
    }, "c-err");

    const resp = await errServer.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "err-req",
      method: "state.getSnapshot"
    }, "c-err");

    expect(resp.ok).toBe(false);
    expect(resp.error?.code).toBe(ProtocolErrorCode.INTERNAL_ERROR);
    // Generic message, safe hash, zero leaked file paths
    expect(resp.error?.message).toContain("internal server error");
    expect(resp.error?.message).not.toContain("/home/user/code");
    expect(resp.error?.details).toMatchObject({
      correlationId: expect.any(String)
    });
  });
});
