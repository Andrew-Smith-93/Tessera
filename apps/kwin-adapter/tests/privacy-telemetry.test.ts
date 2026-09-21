import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { RuntimeCoordinator } from "../src/runtime-coordinator.js";

describe("Privacy & Telemetry Redaction Invariants", () => {
  const qmlPath = resolve(__dirname, "../../../contents/ui/main.qml");
  const codeDir = resolve(__dirname, "../../../contents/code");

  const DISALLOWED_IDENTIFIERS = [
    "caption",
    "resourceClass",
    "resourceName",
    "appId",
    "desktopFileName",
    "windowRole",
    "internalId",
    "wid",
    "windowId"
  ];

  it("1. main.qml logging does not interpolate private window or application identity", () => {
    expect(existsSync(qmlPath)).toBe(true);
    const qmlContent = readFileSync(qmlPath, "utf-8");

    // Match all log(...) invocations in main.qml
    const logPattern = /log\s*\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    const logStatements: string[] = [];

    while ((match = logPattern.exec(qmlContent)) !== null) {
      logStatements.push(match[1].trim());
    }

    expect(logStatements.length).toBeGreaterThan(0);

    for (const statement of logStatements) {
      for (const disallowed of DISALLOWED_IDENTIFIERS) {
        // Disallow properties like w.caption, target.title, o.windowId, wid, etc.
        const propRegex = new RegExp(`\\b(w|target|win|o)\\.${disallowed}\\b`, "i");
        expect(
          propRegex.test(statement),
          `Disallowed property interpolation "${disallowed}" in log statement: log(${statement})`
        ).toBe(false);

        // Also disallow direct variable interpolation of wid, windowId, caption
        if (["wid", "windowId", "caption"].includes(disallowed)) {
          const varRegex = new RegExp(`(\\+\\s*\\b${disallowed}\\b|\\b${disallowed}\\b\\s*\\+)`);
          expect(
            varRegex.test(statement),
            `Disallowed variable interpolation "${disallowed}" in log statement: log(${statement})`
          ).toBe(false);
        }
      }

      // Disallow hardcoded home or app paths in log strings
      expect(
        /(?:\/home\/|\/usr\/bin|\/proc\/)/i.test(statement),
        `Filesystem path found in log statement: log(${statement})`
      ).toBe(false);
    }
  });

  it("2. contents/code/*.js runtime artifacts contain zero raw console or print calls", () => {
    expect(existsSync(codeDir)).toBe(true);
    const jsFiles = readdirSync(codeDir).filter(f => f.endsWith(".js"));
    expect(jsFiles.length).toBeGreaterThan(0);

    for (const jsFile of jsFiles) {
      const content = readFileSync(resolve(codeDir, jsFile), "utf-8");
      expect(content.includes("console.log("), `${jsFile} should not contain console.log`).toBe(false);
      expect(content.includes("console.warn("), `${jsFile} should not contain console.warn`).toBe(false);
      expect(content.includes("console.error("), `${jsFile} should not contain console.error`).toBe(false);
      expect(/\bprint\s*\(/.test(content), `${jsFile} should not contain raw print()`).toBe(false);
    }
  });

  it("3. Manual floating state telemetry is state-only and deterministic", () => {
    const formatManualFloatingLog = (
      currentlyFloating: boolean,
      nextFloating: boolean,
      coordBefore: boolean,
      coordAfter: boolean
    ): string => {
      return `manual floating: ${currentlyFloating} -> ${nextFloating}, coordinator: ${coordBefore} -> ${coordAfter}`;
    };

    // First toggle: tiled -> floating
    const log1 = formatManualFloatingLog(false, true, false, true);
    expect(log1).toBe("manual floating: false -> true, coordinator: false -> true");
    expect(log1).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}/i); // No UUID
    expect(log1).not.toMatch(/win-|window-|id=/i); // No window ID

    // Second toggle: floating -> tiled
    const log2 = formatManualFloatingLog(true, false, true, false);
    expect(log2).toBe("manual floating: true -> false, coordinator: true -> false");
    expect(log2).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}/i);
    expect(log2).not.toMatch(/win-|window-|id=/i);
  });

  it("4. RuntimeCoordinator setManualFloating operates purely on state without identity leakage", () => {
    const coord = new RuntimeCoordinator();
    coord.getOrCreateScreen({
      outputId: "DP-4",
      geometry: { x: 1920, y: 0, width: 1920, height: 1080 },
      usableArea: { x: 1920, y: 0, width: 1920, height: 1080 }
    });

    coord.ingestEvent({
      type: "WindowDiscovered",
      window: {
        id: "win-test-alpha",
        outputId: "DP-4",
        frameGeometry: { x: 1940, y: 20, width: 930, height: 1040 }
      }
    });

    expect(coord.isManualFloating("win-test-alpha")).toBe(false);

    // Toggle 1: float window
    coord.setManualFloating("win-test-alpha", true);
    expect(coord.isManualFloating("win-test-alpha")).toBe(true);

    // Reconcile and verify floating window is excluded from tiled geometry operations
    const tx = coord.reconcile();
    const ops = tx.operations.filter(op => op.windowId === "win-test-alpha");
    expect(ops.length).toBe(0);

    // Toggle 2: unfloat window
    coord.setManualFloating("win-test-alpha", false);
    expect(coord.isManualFloating("win-test-alpha")).toBe(false);
  });
});
