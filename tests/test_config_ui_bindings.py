"""
Exact structural contract tests for config.ui ↔ main.xml ↔ canonical-config.json parity.

Replaces weak presence checks with exact allowlists, widget classes, KConfig types/defaults,
numeric ranges, and combo item order assertions. Declares legacy KConfig alias entries and
intentionally nonvisual canonical fields.
"""

import json
import os
import unittest
import xml.etree.ElementTree as ET

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


class TestConfigStructuralContract(unittest.TestCase):
    """Exact structural contract verification for the KCM configuration surface."""

    @classmethod
    def setUpClass(cls):
        cls.config_ui_path = os.path.join(REPO_ROOT, "contents/ui/config.ui")
        cls.main_xml_path = os.path.join(REPO_ROOT, "contents/config/main.xml")
        cls.canonical_path = os.path.join(REPO_ROOT, "config/canonical-config.json")

        cls.ui_tree = ET.parse(cls.config_ui_path)
        cls.ui_root = cls.ui_tree.getroot()
        cls.main_tree = ET.parse(cls.main_xml_path)
        cls.main_root = cls.main_tree.getroot()
        with open(cls.canonical_path, "r", encoding="utf-8") as f:
            cls.canonical = json.load(f)

    # ── Exact kcfg widget allowlist ──────────────────────────────────────

    # Every kcfg_ widget that MUST appear in config.ui, with its expected Qt class.
    KCFG_WIDGET_ALLOWLIST = {
        "kcfg_enableTiling":        "QCheckBox",
        "kcfg_tileNewWindows":      "QCheckBox",
        "kcfg_ignoreMinimized":     "QCheckBox",
        "kcfg_perDesktopLayout":    "QCheckBox",
        "kcfg_showOsd":             "QCheckBox",
        "kcfg_reconcileDebounceMs": "QSpinBox",
        "kcfg_overlayPollingMs":    "QSpinBox",
        "kcfg_defaultLayout":       "QComboBox",
        "kcfg_primaryRegionRatio":  "QDoubleSpinBox",
        "kcfg_primaryRegionCount":  "QSpinBox",
        "kcfg_gapInner":            "QSpinBox",
        "kcfg_gapOuter":            "QSpinBox",
        "kcfg_gameWindowPolicy":    "QComboBox",
        "kcfg_floatFilter":         "QLineEdit",
    }

    # Legacy KConfig alias entries that appear in main.xml but intentionally
    # have NO kcfg_ widget — they are wired to their canonical successors.
    LEGACY_ALIAS_MAP = {
        "masterRatio":       "primaryRegionRatio",
        "masterCount":       "primaryRegionCount",
        "nvidiaDebounceMs":  "reconcileDebounceMs",
        "desktopLayoutsJson": "workspaceLayoutsJson",
    }

    # Canonical properties that intentionally have no KCM UI widget because
    # they are internal schema versioning or JSON blob fields.
    NONVISUAL_CANONICAL_FIELDS = {
        "configSchemaVersion",
        "customRulesJson",
        "workspaceLayoutsJson",
    }

    # ── main.xml entry contract ──────────────────────────────────────────

    # Expected main.xml entries: name → (type, default_text).
    # Default text is exactly as it appears in the XML <default> element.
    MAIN_XML_ENTRIES = {
        "configSchemaVersion":   ("Int",    "2"),
        "enableTiling":          ("Bool",   "true"),
        "defaultLayout":         ("String", "balanced-grid"),
        "gapInner":              ("Int",    "8"),
        "gapOuter":              ("Int",    "10"),
        "primaryRegionRatio":    ("Double", "0.50"),
        "primaryRegionCount":    ("Int",    "1"),
        "perDesktopLayout":      ("Bool",   "true"),
        "tileNewWindows":        ("Bool",   "true"),
        "showOsd":               ("Bool",   "true"),
        "reconcileDebounceMs":   ("Int",    "60"),
        "overlayPollingMs":      ("Int",    "16"),
        "ignoreMinimized":       ("Bool",   "true"),
        "gameWindowPolicy":      ("String", "floating"),
        "floatFilter":           ("String", "krunner,kcalc,systemsettings,pavucontrol,plasma-desktop,spectacle,kdialog,ksplashqml,org.kde.polkit-kde-authentication-agent-1,Steam,steam_app,steamwebhelper"),
        "customRulesJson":       ("String", "[]"),
        "workspaceLayoutsJson":  ("String", '{"version":1,"scopes":{}}'),
        # Legacy aliases
        "masterRatio":           ("Double", "0.50"),
        "masterCount":           ("Int",    "1"),
        "nvidiaDebounceMs":      ("Int",    "60"),
        "desktopLayoutsJson":    ("String", "{}"),
    }

    # ── Numeric range contract ───────────────────────────────────────────

    # Expected minimum/maximum for every numeric kcfg_ widget.
    NUMERIC_RANGES = {
        "kcfg_reconcileDebounceMs": (0, 1000),
        "kcfg_overlayPollingMs":    (8, 60),
        "kcfg_primaryRegionRatio":  (0.10, 0.90),
        "kcfg_primaryRegionCount":  (0, 10),
        "kcfg_gapInner":            (0, 100),
        "kcfg_gapOuter":            (0, 100),
    }

    # ── Combo item order contract ────────────────────────────────────────

    COMBO_ITEMS = {
        "kcfg_defaultLayout": [
            "balanced-grid", "primary-stack", "binary-split",
            "columns", "rows", "monocle", "floating",
        ],
        "kcfg_gameWindowPolicy": [
            "floating", "tiled", "monocle",
        ],
    }

    # ── Tests ────────────────────────────────────────────────────────────

    def test_ui_xml_root_structure(self):
        """config.ui must be a Qt Designer 4.0 form."""
        self.assertEqual(self.ui_root.tag, "ui")
        self.assertEqual(self.ui_root.attrib.get("version"), "4.0")

    def test_exact_kcfg_widget_set(self):
        """config.ui must contain exactly the allowlisted kcfg_ widgets."""
        actual_kcfg = {}
        for widget in self.ui_root.iter("widget"):
            name = widget.attrib.get("name", "")
            if name.startswith("kcfg_"):
                actual_kcfg[name] = widget.attrib.get("class", "")

        self.assertEqual(
            set(actual_kcfg.keys()),
            set(self.KCFG_WIDGET_ALLOWLIST.keys()),
            "kcfg_ widget set does not match the exact allowlist",
        )

    def test_kcfg_widget_classes(self):
        """Each kcfg_ widget must use the expected Qt class."""
        for widget in self.ui_root.iter("widget"):
            name = widget.attrib.get("name", "")
            if name in self.KCFG_WIDGET_ALLOWLIST:
                expected_class = self.KCFG_WIDGET_ALLOWLIST[name]
                actual_class = widget.attrib.get("class", "")
                self.assertEqual(
                    actual_class,
                    expected_class,
                    f"Widget {name} expected class {expected_class}, got {actual_class}",
                )

    def test_numeric_ranges(self):
        """Every numeric kcfg_ widget must have exact min/max properties matching NUMERIC_RANGES."""
        for widget in self.ui_root.iter("widget"):
            name = widget.attrib.get("name", "")
            if name not in self.NUMERIC_RANGES:
                continue
            expected_min, expected_max = self.NUMERIC_RANGES[name]

            props = {}
            for prop in widget.findall("property"):
                pname = prop.attrib.get("name", "")
                if pname in ("minimum", "maximum"):
                    num = prop.find("number")
                    dbl = prop.find("double")
                    if num is not None:
                        props[pname] = float(num.text)
                    elif dbl is not None:
                        props[pname] = float(dbl.text)

            self.assertIn("minimum", props, f"{name} missing minimum property")
            self.assertIn("maximum", props, f"{name} missing maximum property")
            self.assertAlmostEqual(
                float(props["minimum"]),
                float(expected_min),
                places=4,
                msg=f"{name} minimum: expected {expected_min}, got {props['minimum']}",
            )
            self.assertAlmostEqual(
                float(props["maximum"]),
                float(expected_max),
                places=4,
                msg=f"{name} maximum: expected {expected_max}, got {props['maximum']}",
            )

    def test_numeric_ranges_match_canonical(self):
        """NUMERIC_RANGES must equal canonical minimum/maximum for every visible numeric property."""
        canonical_props = self.canonical["properties"]
        derived_ranges = {}
        for wname, qclass in self.KCFG_WIDGET_ALLOWLIST.items():
            prop_name = wname[5:]  # strip 'kcfg_'
            cspec = canonical_props.get(prop_name)
            if cspec and cspec.get("type") in ("integer", "number") and "minimum" in cspec and "maximum" in cspec:
                derived_ranges[wname] = (cspec["minimum"], cspec["maximum"])

        self.assertEqual(
            self.NUMERIC_RANGES,
            derived_ranges,
            "NUMERIC_RANGES does not equal canonical minimum/maximum specifications",
        )

    def test_combo_item_order(self):
        """Combo boxes must have items in the exact canonical order."""
        for widget in self.ui_root.iter("widget"):
            name = widget.attrib.get("name", "")
            if name not in self.COMBO_ITEMS:
                continue
            items = []
            for item in widget.findall("item"):
                for prop in item.findall("property"):
                    s = prop.find("string")
                    if s is not None and s.text is not None:
                        items.append(s.text)
            self.assertEqual(
                items,
                self.COMBO_ITEMS[name],
                f"Combo {name} items do not match expected order",
            )

    def test_combo_items_match_canonical_enums(self):
        """Each combo list must equal its canonical enum definition as well as exact hard-coded order."""
        canonical_props = self.canonical["properties"]
        for wname, expected_list in self.COMBO_ITEMS.items():
            prop_name = wname[5:]
            canonical_enum = canonical_props[prop_name]["enum"]
            self.assertEqual(
                expected_list,
                canonical_enum,
                f"Combo {wname} does not match canonical enum for {prop_name}",
            )

    def test_main_xml_exact_entries(self):
        """main.xml must contain exactly the declared entries with correct types and defaults."""
        actual_entries = {}
        for entry in self.main_root.iter():
            tag = entry.tag
            if "}" in tag:
                tag = tag.split("}")[1]
            if tag != "entry":
                continue
            name = entry.attrib.get("name")
            entry_type = entry.attrib.get("type")
            default_elem = entry.find("{http://www.kde.org/standards/kcfg/1.0}default")
            if default_elem is None:
                default_elem = entry.find("default")
            default_text = default_elem.text if default_elem is not None else ""
            if name:
                actual_entries[name] = (entry_type, default_text)

        for ename, (etype, edefault) in self.MAIN_XML_ENTRIES.items():
            self.assertIn(
                ename,
                actual_entries,
                f"Expected entry {ename!r} missing from main.xml",
            )
            actual_type, actual_default = actual_entries[ename]
            self.assertEqual(
                actual_type,
                etype,
                f"Entry {ename!r} type: expected {etype!r}, got {actual_type!r}",
            )
            self.assertEqual(
                actual_default,
                edefault,
                f"Entry {ename!r} default: expected {edefault!r}, got {actual_default!r}",
            )

        self.assertEqual(
            set(actual_entries.keys()),
            set(self.MAIN_XML_ENTRIES.keys()),
            "main.xml entry set does not match expected allowlist",
        )

    def test_main_xml_defaults_normalized_match_canonical(self):
        """Actual main.xml default values, normalized by declared type, must match canonical defaults."""
        actual_xml_entries = {}
        for entry in self.main_root.iter():
            tag = entry.tag
            if "}" in tag:
                tag = tag.split("}")[1]
            if tag != "entry":
                continue
            name = entry.attrib.get("name")
            entry_type = entry.attrib.get("type")
            default_elem = entry.find("{http://www.kde.org/standards/kcfg/1.0}default")
            if default_elem is None:
                default_elem = entry.find("default")
            default_text = default_elem.text if default_elem is not None else ""
            if name:
                actual_xml_entries[name] = (entry_type, default_text)

        canonical_props = self.canonical["properties"]
        for prop_name, cspec in canonical_props.items():
            self.assertIn(
                prop_name,
                actual_xml_entries,
                f"Canonical property {prop_name} missing from main.xml",
            )
            xml_type, raw_default = actual_xml_entries[prop_name]
            expected_default = cspec["default"]

            # Normalize raw_default by declared KConfig type
            if xml_type == "Bool":
                normalized = raw_default.strip().lower() == "true"
            elif xml_type == "Int":
                normalized = int(raw_default.strip())
            elif xml_type == "Double":
                normalized = float(raw_default.strip())
            elif xml_type == "String":
                normalized = raw_default
            else:
                normalized = raw_default

            self.assertEqual(
                normalized,
                expected_default,
                f"Default value mismatch for {prop_name}: canonical={expected_default!r}, main.xml normalized={normalized!r}",
            )

    def test_canonical_config_parity(self):
        """Every canonical property must correspond to a main.xml entry (or legacy alias)
        with type-compatible KConfig type and matching default value."""
        canonical_props = self.canonical["properties"]

        type_map = {
            "boolean": "Bool",
            "integer": "Int",
            "number": "Double",
            "string": "String",
        }

        for ckey, cspec in canonical_props.items():
            self.assertIn(
                ckey,
                self.MAIN_XML_ENTRIES,
                f"Canonical property {ckey!r} has no main.xml entry",
            )
            expected_kcfg_type = type_map[cspec["type"]]
            actual_type = self.MAIN_XML_ENTRIES[ckey][0]
            self.assertEqual(
                actual_type,
                expected_kcfg_type,
                f"Canonical property {ckey!r} type {cspec['type']!r} → KConfig {expected_kcfg_type!r}, "
                f"but main.xml has {actual_type!r}",
            )

    def test_legacy_aliases_declared_in_main_xml(self):
        """Every legacy alias declared in canonical-config.json must appear in main.xml."""
        canonical_props = self.canonical["properties"]
        for ckey, cspec in canonical_props.items():
            for alias in cspec.get("legacyAliases", []):
                self.assertIn(
                    alias,
                    self.MAIN_XML_ENTRIES,
                    f"Legacy alias {alias!r} for {ckey!r} missing from main.xml",
                )

    def test_legacy_alias_map_derived_from_canonical(self):
        """Assert the declared LEGACY_ALIAS_MAP equals the alias->canonical mapping derived
        from canonical legacyAliases, not merely the same alias keys."""
        canonical_props = self.canonical["properties"]
        derived_map = {}
        for ckey, cspec in canonical_props.items():
            for alias in cspec.get("legacyAliases", []):
                derived_map[alias] = ckey

        self.assertEqual(
            self.LEGACY_ALIAS_MAP,
            derived_map,
            "Declared LEGACY_ALIAS_MAP does not match mapping derived from canonical legacyAliases",
        )

    def test_default_layout_legacy_value_aliases(self):
        """defaultLayout legacyValueAliases must be exactly ['master-stack']."""
        val_aliases = self.canonical["properties"]["defaultLayout"].get("legacyValueAliases")
        self.assertEqual(
            val_aliases,
            ["master-stack"],
            "defaultLayout legacyValueAliases must be exactly ['master-stack']",
        )

    def test_legacy_alias_map_complete(self):
        """The declared legacy alias map must match all main.xml entries that are
        not canonical properties."""
        canonical_keys = set(self.canonical["properties"].keys())
        main_keys = set(self.MAIN_XML_ENTRIES.keys())
        extra_keys = main_keys - canonical_keys
        self.assertEqual(
            extra_keys,
            set(self.LEGACY_ALIAS_MAP.keys()),
            "main.xml entries not in canonical properties must be exactly the legacy alias map",
        )

    def test_nonvisual_fields_have_no_widget(self):
        """Intentionally nonvisual canonical fields must not have a kcfg_ widget."""
        actual_kcfg_names = set()
        for widget in self.ui_root.iter("widget"):
            name = widget.attrib.get("name", "")
            if name.startswith("kcfg_"):
                actual_kcfg_names.add(name[5:])  # strip prefix

        for field in self.NONVISUAL_CANONICAL_FIELDS:
            self.assertNotIn(
                field,
                actual_kcfg_names,
                f"Nonvisual field {field!r} should not have a kcfg_ widget",
            )

    def test_every_visual_canonical_field_has_widget(self):
        """Every canonical field that is NOT nonvisual and NOT a JSON blob
        must have a kcfg_ widget in config.ui."""
        canonical_keys = set(self.canonical["properties"].keys())
        visual_keys = canonical_keys - self.NONVISUAL_CANONICAL_FIELDS

        actual_kcfg_names = set()
        for widget in self.ui_root.iter("widget"):
            name = widget.attrib.get("name", "")
            if name.startswith("kcfg_"):
                actual_kcfg_names.add(name[5:])

        for vkey in visual_keys:
            self.assertIn(
                vkey,
                actual_kcfg_names,
                f"Visual canonical field {vkey!r} missing kcfg_ widget in config.ui",
            )


if __name__ == "__main__":
    unittest.main()
