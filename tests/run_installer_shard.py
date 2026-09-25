#!/usr/bin/env python3
"""
Deterministic test shard runner for Tessera installer integration tests.
Ensures every dynamically discovered test runs exactly once without manual list maintenance.
"""

import argparse
import os
import sys
import unittest

# Ensure repository root is at the head of sys.path
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if sys.path[0] != REPO_ROOT:
    sys.path.insert(0, REPO_ROOT)


def discover_installer_tests():
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromName("tests.test_installer_integration")
    tests = []

    def _extract_tests(suite_or_test):
        if isinstance(suite_or_test, unittest.TestSuite):
            for item in suite_or_test:
                _extract_tests(item)
        elif isinstance(suite_or_test, unittest.TestCase):
            if "FailedTest" in suite_or_test.__class__.__name__:
                raise RuntimeError(f"Test loader encountered failed test import: {suite_or_test}")
            tests.append(suite_or_test)

    _extract_tests(suite)
    if not tests:
        raise RuntimeError("No installer tests discovered from test_installer_integration; failing closed.")
    # Sort deterministically by full test id
    tests.sort(key=lambda t: t.id())
    return tests


def partition_tests(tests, shard_index, total_shards):
    if total_shards <= 0:
        raise ValueError(f"total_shards must be >= 1, got {total_shards}")
    if shard_index < 0 or shard_index >= total_shards:
        raise ValueError(f"Invalid shard_index {shard_index} for total_shards {total_shards}")
    return [t for i, t in enumerate(tests) if i % total_shards == shard_index]


def verify_partition(tests, total_shards):
    if not tests:
        raise AssertionError("No installer tests discovered or provided to verify_partition; failing closed.")
    if total_shards <= 0:
        raise ValueError(f"total_shards must be >= 1, got {total_shards}")
    seen = set()
    total_in_shards = 0
    for s in range(total_shards):
        shard_tests = partition_tests(tests, s, total_shards)
        if not shard_tests and len(tests) >= total_shards:
            raise AssertionError(f"Shard {s} is unexpectedly empty (total tests: {len(tests)}, shards: {total_shards})")
        total_in_shards += len(shard_tests)
        for t in shard_tests:
            tid = t.id()
            if tid in seen:
                raise AssertionError(f"Duplicate test detected across shards: {tid}")
            seen.add(tid)

    if total_in_shards != len(tests):
        raise AssertionError(
            f"Test count mismatch: total discovered {len(tests)} != total in shards {total_in_shards}"
        )
    if len(seen) != len(tests):
        raise AssertionError("Not all discovered tests were covered across shards")
    return True


def main():
    parser = argparse.ArgumentParser(description="Deterministic installer test sharding runner")
    parser.add_argument("--shard", type=int, default=0, help="0-based shard index")
    parser.add_argument("--total-shards", type=int, default=1, help="Total number of shards")
    parser.add_argument("--verify-shards", type=int, default=None, help="Verify partition integrity for N shards and exit")
    parser.add_argument("--list", action="store_true", help="List tests in specified shard and exit")
    args = parser.parse_args()

    if args.total_shards <= 0:
        parser.error(f"--total-shards must be >= 1 (got {args.total_shards})")
    if args.shard < 0 or args.shard >= args.total_shards:
        parser.error(f"--shard must be between 0 and {args.total_shards - 1} (got {args.shard})")
    if args.verify_shards is not None and args.verify_shards <= 0:
        parser.error(f"--verify-shards must be >= 1 (got {args.verify_shards})")

    tests = discover_installer_tests()
    if not tests:
        raise RuntimeError("No installer tests discovered; failing closed.")

    if args.verify_shards is not None:
        verify_partition(tests, args.verify_shards)
        print(f"Verified {len(tests)} tests partitioned across {args.verify_shards} shards: 0 duplicates, 0 gaps.")
        for s in range(args.verify_shards):
            st = partition_tests(tests, s, args.verify_shards)
            print(f"  Shard {s}: {len(st)} tests")
        sys.exit(0)

    shard_tests = partition_tests(tests, args.shard, args.total_shards)

    if args.list:
        print(f"Shard {args.shard}/{args.total_shards} ({len(shard_tests)} of {len(tests)} tests):")
        for t in shard_tests:
            print(f"  {t.id()}")
        sys.exit(0)

    # Build suite and run
    shard_suite = unittest.TestSuite()
    for t in shard_tests:
        shard_suite.addTest(t)

    print(f"Running shard {args.shard + 1} of {args.total_shards} ({len(shard_tests)} of {len(tests)} tests)...")
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(shard_suite)
    sys.exit(0 if result.wasSuccessful() else 1)


if __name__ == "__main__":
    main()
