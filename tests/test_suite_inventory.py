"""
Automated validation of test suite inventory and partitioning integrity.

Proves:
1. Full discovered repository test inventory == fast test partition + installer shards.
2. Every test ID across the repository runs exactly once (zero duplicates, zero gaps).
3. Fast partition and all installer shards are non-empty.
4. No test module falls through dynamic discovery.
5. Shard verification and fast-test runner fail closed on empty or invalid inputs.
"""

import glob
import os
import sys
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if sys.path[0] != REPO_ROOT:
    sys.path.insert(0, REPO_ROOT)

from tests.run_fast_tests import (
    discover_all_test_files,
    discover_fast_test_modules,
    load_fast_tests,
    INSTALLER_MODULE_BASENAME,
)
from tests.run_installer_shard import (
    discover_installer_tests,
    partition_tests,
    verify_partition,
)


class TestSuiteInventoryIntegrity(unittest.TestCase):
    """Verifies that all tests in the repository are accounted for and partitioned without gaps."""

    def test_full_inventory_equals_fast_partition_plus_installer_shards(self):
        """Full discovered inventory must equal fast partition + installer shards exactly once."""
        all_test_files = discover_all_test_files()
        self.assertTrue(len(all_test_files) >= 8, f"Expected at least 8 test files, got {len(all_test_files)}")

        # 1. Discover all tests in all test_*.py files across repo
        loader = unittest.TestLoader()
        full_inventory_tests = []
        all_modules = []
        for f in all_test_files:
            basename = os.path.basename(f)
            modname = f"tests.{basename[:-3]}"
            all_modules.append(modname)
            mod_suite = loader.loadTestsFromName(modname)

            def _extract(s):
                if isinstance(s, unittest.TestSuite):
                    for item in s:
                        _extract(item)
                elif isinstance(s, unittest.TestCase):
                    if "FailedTest" in s.__class__.__name__:
                        self.fail(f"Failed to import/load test in {modname}: {s}")
                    full_inventory_tests.append(s)

            _extract(mod_suite)

        full_test_ids = [t.id() for t in full_inventory_tests]
        self.assertTrue(len(full_test_ids) > 0, "Full test inventory must not be empty")
        self.assertEqual(
            len(full_test_ids),
            len(set(full_test_ids)),
            f"Duplicate test IDs found in full inventory: {len(full_test_ids)} total vs {len(set(full_test_ids))} unique",
        )

        # 2. Discover fast partition
        fast_suite, fast_by_module = load_fast_tests()
        fast_tests = []
        for mod_tests in fast_by_module.values():
            fast_tests.extend(mod_tests)
        fast_test_ids = [t.id() for t in fast_tests]
        self.assertTrue(len(fast_test_ids) > 0, "Fast test inventory must not be empty")
        self.assertEqual(
            len(fast_test_ids),
            len(set(fast_test_ids)),
            "Duplicate test IDs found in fast partition",
        )

        # 3. Discover installer tests
        installer_tests = discover_installer_tests()
        installer_test_ids = [t.id() for t in installer_tests]
        self.assertTrue(len(installer_test_ids) > 0, "Installer test inventory must not be empty")
        self.assertEqual(
            len(installer_test_ids),
            len(set(installer_test_ids)),
            "Duplicate test IDs found in installer inventory",
        )

        # 4. Assert mutual disjointness of fast vs installer
        overlap = set(fast_test_ids).intersection(set(installer_test_ids))
        self.assertEqual(
            overlap,
            set(),
            f"Fast and installer inventories must be mutually disjoint, but overlapped: {overlap}",
        )

        # 5. Partition installer tests across 3 shards
        total_shards = 3
        shards = [partition_tests(installer_tests, s, total_shards) for s in range(total_shards)]
        for s_idx, shard in enumerate(shards):
            self.assertTrue(len(shard) > 0, f"Installer shard {s_idx} must not be empty")

        # Verify shards are mutually disjoint
        for i in range(total_shards):
            shard_i_ids = {t.id() for t in shards[i]}
            for j in range(i + 1, total_shards):
                shard_j_ids = {t.id() for t in shards[j]}
                shard_overlap = shard_i_ids.intersection(shard_j_ids)
                self.assertEqual(
                    shard_overlap,
                    set(),
                    f"Installer shards {i} and {j} must be mutually disjoint, got overlap: {shard_overlap}",
                )

        # Verify union of shards equals installer tests exactly
        sharded_installer_ids = set()
        for shard in shards:
            sharded_installer_ids.update(t.id() for t in shard)
        self.assertEqual(
            sharded_installer_ids,
            set(installer_test_ids),
            "Union of installer shards must exactly match installer test inventory",
        )

        # 6. Verify full inventory = fast partition + installer shards
        combined_partition_ids = set(fast_test_ids).union(sharded_installer_ids)
        self.assertEqual(
            combined_partition_ids,
            set(full_test_ids),
            "Union of fast partition and all installer shards must exactly equal full repository test inventory",
        )
        self.assertEqual(
            len(fast_test_ids) + len(installer_test_ids),
            len(full_test_ids),
            f"Total counts must match: fast ({len(fast_test_ids)}) + installer ({len(installer_test_ids)}) != full ({len(full_test_ids)})",
        )

        # 7. Assert no test module falls through
        fast_module_names = set(fast_by_module.keys())
        expected_installer_modname = f"tests.{INSTALLER_MODULE_BASENAME[:-3]}"
        all_accounted_modules = fast_module_names.union({expected_installer_modname})
        self.assertEqual(
            all_accounted_modules,
            set(all_modules),
            "Every discovered test_*.py module must be accounted for in either fast partition or installer shards",
        )

    def test_verify_shards_fails_closed_on_zero_tests(self):
        """--verify-shards / verify_partition must fail closed when 0 tests are provided."""
        with self.assertRaises(AssertionError) as ctx:
            verify_partition([], 3)
        self.assertIn("failing closed", str(ctx.exception).lower())

    def test_verify_shards_fails_closed_on_invalid_shards(self):
        """verify_partition must fail closed on invalid shard counts."""
        installer_tests = discover_installer_tests()
        with self.assertRaises(ValueError):
            verify_partition(installer_tests, 0)
        with self.assertRaises(ValueError):
            verify_partition(installer_tests, -1)

    def test_verify_shards_detects_duplicates(self):
        """verify_partition must fail closed if duplicate tests are passed."""
        installer_tests = discover_installer_tests()
        duped = installer_tests + [installer_tests[0]]
        with self.assertRaises(AssertionError):
            verify_partition(duped, 3)

    def test_partition_tests_bounds_checking(self):
        """partition_tests must enforce bounds on shard index and shard count."""
        installer_tests = discover_installer_tests()
        with self.assertRaises(ValueError):
            partition_tests(installer_tests, -1, 3)
        with self.assertRaises(ValueError):
            partition_tests(installer_tests, 3, 3)
        with self.assertRaises(ValueError):
            partition_tests(installer_tests, 0, 0)


if __name__ == "__main__":
    unittest.main()
