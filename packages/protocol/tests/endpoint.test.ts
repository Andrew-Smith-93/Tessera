import { describe, it, expect, beforeEach } from "vitest";
import {
  ReferenceServer,
  ReferenceClient,
  ProtocolErrorCode,
  type CoordinatorRuntimeTarget
} from "../src/index.js";

describe("Tessera Protocol V1 In-Memory Reference Endpoint", () => {
  let mockRuntime: CoordinatorRuntimeTarget;
  let mockConfig: Record<string, unknown>;
  let mockScreens: any[];
  let mockWindows: any[];
  let mockTraceEntries: any[];

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
        orderedWindowIds: ["win-1", "win-2"],
        persistentOrder: ["win-1", "win-2"]
      }
    ];

    mockWindows = [
      {
        id: "win-1",
        resourceClass: "kitty",
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
        totalGeometryWrites: 1,
        totalLayoutComputations: 1
      }),
      getConfig: () => mockConfig,
      updateConfig: (cfg: any) => {
        Object.assign(mockConfig, cfg);
      },
      getTraceRecorder: () => ({
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

    // Call config.set before system.hello
    await expect(
      client.sendRequest("config.set", { config: { gapInner: 16 } })
    ).rejects.toMatchObject({
      code: ProtocolErrorCode.CAPABILITY_NOT_NEGOTIATED
    });
  });

  it("2. system.hello negotiates capabilities successfully", async () => {
    const server = new ReferenceServer(mockRuntime, { serverVersion: "1.0.0" });
    const client = new ReferenceClient(server);

    const helloRes = await client.hello("test-cli", "1.0.0", ["state.inspect", "config.mutate"]);
    expect(helloRes.serverName).toBe("tessera-runtime");
    expect(helloRes.protocolVersion).toBe("1.0");
    expect(helloRes.capabilities).toContain("state.inspect");
    expect(helloRes.capabilities).toContain("config.mutate");
    expect(helloRes.capabilities).not.toContain("runtime.control");
  });

  it("3. Methods requiring granted capabilities succeed", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server);
    await client.hello("test-cli", "1.0.0", ["state.inspect", "config.mutate"]);

    // state.getRetainedScreens
    const screensRes = await client.sendRequest<{ screens: any[] }>("state.getRetainedScreens");
    expect(screensRes.screens).toHaveLength(1);
    expect(screensRes.screens[0].outputId).toBe("HDMI-A-1");

    // state.getRetainedWindows
    const winsRes = await client.sendRequest<{ windows: any[] }>("state.getRetainedWindows");
    expect(winsRes.windows).toHaveLength(1);
    expect(winsRes.windows[0].id).toBe("win-1");
    expect(winsRes.windows[0].resourceClass).toBe("kitty");

    // state.getScreenOrder
    const orderRes = await client.sendRequest<{ outputId: string; orderedWindowIds: string[] }>(
      "state.getScreenOrder",
      { outputId: "HDMI-A-1" }
    );
    expect(orderRes.outputId).toBe("HDMI-A-1");
    expect(orderRes.orderedWindowIds).toEqual(["win-1", "win-2"]);

    // config.get
    const cfgRes = await client.sendRequest<{ config: any }>("config.get");
    expect(cfgRes.config.gapInner).toBe(8);

    // config.set
    const setRes = await client.sendRequest<{ success: boolean; applied: any }>(
      "config.set",
      { config: { gapInner: 14 } }
    );
    expect(setRes.success).toBe(true);
    expect(mockConfig.gapInner).toBe(14);
  });

  it("4. Methods requiring ungranted capabilities fail even after hello", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server);
    // Only grant state.inspect
    await client.hello("test-cli", "1.0.0", ["state.inspect"]);

    // runtime.reconcile requires runtime.control
    await expect(
      client.sendRequest("runtime.reconcile", {})
    ).rejects.toMatchObject({
      code: ProtocolErrorCode.CAPABILITY_NOT_NEGOTIATED
    });
  });

  it("5. runtime and trace methods succeed when capabilities are negotiated", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server);
    await client.hello("test-cli", "1.0.0", ["runtime.control", "trace.inspect"]);

    // runtime.reconcile
    const recRes = await client.sendRequest<{ transaction: any }>("runtime.reconcile");
    expect(recRes.transaction).not.toBeNull();
    expect(recRes.transaction.epoch).toBe(1);

    // trace.dump
    const dumpRes = await client.sendRequest<{ entries: any[] }>("trace.dump");
    expect(dumpRes.entries).toHaveLength(1);

    // trace.clear
    const clearRes = await client.sendRequest<{ cleared: number }>("trace.clear");
    expect(clearRes.cleared).toBe(1);
    expect(mockTraceEntries).toHaveLength(0);
  });

  it("6. Asynchronous event subscription receives server broadcast events", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server);

    const receivedEvents: any[] = [];
    const unsubscribe = client.onEvent("runtime.stateChanged", data => {
      receivedEvents.push(data);
    });

    server.emitEvent("runtime.stateChanged", { tick: 10, dirtyScreens: ["HDMI-A-1"] });
    server.emitEvent("runtime.stateChanged", { tick: 20, dirtyScreens: ["DP-1"] });

    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[0].tick).toBe(10);
    expect(receivedEvents[1].tick).toBe(20);

    unsubscribe();
    server.emitEvent("runtime.stateChanged", { tick: 30, dirtyScreens: [] });
    expect(receivedEvents).toHaveLength(2); // no new events after unsubscribe
  });

  it("7. Wire-level framing round-trip over simulated stream bytes", async () => {
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server);

    // system.hello over wire
    const helloRes = await client.sendRequestOverWire<any>("system.hello", {
      clientName: "wire-client",
      clientVersion: "1.0.0",
      requestedCapabilities: ["state.inspect"]
    });
    expect(helloRes.serverName).toBe("tessera-runtime");

    // state.getRetainedScreens over wire
    const screensRes = await client.sendRequestOverWire<{ screens: any[] }>("state.getRetainedScreens");
    expect(screensRes.screens).toHaveLength(1);
  });

  it("8. Identity redaction redacts resourceClass in protocol response when enabled", async () => {
    mockConfig.redactIdentities = true;
    const server = new ReferenceServer(mockRuntime);
    const client = new ReferenceClient(server);
    await client.hello("test-cli", "1.0.0", ["state.inspect"]);

    const winsRes = await client.sendRequest<{ windows: any[] }>("state.getRetainedWindows");
    expect(winsRes.windows[0].resourceClass).toBe("[REDACTED]");
  });
});
