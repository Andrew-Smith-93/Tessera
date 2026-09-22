import unittest
import os
import re
from collections import Counter, defaultdict

class TestAcceptanceMatrixIntegrity(unittest.TestCase):
    def setUp(self):
        self.doc_path = os.path.join(os.path.dirname(__file__), "../docs/LIVE_KWIN_X11_ACCEPTANCE.md")
        self.valid_statuses = {
            "LIVE PASS",
            "AUTOMATED PASS",
            "FAIL",
            "BLOCKED",
            "NOT RUN"
        }
        self.expected_ids = [
            # Section A (8)
            "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8",
            # Section B (10)
            "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10",
            # Section C (6)
            "C1", "C2", "C3", "C4", "C5", "C6",
            # Section D (8)
            "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8",
            # Section E (6)
            "E1", "E2", "E3", "E4", "E5", "E6",
            # Section F (9)
            "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9",
            # Section G (12)
            "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12",
            # Section H (12)
            "H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10", "H11", "H12",
            # Section I (7)
            "I1", "I2", "I3", "I4", "I5", "I6", "I7",
            # Section J (6)
            "J1", "J2", "J3", "J4", "J5", "J6",
            # Section K (7)
            "K1", "K2", "K3", "K4", "K5", "K6", "K7"
        ]
        self.sections = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]

    def test_doc_exists(self):
        self.assertTrue(os.path.exists(self.doc_path), "LIVE_KWIN_X11_ACCEPTANCE.md must exist")

    def test_expected_ids_count(self):
        self.assertEqual(len(self.expected_ids), 91, "Expected exactly 91 IDs")
        self.assertEqual(len(set(self.expected_ids)), 91, "All 91 IDs must be unique")

    def test_parse_every_case_row_and_check_duplicates(self):
        with open(self.doc_path, "r", encoding="utf-8") as f:
            content = f.read()

        row_re = re.compile(r"^\|\s*([A-K]\d+)\s*\|\s*([^|]+)\s*\|\s*\*\*([A-Z ]+)\*\*\s*\|\s*([^|]+)\s*\|", re.MULTILINE)
        matches = row_re.findall(content)

        self.assertEqual(len(matches), 91, f"Expected exactly 91 case rows in tables, matched {len(matches)}")

        parsed_ids = []
        for case_id, desc, status, evid in matches:
            status = status.strip()
            self.assertIn(status, self.valid_statuses, f"Unknown status '{status}' for case {case_id}")
            parsed_ids.append(case_id)

        self.assertEqual(len(parsed_ids), 91, "Parsed IDs count must be 91")
        self.assertEqual(len(set(parsed_ids)), 91, "All parsed IDs must be unique (no duplicates)")

        for expected_id in self.expected_ids:
            self.assertIn(expected_id, parsed_ids, f"Missing acceptance ID: {expected_id}")

    def test_calculate_section_and_overall_counts_and_compare_summary(self):
        with open(self.doc_path, "r", encoding="utf-8") as f:
            content = f.read()

        row_re = re.compile(r"^\|\s*([A-K]\d+)\s*\|\s*([^|]+)\s*\|\s*\*\*([A-Z ]+)\*\*\s*\|\s*([^|]+)\s*\|", re.MULTILINE)
        matches = row_re.findall(content)

        section_counts = {s: Counter() for s in self.sections}
        overall_counts = Counter()

        for case_id, desc, status, evid in matches:
            status = status.strip()
            sec = case_id[0]
            section_counts[sec][status] += 1
            overall_counts[status] += 1

        self.assertEqual(sum(overall_counts.values()), 91, "Total row-derived count must equal 91")

        # 1. Compare with documented summary list
        live_pass_doc = int(re.search(r"\*\*LIVE PASS\*\*:\s*(\d+)", content).group(1))
        auto_pass_doc = int(re.search(r"\*\*AUTOMATED PASS\*\*:\s*(\d+)", content).group(1))
        fail_doc = int(re.search(r"\*\*FAIL\*\*:\s*(\d+)", content).group(1))
        blocked_doc = int(re.search(r"\*\*BLOCKED\*\*:\s*(\d+)", content).group(1))
        not_run_doc = int(re.search(r"\*\*NOT RUN\*\*:\s*(\d+)", content).group(1))

        self.assertEqual(overall_counts["LIVE PASS"], live_pass_doc, "LIVE PASS overall count mismatch")
        self.assertEqual(overall_counts["AUTOMATED PASS"], auto_pass_doc, "AUTOMATED PASS overall count mismatch")
        self.assertEqual(overall_counts["FAIL"], fail_doc, "FAIL overall count mismatch")
        self.assertEqual(overall_counts["BLOCKED"], blocked_doc, "BLOCKED overall count mismatch")
        self.assertEqual(overall_counts["NOT RUN"], not_run_doc, "NOT RUN overall count mismatch")

        # 2. Compare with documented Section Breakdown Table
        table_re = re.compile(r"^\|\s*([A-K])\s*\|\s*([^|]+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|", re.MULTILINE)
        table_matches = table_re.findall(content)

        documented_sections = {}
        for sec, name, total, live, auto, fail, blocked, not_run in table_matches:
            documented_sections[sec] = {
                "total": int(total),
                "live": int(live),
                "auto": int(auto),
                "fail": int(fail),
                "blocked": int(blocked),
                "not_run": int(not_run)
            }

        for sec in self.sections:
            self.assertIn(sec, documented_sections, f"Missing documented section {sec} in table")
            doc = documented_sections[sec]
            calc = section_counts[sec]

            self.assertEqual(calc["LIVE PASS"], doc["live"], f"Section {sec} LIVE PASS mismatch")
            self.assertEqual(calc["AUTOMATED PASS"], doc["auto"], f"Section {sec} AUTOMATED PASS mismatch")
            self.assertEqual(calc["FAIL"], doc["fail"], f"Section {sec} FAIL mismatch")
            self.assertEqual(calc["BLOCKED"], doc["blocked"], f"Section {sec} BLOCKED mismatch")
            self.assertEqual(calc["NOT RUN"], doc["not_run"], f"Section {sec} NOT RUN mismatch")
            self.assertEqual(sum(calc.values()), doc["total"], f"Section {sec} total mismatch")

if __name__ == "__main__":
    unittest.main()
