#!/usr/bin/env python3
"""
Dynamic test runner for Tessera fast unit, contract, and hygiene tests.
Discovers all test_*.py modules in tests/ except test_installer_integration.py,
asserts that no test module falls through, and runs all discovered tests.
"""

import argparse
import glob
import os
import sys
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if sys.path[0] != REPO_ROOT:
    sys.path.insert(0, REPO_ROOT)

TESTS_DIR = os.path.join(REPO_ROOT, "tests")
INSTALLER_MODULE_BASENAME = "test_installer_integration.py"


def discover_all_test_files():
    """Discover all test_*.py files in tests/ directory."""
    pattern = os.path.join(TESTS_DIR, "test_*.py")
    files = sorted(glob.glob(pattern))
    if not files:
        raise RuntimeError("No test files found in tests/; failing closed.")
    return files


def discover_fast_test_modules():
    """
    Dynamically discover all test_*.py files in tests/ excluding installer tests.
    Returns list of tuples: (filename, module_import_name).
    """
    all_files = discover_all_test_files()
    fast_modules = []
    installer_found = False

    for f in all_files:
        basename = os.path.basename(f)
        if basename == INSTALLER_MODULE_BASENAME:
            installer_found = True
            continue
        modname = f"tests.{basename[:-3]}"
        fast_modules.append((basename, modname))

    if not installer_found:
        raise RuntimeError(
            f"Expected installer test {INSTALLER_MODULE_BASENAME} to exist in tests/; failing closed."
        )
    if not fast_modules:
        raise RuntimeError("No fast test modules discovered in tests/; failing closed.")

    return fast_modules


def load_fast_tests():
    """
    Load all tests from discovered fast test modules, verifying that every module
    loads successfully and contributes at least one test.
    Returns (suite, tests_by_module).
    """
    fast_modules = discover_fast_test_modules()
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    tests_by_module = {}

    for basename, modname in fast_modules:
        mod_suite = loader.loadTestsFromName(modname)
        extracted = []

        def _extract(s):
            if isinstance(s, unittest.TestSuite):
                for item in s:
                    _extract(item)
            elif isinstance(s, unittest.TestCase):
                if "FailedTest" in s.__class__.__name__:
                    raise RuntimeError(f"Failed to import/load test in {modname}: {s}")
                extracted.append(s)

        _extract(mod_suite)
        if not extracted:
            raise AssertionError(
                f"Test module {modname} ({basename}) yielded 0 tests; test modules must not be empty."
            )
        # Ensure deterministic ordering within module
        extracted.sort(key=lambda t: t.id())
        tests_by_module[modname] = extracted
        suite.addTests(extracted)

    return suite, tests_by_module


def main():
    parser = argparse.ArgumentParser(description="Dynamic fast test runner")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")
    parser.add_argument("--list", action="store_true", help="List discovered tests and exit")
    args = parser.parse_args()

    suite, tests_by_module = load_fast_tests()
    total_tests = suite.countTestCases()

    if args.list:
        print(f"Discovered {total_tests} fast tests across {len(tests_by_module)} modules:")
        for modname, tests in tests_by_module.items():
            print(f"  {modname} ({len(tests)} tests):")
            for t in tests:
                print(f"    {t.id()}")
        sys.exit(0)

    verbosity = 2 if args.verbose else 1
    print(f"Running {total_tests} fast tests across {len(tests_by_module)} modules...")
    runner = unittest.TextTestRunner(verbosity=verbosity)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)


if __name__ == "__main__":
    main()
