"""
Workspace layouts JSON corpus tests — Python side.

Reads the shared corpus at tests/fixtures/workspace-layouts-corpus.json and
validates every case against config_contract.normalize_workspace_layouts_json()
and config_contract.normalize_and_validate_value("workspaceLayoutsJson", input).
"""

import json
import os
import sys
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "tessera-control"))

from config_contract import (  # noqa: E402
    DuplicateJsonKeyError,
    normalize_and_validate_value,
    normalize_workspace_layouts_json,
)

CORPUS_PATH = os.path.join(REPO_ROOT, "tests", "fixtures", "workspace-layouts-corpus.json")


def _generate_boundary_input(kind: str) -> str:
    """Generate boundary test inputs at runtime to avoid embedding 64 KiB
    literal strings in the shared corpus JSON file.
    Asserts boundary invariants on generated inputs."""
    if kind in ("50_scopes", "51_scopes"):
        count = 50 if kind == "50_scopes" else 51
        scopes = {}
        for i in range(count):
            scopes[f"out{i}//desk{i}"] = {"layout": "columns"}
        ordered = {k: scopes[k] for k in sorted(scopes)}
        generated = json.dumps({"version": 1, "scopes": ordered}, separators=(",", ":"))
        assert len(ordered) == count, f"Expected {count} scopes, got {len(ordered)}"
        return generated
    if kind in ("65536_bytes", "65537_bytes"):
        target = 65536 if kind == "65536_bytes" else 65537
        prefix = '{"version":1,"scopes":{"'
        suffix = '//x":{"layout":"columns"}}}'
        needed = target - len(prefix.encode("utf-8")) - len(suffix.encode("utf-8"))
        key = "a" * needed
        generated = prefix + key + suffix
        assert len(generated.encode("utf-8")) == target, f"Expected {target} bytes, got {len(generated.encode('utf-8'))}"
        return generated
    raise ValueError(f"Unknown boundary generator: {kind}")


class TestWorkspaceLayoutsCorpus(unittest.TestCase):
    """Run every case in the shared corpus against the Python normalizer and wrapper."""

    @classmethod
    def setUpClass(cls):
        with open(CORPUS_PATH, "r", encoding="utf-8") as f:
            cls.corpus = json.load(f)

    def _run_case(self, tc: dict):
        input_val = (
            _generate_boundary_input(tc["generate_boundary"])
            if "generate_boundary" in tc
            else tc["input"]
        )

        expected_canonical = tc["canonical"] if "canonical" in tc else input_val

        if tc["valid"]:
            # Direct normalizer check
            try:
                result = normalize_workspace_layouts_json(input_val)
            except Exception as exc:
                self.fail(
                    f"Corpus case {tc['id']!r} expected valid but raised: {exc}"
                )
            self.assertEqual(
                result,
                expected_canonical,
                f"Corpus case {tc['id']!r}: direct normalizer canonical mismatch",
            )

            # Wrapper check: normalize_and_validate_value
            ok, norm_val, err = normalize_and_validate_value("workspaceLayoutsJson", input_val)
            self.assertTrue(ok, f"Corpus case {tc['id']!r} wrapper returned not ok: {err}")
            self.assertIsNone(err, f"Corpus case {tc['id']!r} wrapper returned error: {err}")
            self.assertEqual(
                norm_val,
                expected_canonical,
                f"Corpus case {tc['id']!r}: wrapper canonical mismatch",
            )
        else:
            # Direct normalizer check: must raise
            with self.assertRaises(
                (ValueError, json.JSONDecodeError, UnicodeDecodeError, DuplicateJsonKeyError),
                msg=f"Corpus case {tc['id']!r} expected rejection but passed direct normalization",
            ):
                normalize_workspace_layouts_json(input_val)

            # Wrapper check: must return False, error not None, and candidate not accepted
            ok, norm_val, err = normalize_and_validate_value("workspaceLayoutsJson", input_val)
            self.assertFalse(
                ok,
                f"Corpus case {tc['id']!r} expected wrapper rejection but got ok=True",
            )
            self.assertIsNotNone(
                err,
                f"Corpus case {tc['id']!r} expected error message from wrapper",
            )


def _make_test(tc):
    """Dynamically create a test method for a corpus case."""

    def test(self):
        self._run_case(tc)

    test.__doc__ = f"{tc['id']}: {tc['description']}"
    return test


# Dynamically generate one test method per corpus case so test runners report
# individual pass/fail per case.
for _tc in json.load(open(CORPUS_PATH, encoding="utf-8"))["cases"]:
    setattr(
        TestWorkspaceLayoutsCorpus,
        f"test_corpus_{_tc['id']}",
        _make_test(_tc),
    )


class TestEmptyStringRejection(unittest.TestCase):
    """Empty string must be rejected by the Python parser — it is not a valid
    JSON document and must not be silently defaulted to empty scopes."""

    def test_empty_string_raises(self):
        with self.assertRaises((ValueError, json.JSONDecodeError)):
            normalize_workspace_layouts_json("")

    def test_empty_string_wrapper_rejection(self):
        ok, _norm, err = normalize_and_validate_value("workspaceLayoutsJson", "")
        self.assertFalse(ok)
        self.assertIsNotNone(err)


if __name__ == "__main__":
    unittest.main()
