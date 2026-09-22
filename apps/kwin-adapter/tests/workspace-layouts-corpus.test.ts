import { describe, it, expect } from "vitest";
import { RuntimeCoordinator } from "../src/runtime-coordinator.js";
import * as fs from "fs";
import * as path from "path";

interface CorpusCase {
  id: string;
  description: string;
  input?: string;
  valid: boolean;
  canonical?: string;
  errorSubstring?: string;
  generate_boundary?: string;
}

interface Corpus {
  cases: CorpusCase[];
}

const corpusPath = path.resolve(__dirname, "../../../tests/fixtures/workspace-layouts-corpus.json");
const corpus: Corpus = JSON.parse(fs.readFileSync(corpusPath, "utf-8"));

/**
 * Generate boundary test inputs at runtime to avoid embedding 64 KiB
 * literal strings in the shared corpus JSON file.
 * Asserts boundary invariants on generated inputs.
 */
function generateBoundaryInput(kind: string): string {
  if (kind === "50_scopes" || kind === "51_scopes") {
    const count = kind === "50_scopes" ? 50 : 51;
    const scopes: Record<string, { layout: string }> = {};
    for (let i = 0; i < count; i++) {
      const key = `out${i}//desk${i}`;
      scopes[key] = { layout: "columns" };
    }
    const ordered: Record<string, { layout: string }> = {};
    for (const k of Object.keys(scopes).sort()) ordered[k] = scopes[k];
    const generated = JSON.stringify({ version: 1, scopes: ordered });
    expect(Object.keys(ordered).length).toBe(count);
    return generated;
  }
  if (kind === "65536_bytes" || kind === "65537_bytes") {
    const target = kind === "65536_bytes" ? 65536 : 65537;
    const prefix = '{"version":1,"scopes":{"';
    const suffix = '//x":{"layout":"columns"}}}';
    const needed = target - Buffer.byteLength(prefix, "utf-8") - Buffer.byteLength(suffix, "utf-8");
    const key = "a".repeat(needed);
    const generated = prefix + key + suffix;
    expect(Buffer.byteLength(generated, "utf-8")).toBe(target);
    return generated;
  }
  throw new Error(`Unknown boundary generator: ${kind}`);
}

describe("Workspace Layouts JSON — Shared Corpus", () => {
  for (const tc of corpus.cases) {
    it(`${tc.id}: ${tc.description}`, () => {
      const coordinator = new RuntimeCoordinator();
      const input = tc.generate_boundary
        ? generateBoundaryInput(tc.generate_boundary)
        : tc.input!;

      const result = coordinator.loadWorkspaceLayoutsJson(input);

      if (tc.valid) {
        expect(result).toBe(true);
        // Every valid corpus case must assert byte-identical canonical output.
        // When tc.canonical is provided, compare against it; otherwise output === input.
        const expectedCanonical = tc.canonical !== undefined ? tc.canonical : input;
        const config = coordinator.getConfig();
        expect(config.workspaceLayoutsJson).toBe(expectedCanonical);

        // Verify no error was recorded using public getter
        expect(coordinator.getWorkspaceLayoutConfigError()).toBeNull();
      } else {
        expect(result).toBe(false);
        // Verify error was recorded using public getter
        const err = coordinator.getWorkspaceLayoutConfigError();
        expect(err).not.toBeNull();
        // If an errorSubstring is provided and non-empty, check it
        if (tc.errorSubstring) {
          expect(err!.toLowerCase()).toContain(tc.errorSubstring.toLowerCase());
        }
        // Verify config was reset to canonical empty
        const config = coordinator.getConfig();
        expect(config.workspaceLayoutsJson).toBe('{"version":1,"scopes":{}}');
      }
    });
  }

  // Additional TS-specific tests for undefined and null handling
  it("undefined input defaults to canonical empty scopes (no error)", () => {
    const coordinator = new RuntimeCoordinator();
    const result = coordinator.loadWorkspaceLayoutsJson(undefined);
    expect(result).toBe(true);
    expect(coordinator.getWorkspaceLayoutConfigError()).toBeNull();
    expect(coordinator.getConfig().workspaceLayoutsJson).toBe('{"version":1,"scopes":{}}');
  });

  it("null input is rejected (not silently defaulted)", () => {
    const coordinator = new RuntimeCoordinator();
    // At runtime in KWin QML, null may be passed despite the TS type.
    const result = coordinator.loadWorkspaceLayoutsJson(null as any);
    expect(result).toBe(false);
    expect(coordinator.getWorkspaceLayoutConfigError()).not.toBeNull();
  });
});
