import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Acceptance Matrix Completeness & Integrity (91 Cases)", () => {
  const docPath = resolve(__dirname, "../../../docs/LIVE_KWIN_X11_ACCEPTANCE.md");

  const EXPECTED_IDS: string[] = [
    // Section A (8)
    "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8",
    // Section B (10)
    "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10",
    // Section C (6)
    "C1", "C2", "C3", "C4", "C5", "C6",
    // Section D (8)
    "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8",
    // Section E (6)
    "E1", "E2", "E3", "E4", "E5", "E6",
    // Section F (9)
    "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9",
    // Section G (12)
    "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12",
    // Section H (12)
    "H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10", "H11", "H12",
    // Section I (7)
    "I1", "I2", "I3", "I4", "I5", "I6", "I7",
    // Section J (6)
    "J1", "J2", "J3", "J4", "J5", "J6",
    // Section K (7)
    "K1", "K2", "K3", "K4", "K5", "K6", "K7"
  ];

  it("1. Acceptance documentation file exists", () => {
    expect(existsSync(docPath)).toBe(true);
  });

  it("2. Exactly 91 unique acceptance IDs are defined", () => {
    expect(EXPECTED_IDS.length).toBe(91);
    const set = new Set(EXPECTED_IDS);
    expect(set.size).toBe(91);
  });

  it("3. Every acceptance ID is present in docs/LIVE_KWIN_X11_ACCEPTANCE.md with no duplicates", () => {
    const content = readFileSync(docPath, "utf-8");

    for (const id of EXPECTED_IDS) {
      // Look for ID in table or markdown header: e.g. "| A1 |" or "A1."
      const pattern = new RegExp(`(\\|\\s*${id}\\s*\\||\\b${id}\\.\\s+)`, "m");
      expect(pattern.test(content), `Missing acceptance case ID: ${id}`).toBe(true);

      // Verify no duplicate table entries for this ID
      const tableMatch = content.match(new RegExp(`\\|\\s*\\*\\*${id}\\*\\*\\s*\\|`, "g")) ||
                         content.match(new RegExp(`\\|\\s*${id}\\s*\\|`, "g"));
      if (tableMatch) {
        expect(tableMatch.length, `Duplicate entries found for ID: ${id}`).toBe(1);
      }
    }
  });

  it("4. Summary counts sum to exactly 91", () => {
    const content = readFileSync(docPath, "utf-8");

    const livePassMatch = content.match(/\*\*LIVE PASS\*\*:\s*(\d+)/);
    const autoPassMatch = content.match(/\*\*AUTOMATED PASS\*\*:\s*(\d+)/);
    const failMatch = content.match(/\*\*FAIL\*\*:\s*(\d+)/);
    const blockedMatch = content.match(/\*\*BLOCKED\*\*:\s*(\d+)/);
    const notRunMatch = content.match(/\*\*NOT RUN\*\*:\s*(\d+)/);

    expect(livePassMatch).not.toBeNull();
    expect(autoPassMatch).not.toBeNull();
    expect(failMatch).not.toBeNull();
    expect(blockedMatch).not.toBeNull();
    expect(notRunMatch).not.toBeNull();

    const livePass = parseInt(livePassMatch![1], 10);
    const autoPass = parseInt(autoPassMatch![1], 10);
    const fail = parseInt(failMatch![1], 10);
    const blocked = parseInt(blockedMatch![1], 10);
    const notRun = parseInt(notRunMatch![1], 10);

    const sum = livePass + autoPass + fail + blocked + notRun;
    expect(sum, `Summary counts must sum to exactly 91, got ${sum} (${livePass}+${autoPass}+${fail}+${blocked}+${notRun})`).toBe(91);
  });
});
