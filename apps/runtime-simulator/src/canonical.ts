import { createHash } from "node:crypto";
import type { SimulationResult } from "./types.js";

/**
 * Deterministically sorts object keys deeply to guarantee byte-level consistency across runs.
 */
export function deepSortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(deepSortKeys);
  }

  const sortedObj: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>).sort();
  for (const key of keys) {
    sortedObj[key] = deepSortKeys((value as Record<string, unknown>)[key]);
  }
  return sortedObj;
}

/**
 * Canonicalizes a SimulationResult without digest, ensuring stable key order and formatting.
 */
export function canonicalizeState(result: SimulationResult): string {
  // Omit digest during canonical serialization
  const { digest: _ignored, ...stateWithoutDigest } = result;

  // Stable ordering for screens, windows, and transactions
  const stable = {
    ...stateWithoutDigest,
    retainedScreens: [...stateWithoutDigest.retainedScreens].sort((a, b) =>
      a.outputId.localeCompare(b.outputId)
    ),
    retainedWindows: [...stateWithoutDigest.retainedWindows].sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    transactions: [...stateWithoutDigest.transactions].sort((a, b) => a.epoch - b.epoch)
  };

  const sorted = deepSortKeys(stable);
  return JSON.stringify(sorted, null, 2);
}

/**
 * Computes a deterministic SHA-256 digest over canonical JSON.
 */
export function computeDigest(canonicalJson: string): string {
  return createHash("sha256").update(canonicalJson, "utf8").digest("hex");
}
