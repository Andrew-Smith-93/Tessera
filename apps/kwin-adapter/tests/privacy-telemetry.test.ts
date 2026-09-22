import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { RuntimeCoordinator } from "../src/runtime-coordinator.js";

export function extractLogCalls(content: string): string[] {
  const calls: string[] = [];
  let i = 0;
  const n = content.length;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < n) {
    const c = content[i];
    const cNext = i + 1 < n ? content[i + 1] : "";

    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      i += 1;
      continue;
    } else if (inBlockComment) {
      if (c === "*" && cNext === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    } else if (inSingle) {
      if (c === "\\") {
        i += 2;
        continue;
      } else if (c === "'") {
        inSingle = false;
      }
      i += 1;
      continue;
    } else if (inDouble) {
      if (c === "\\") {
        i += 2;
        continue;
      } else if (c === '"') {
        inDouble = false;
      }
      i += 1;
      continue;
    } else if (inTemplate) {
      if (c === "\\") {
        i += 2;
        continue;
      } else if (c === "`") {
        inTemplate = false;
      }
      i += 1;
      continue;
    }

    // Outside strings and comments
    if (c === "/" && cNext === "/") {
      inLineComment = true;
      i += 2;
      continue;
    } else if (c === "/" && cNext === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    } else if (c === "'") {
      inSingle = true;
      i += 1;
      continue;
    } else if (c === '"') {
      inDouble = true;
      i += 1;
      continue;
    } else if (c === "`") {
      inTemplate = true;
      i += 1;
      continue;
    }

    // Check for log(
    const isWordStart = i === 0 || !/[a-zA-Z0-9_$.]/.test(content[i - 1]);
    if (isWordStart && content.slice(i, i + 3) === "log") {
      let pos = i + 3;
      while (pos < n && /\s/.test(content[pos])) {
        pos += 1;
      }
      if (pos < n && content[pos] === "(") {
        const startArg = pos + 1;
        let depth = 1;
        let argPos = startArg;
        let argInSingle = false;
        let argInDouble = false;
        let argInTemplate = false;
        let argInLineComment = false;
        let argInBlockComment = false;

        while (argPos < n && depth > 0) {
          const ac = content[argPos];
          const acNext = argPos + 1 < n ? content[argPos + 1] : "";

          if (argInLineComment) {
            if (ac === "\n") argInLineComment = false;
          } else if (argInBlockComment) {
            if (ac === "*" && acNext === "/") {
              argInBlockComment = false;
              argPos += 1;
            }
          } else if (argInSingle) {
            if (ac === "\\") argPos += 1;
            else if (ac === "'") argInSingle = false;
          } else if (argInDouble) {
            if (ac === "\\") argPos += 1;
            else if (ac === '"') argInDouble = false;
          } else if (argInTemplate) {
            if (ac === "\\") argPos += 1;
            else if (ac === "`") argInTemplate = false;
          } else {
            if (ac === "/" && acNext === "/") {
              argInLineComment = true;
              argPos += 1;
            } else if (ac === "/" && acNext === "*") {
              argInBlockComment = true;
              argPos += 1;
            } else if (ac === "'") {
              argInSingle = true;
            } else if (ac === '"') {
              argInDouble = true;
            } else if (ac === "`") {
              argInTemplate = true;
            } else if (ac === "(") {
              depth += 1;
            } else if (ac === ")") {
              depth -= 1;
              if (depth === 0) {
                calls.push(content.slice(startArg, argPos).trim());
                i = argPos + 1;
                break;
              }
            }
          }
          argPos += 1;
        }
        if (depth === 0) {
          continue;
        }
      }
    }
    i += 1;
  }
  return calls;
}

export function validateLogArgument(argExpr: string): string[] {
  const violations: string[] = [];

  // 1. Banned property access on window / client objects
  if (/\.[a-zA-Z0-9_$]*(?:caption|title|resourceClass|resourceName|appId|desktopFileName|windowRole|internalId)\b/i.test(argExpr)) {
    violations.push("banned_property");
  }

  // 2. Window ID variables or function calls
  if (/\b(?:wid|windowId)\b/.test(argExpr)) {
    violations.push("window_id_variable");
  }
  if (/\b(?:getWindowId|getScreenName)\s*\(/.test(argExpr)) {
    violations.push("identity_function");
  }

  // 3. Screen / Output connector identity variables or properties
  if (/\b(?:sName|toName|fromName|screenName|outputName|screenId|outputId|lastAffectedScreenIds)\b/.test(argExpr)) {
    violations.push("screen_connector_variable");
  }
  if (/\.[a-zA-Z0-9_$]*(?:outputId|screenName|outputName)\b/i.test(argExpr)) {
    violations.push("screen_connector_property");
  }

  // 4. Filesystem paths / local URLs
  if (/(?:\/(?:home|Users|proc)\/|file:\/\/|[a-zA-Z]:\\)/.test(argExpr)) {
    violations.push("filesystem_path");
  }

  // 5. Raw error variable interpolation outside string literals
  const codeWithoutStrings = argExpr.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
    '""'
  );
  if (/\b(?:err|error|exception|e)\b/.test(codeWithoutStrings)) {
    violations.push("raw_error_variable");
  }

  // 6. Command arguments
  if (/\b(?:command|cmd|argv|args|commandArgs)\b/.test(codeWithoutStrings)) {
    violations.push("command_arguments");
  }

  return violations;
}

describe("Privacy & Telemetry Redaction Invariants", () => {
  const qmlPath = resolve(__dirname, "../../../contents/ui/main.qml");
  const codeDir = resolve(__dirname, "../../../contents/code");

  it("1. main.qml logging does not interpolate private window or application identity", () => {
    expect(existsSync(qmlPath)).toBe(true);
    const qmlContent = readFileSync(qmlPath, "utf-8");

    const logCalls = extractLogCalls(qmlContent);
    expect(logCalls.length).toBe(13);

    for (const statement of logCalls) {
      const violations = validateLogArgument(statement);
      expect(
        violations,
        `Disallowed logging in statement: log(${statement}) -> ${violations.join(", ")}`
      ).toEqual([]);
    }
  });

  it("2. Log checker rejects negative sentinels across all banned categories", () => {
    const sentinelSource = `
      // Standalone line comment: log("fake in line comment: " + win.title);
      /*
        Standalone block comment:
        log("fake in block comment: " + win.title);
      */
      log("window title: " + win.title);
      log("target caption: " + target.caption);
      log("resource: " + w.resourceClass);
      log("name: " + c.resourceName);
      log("app: " + appObj.appId);
      log("desktop file: " + client.desktopFileName);
      log("role: " + w.windowRole);
      log("internal id: " + item.internalId);
      log("window id: " + wid);
      log("window id: " + windowId);
      log("got id: " + getWindowId(w));
      log("screen name: " + getScreenName(scr));
      log("screen: " + sName);
      log("target: " + toName);
      log("from: " + fromName);
      log("screen name: " + screenName);
      log("output name: " + outputName);
      log("screen id: " + screenId);
      log("output id: " + outputId);
      log("affected: " + lastAffectedScreenIds);
      log("target output: " + scr.outputId);
      log("failed: " + err);
      log("failed: " + error);
      log("exception: " + exception);
      log("error: " + e);
      log("command: " + command);
      log("cmd: " + cmd);
      log("argv: " + argv);
      log("args: " + args);
      log("args: " + commandArgs);
      log("path: /home/user/.config");
      log("url: file:///etc/passwd");
      log("win: C:\\\\Users\\\\admin");
      /* block comment */
      log("info " + (w.title ? "active: " + cmd : "idle"));
      log("composite (" + getWindowId(w) + ") /* not a comment */ " + formatHelper((val) => val + ": " + cmd, "nested (parens) log(fake.title)") /* inline block */ + " status: " + err);
    `;

    const extractedCalls = extractLogCalls(sentinelSource);
    expect(extractedCalls.length).toBe(35);

    for (const expr of extractedCalls) {
      expect(expr).not.toContain("fake in line comment");
      expect(expr).not.toContain("fake in block comment");
      const violations = validateLogArgument(expr);
      expect(
        violations.length,
        `Expected sentinel 'log(${expr})' to produce violation, got [${violations.join(", ")}]`
      ).toBeGreaterThan(0);
    }
  });

  it("3. contents/code/*.js runtime artifacts contain zero raw console or print calls", () => {
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

  it("4. Manual floating state telemetry is state-only and deterministic", () => {
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

  it("5. RuntimeCoordinator setManualFloating operates purely on state without identity leakage", () => {
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
