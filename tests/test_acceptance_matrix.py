import unittest
import os
import re

class TestAcceptanceMatrixIntegrity(unittest.TestCase):
    def setUp(self):
        self.doc_path = os.path.join(os.path.dirname(__file__), "../docs/LIVE_KWIN_X11_ACCEPTANCE.md")
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

    def test_doc_exists(self):
        self.assertTrue(os.path.exists(self.doc_path), "LIVE_KWIN_X11_ACCEPTANCE.md must exist")

    def test_expected_ids_count(self):
        self.assertEqual(len(self.expected_ids), 91, "Expected exactly 91 IDs")
        self.assertEqual(len(set(self.expected_ids)), 91, "All 91 IDs must be unique")

    def test_every_id_present_no_duplicates(self):
        with open(self.doc_path, "r", encoding="utf-8") as f:
            content = f.read()

        for case_id in self.expected_ids:
            pattern = rf"(\|\s*{case_id}\s*\||\b{case_id}\.\s+)"
            self.assertTrue(bool(re.search(pattern, content)), f"Missing acceptance ID: {case_id}")

            table_matches = re.findall(rf"\|\s*\*{0,2}{case_id}\*{0,2}\s*\|", content)
            if table_matches:
                self.assertEqual(len(table_matches), 1, f"Duplicate table entries for ID: {case_id}")

    def test_summary_counts_sum_to_91(self):
        with open(self.doc_path, "r", encoding="utf-8") as f:
            content = f.read()

        live_pass = int(re.search(r"\*\*LIVE PASS\*\*:\s*(\d+)", content).group(1))
        auto_pass = int(re.search(r"\*\*AUTOMATED PASS\*\*:\s*(\d+)", content).group(1))
        fail = int(re.search(r"\*\*FAIL\*\*:\s*(\d+)", content).group(1))
        blocked = int(re.search(r"\*\*BLOCKED\*\*:\s*(\d+)", content).group(1))
        not_run = int(re.search(r"\*\*NOT RUN\*\*:\s*(\d+)", content).group(1))

        total = live_pass + auto_pass + fail + blocked + not_run
        self.assertEqual(total, 91, f"Summary counts must sum to 91, got {total}")

if __name__ == "__main__":
    unittest.main()
