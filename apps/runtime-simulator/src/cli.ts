import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { RuntimeSimulator } from "./simulator.js";
import { canonicalizeState } from "./canonical.js";
import { runSeededStressTest } from "./stress.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default directory locations
const FIXTURES_DIR = resolve(__dirname, "../fixtures");
const GOLDENS_DIR = resolve(__dirname, "../goldens");

export interface CliOptions {
  fixturePath?: string;
  verifyGoldens?: boolean;
  updateGoldens?: boolean;
  json?: boolean;
  quiet?: boolean;
  seed?: number;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--verify-goldens" || arg === "--verify") {
      options.verifyGoldens = true;
    } else if (arg === "--update-goldens" || arg === "--update") {
      options.updateGoldens = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--quiet" || arg === "-q") {
      options.quiet = true;
    } else if (arg === "--seed") {
      options.seed = parseInt(argv[++i], 10);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      options.fixturePath = arg;
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`
Tessera Runtime Simulator CLI

Usage:
  sim-cli [options] [path-to-fixture.json]

Options:
  --verify-goldens, --verify    Verify all committed fixtures against their goldens
  --update-goldens, --update    Update golden files for all fixtures (explicit dev action)
  --json                        Output canonical JSON result to stdout
  --quiet, -q                   Suppress verbose diagnostic messages (CI mode)
  --seed <number>               Run deterministic seeded stress test with Mulberry32
  --help, -h                    Show this help message

Examples:
  sim-cli fixtures/01-single-screen-three-windows.fixture.json
  sim-cli --verify-goldens
  sim-cli --seed 12345
`);
}

function getFixtureFiles(): string[] {
  if (!existsSync(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR)
    .filter((f: string) => f.endsWith(".json"))
    .sort()
    .map((f: string) => resolve(FIXTURES_DIR, f));
}

export function runCli(argv: string[] = process.argv.slice(2)): number {
  const options = parseArgs(argv);

  // 1. Seeded stress test mode
  if (options.seed !== undefined) {
    try {
      const result = runSeededStressTest(options.seed, 100);
      if (options.json) {
        console.log(canonicalizeState(result));
      } else if (!options.quiet) {
        console.log(`✓ Seeded stress test passed for seed ${options.seed}`);
        console.log(`  Digest:       ${result.digest}`);
        console.log(`  Events:       ${result.diagnostics.totalEvents}`);
        console.log(`  Transactions: ${result.diagnostics.totalTransactions}`);
        console.log(`  Writes:       ${result.diagnostics.totalGeometryWrites}`);
      }
      return 0;
    } catch (err: unknown) {
      console.error(`✗ Stress test failed for seed ${options.seed}:`, err);
      return 1;
    }
  }

  // 2. Update goldens mode
  if (options.updateGoldens) {
    if (!existsSync(GOLDENS_DIR)) {
      mkdirSync(GOLDENS_DIR, { recursive: true });
    }
    const files = getFixtureFiles();
    if (files.length === 0) {
      console.error("No fixture files found in:", FIXTURES_DIR);
      return 1;
    }

    const sim = new RuntimeSimulator();
    let updated = 0;

    for (const file of files) {
      try {
        const fixture = sim.loadFixture(file);
        const result = sim.run(fixture);
        const name = basename(file).replace(/\.fixture\.json$|\.json$/, "");
        const goldenPath = resolve(GOLDENS_DIR, `${name}.golden.json`);

        const goldenContent = {
          digest: result.digest,
          fixtureName: fixture.name || name,
          finalTick: result.finalTick,
          diagnostics: result.diagnostics,
          canonicalState: JSON.parse(canonicalizeState(result))
        };

        writeFileSync(goldenPath, JSON.stringify(goldenContent, null, 2) + "\n", "utf8");
        updated++;
        if (!options.quiet) {
          console.log(`Updated golden for: ${name} -> digest ${result.digest.slice(0, 12)}`);
        }
      } catch (err: unknown) {
        console.error(`Failed to update golden for ${file}:`, err);
        return 1;
      }
    }

    console.log(`Successfully updated ${updated} golden files.`);
    return 0;
  }

  // 3. Verify goldens mode (default if no specific fixture provided, or if --verify-goldens passed)
  if (options.verifyGoldens || !options.fixturePath) {
    const files = getFixtureFiles();
    if (files.length === 0) {
      console.error("No fixture files found in:", FIXTURES_DIR);
      return 1;
    }

    const sim = new RuntimeSimulator();
    let passedCount = 0;
    const failures: string[] = [];

    for (const file of files) {
      const name = basename(file).replace(/\.fixture\.json$|\.json$/, "");
      const goldenPath = resolve(GOLDENS_DIR, `${name}.golden.json`);

      if (!existsSync(goldenPath)) {
        failures.push(`Missing golden file for fixture: ${name} (expected ${goldenPath})`);
        continue;
      }

      try {
        const fixture = sim.loadFixture(file);
        const result = sim.run(fixture);

        if (!result.invariants.passed) {
          failures.push(
            `Fixture ${name} failed invariants:\n` +
              JSON.stringify(result.invariants.violations, null, 2)
          );
          continue;
        }

        const goldenRaw = readFileSync(goldenPath, "utf8");
        const golden = JSON.parse(goldenRaw);

        if (golden.digest !== result.digest) {
          failures.push(
            `Digest mismatch for ${name}:\n  Golden:   ${golden.digest}\n  Simulated: ${result.digest}`
          );
          continue;
        }

        passedCount++;
        if (!options.quiet) {
          console.log(`✓ ${name.padEnd(45)} [digest: ${result.digest.slice(0, 12)}]`);
        }
      } catch (err: unknown) {
        failures.push(`Error executing fixture ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (failures.length > 0) {
      console.error(`\n✗ Verification failed (${failures.length} issues):\n`);
      for (const fail of failures) {
        console.error(`- ${fail}\n`);
      }
      return 1;
    }

    if (!options.quiet) {
      console.log(`\n✓ Verified ${passedCount} fixtures (all goldens matched, all invariants satisfied).`);
    }
    return 0;
  }

  // 4. Single fixture run
  try {
    const sim = new RuntimeSimulator();
    const fixture = sim.loadFixture(options.fixturePath);
    const result = sim.run(fixture);

    if (options.json) {
      console.log(canonicalizeState(result));
      return result.invariants.passed ? 0 : 1;
    }

    if (!options.quiet) {
      console.log(`Fixture:      ${fixture.name ?? basename(options.fixturePath)}`);
      console.log(`Digest:       ${result.digest}`);
      console.log(`Final Tick:   ${result.finalTick}`);
      console.log(`Events:       ${result.diagnostics.totalEvents}`);
      console.log(`Transactions: ${result.diagnostics.totalTransactions}`);
      console.log(`Writes:       ${result.diagnostics.totalGeometryWrites}`);
      console.log(`Echoes:       ${result.diagnostics.suppressedEchoes}`);
      console.log(`Invariants:   ${result.invariants.passed ? "PASSED" : "FAILED"}`);

      if (!result.invariants.passed) {
        console.error("Violations:", JSON.stringify(result.invariants.violations, null, 2));
      }
    }

    return result.invariants.passed ? 0 : 1;
  } catch (err: unknown) {
    console.error("Simulation error:", err instanceof Error ? err.message : String(err));
    return 1;
  }
}
