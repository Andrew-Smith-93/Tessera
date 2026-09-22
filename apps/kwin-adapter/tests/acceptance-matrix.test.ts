import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Acceptance Matrix Completeness & Integrity (91 Cases)", () => {
  const docPath = resolve(__dirname, "../../../docs/LIVE_KWIN_X11_ACCEPTANCE.md");

  const VALID_STATUSES = new Set([
    "LIVE PASS",
    "AUTOMATED PASS",
    "FAIL",
    "BLOCKED",
    "NOT RUN"
  ]);

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

  it("2. Exactly 91 unique acceptance IDs are defined in test inventory", () => {
    expect(EXPECTED_IDS.length).toBe(91);
    const set = new Set(EXPECTED_IDS);
    expect(set.size).toBe(91);
  });

  it("3. Parse every case row, validate status, check for duplicates and ensure exactly 91 rows", () => {
    const content = readFileSync(docPath, "utf-8");

    // Match table rows: | ID | Description | **STATUS** | Evidence |
    const rowPattern = /^\|\s*([A-K]\d+)\s*\|\s*([^|]+)\s*\|\s*\*\*([A-Z ]+)\*\*\s*\|\s*([^|]+)\s*\|/gm;
    const parsedRows = new Map<string, { description: string; status: string; evidence: string }>();
    const seenIds = new Set<string>();

    let match: RegExpExecArray | null;
    while ((match = rowPattern.exec(content)) !== null) {
      const id = match[1];
      const desc = match[2].trim();
      const status = match[3].trim();
      const evidence = match[4].trim();

      expect(seenIds.has(id), `Duplicate case ID found in markdown table: ${id}`).toBe(false);
      seenIds.add(id);

      expect(VALID_STATUSES.has(status), `Unknown status "${status}" for case ${id}`).toBe(true);

      parsedRows.set(id, { description: desc, status, evidence });
    }

    expect(parsedRows.size, `Expected exactly 91 case rows in tables, parsed ${parsedRows.size}`).toBe(91);

    for (const expectedId of EXPECTED_IDS) {
      expect(parsedRows.has(expectedId), `Missing acceptance case row for ID: ${expectedId}`).toBe(true);
    }
  });

  it("4. Calculate section and overall counts directly from rows and compare with documented summary tables", () => {
    const content = readFileSync(docPath, "utf-8");

    const rowPattern = /^\|\s*([A-K]\d+)\s*\|\s*([^|]+)\s*\|\s*\*\*([A-Z ]+)\*\*\s*\|\s*([^|]+)\s*\|/gm;
    const sectionCounts: Record<string, Record<string, number>> = {};
    const overallCounts: Record<string, number> = {
      "LIVE PASS": 0,
      "AUTOMATED PASS": 0,
      "FAIL": 0,
      "BLOCKED": 0,
      "NOT RUN": 0
    };

    const sections = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"];
    for (const s of sections) {
      sectionCounts[s] = {
        "LIVE PASS": 0,
        "AUTOMATED PASS": 0,
        "FAIL": 0,
        "BLOCKED": 0,
        "NOT RUN": 0
      };
    }

    let match: RegExpExecArray | null;
    let totalCount = 0;
    while ((match = rowPattern.exec(content)) !== null) {
      const id = match[1];
      const status = match[3].trim();
      const sec = id[0];

      expect(sectionCounts[sec]).toBeDefined();
      sectionCounts[sec][status] = (sectionCounts[sec][status] || 0) + 1;
      overallCounts[status] = (overallCounts[status] || 0) + 1;
      totalCount++;
    }

    expect(totalCount).toBe(91);

    // 1. Compare with documented overall summary list
    const livePassDoc = parseInt(content.match(/\*\*LIVE PASS\*\*:\s*(\d+)/)?.[1] || "-1", 10);
    const autoPassDoc = parseInt(content.match(/\*\*AUTOMATED PASS\*\*:\s*(\d+)/)?.[1] || "-1", 10);
    const failDoc = parseInt(content.match(/\*\*FAIL\*\*:\s*(\d+)/)?.[1] || "-1", 10);
    const blockedDoc = parseInt(content.match(/\*\*BLOCKED\*\*:\s*(\d+)/)?.[1] || "-1", 10);
    const notRunDoc = parseInt(content.match(/\*\*NOT RUN\*\*:\s*(\d+)/)?.[1] || "-1", 10);

    expect(overallCounts["LIVE PASS"]).toBe(livePassDoc);
    expect(overallCounts["AUTOMATED PASS"]).toBe(autoPassDoc);
    expect(overallCounts["FAIL"]).toBe(failDoc);
    expect(overallCounts["BLOCKED"]).toBe(blockedDoc);
    expect(overallCounts["NOT RUN"]).toBe(notRunDoc);

    const overallSum = overallCounts["LIVE PASS"] + overallCounts["AUTOMATED PASS"] + overallCounts["FAIL"] + overallCounts["BLOCKED"] + overallCounts["NOT RUN"];
    expect(overallSum).toBe(91);

    // 2. Compare with documented Section Breakdown Table
    const tableRowPattern = /^\|\s*([A-K])\s*\|\s*([^|]+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/gm;
    let tableMatch: RegExpExecArray | null;
    const documentedSections: Record<string, { total: number; live: number; auto: number; fail: number; blocked: number; notRun: number }> = {};

    while ((tableMatch = tableRowPattern.exec(content)) !== null) {
      const sec = tableMatch[1];
      documentedSections[sec] = {
        total: parseInt(tableMatch[3], 10),
        live: parseInt(tableMatch[4], 10),
        auto: parseInt(tableMatch[5], 10),
        fail: parseInt(tableMatch[6], 10),
        blocked: parseInt(tableMatch[7], 10),
        notRun: parseInt(tableMatch[8], 10)
      };
    }

    for (const sec of sections) {
      const doc = documentedSections[sec];
      expect(doc, `Missing documented table row for section ${sec}`).toBeDefined();
      const calc = sectionCounts[sec];

      expect(calc["LIVE PASS"], `Section ${sec} LIVE PASS mismatch`).toBe(doc.live);
      expect(calc["AUTOMATED PASS"], `Section ${sec} AUTOMATED PASS mismatch`).toBe(doc.auto);
      expect(calc["FAIL"], `Section ${sec} FAIL mismatch`).toBe(doc.fail);
      expect(calc["BLOCKED"], `Section ${sec} BLOCKED mismatch`).toBe(doc.blocked);
      expect(calc["NOT RUN"], `Section ${sec} NOT RUN mismatch`).toBe(doc.notRun);

      const secSum = calc["LIVE PASS"] + calc["AUTOMATED PASS"] + calc["FAIL"] + calc["BLOCKED"] + calc["NOT RUN"];
      expect(secSum, `Section ${sec} total mismatch`).toBe(doc.total);
    }
  });
});
