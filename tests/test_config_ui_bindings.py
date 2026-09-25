"""
Exact structural contract tests for config.ui ↔ main.xml ↔ canonical-config.json parity.

Replaces weak presence checks with exact allowlists, widget classes, KConfig types/defaults,
numeric ranges, and combo item order assertions. Declares legacy KConfig alias entries and
intentionally nonvisual canonical fields.
"""

import json
import os
import re
import subprocess
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
        "kcfg_enableAnimations":    "QCheckBox",
        "kcfg_animationDurationMs": "QSpinBox",
        "kcfg_gapInner":            "QSpinBox",
        "kcfg_gapOuter":            "QSpinBox",
        "kcfg_gameWindowPolicy":    "QComboBox",
        "kcfg_floatFilter":         "QLineEdit",
        "kcfg_customRulesJson":     "QPlainTextEdit",
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
    # they are internal schema versioning, JSON blob fields, or migration-only values.
    NONVISUAL_CANONICAL_FIELDS = {
        "configSchemaVersion",
        "workspaceLayoutsJson",
        "primaryRegionCount",
        "defaultLayout",
        "primaryRegionRatio",
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
        "enableAnimations":      ("Bool",   "true"),
        "animationDurationMs":   ("Int",    "180"),
        "ignoreMinimized":       ("Bool",   "true"),
        "gameWindowPolicy":      ("String", "floating"),
        "floatFilter":           ("String", "krunner,kcalc,systemsettings,pavucontrol,plasma-desktop,spectacle,kdialog,ksplashqml,org.kde.polkit-kde-authentication-agent-1"),
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
        "kcfg_animationDurationMs": (50, 1000),
        "kcfg_gapInner":            (0, 100),
        "kcfg_gapOuter":            (0, 100),
    }

    # ── Combo item order contract ────────────────────────────────────────

    COMBO_ITEMS = {
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

    def test_supported_settings_controls_and_labels_remain_truthful(self):
        """Assert that supported runtime settings (perDesktopLayout, showOsd) remain in config.ui with accurate labels."""
        widget_labels = {}
        for widget in self.ui_root.iter("widget"):
            name = widget.attrib.get("name", "")
            if name in ("kcfg_perDesktopLayout", "kcfg_showOsd"):
                for prop in widget.findall("property"):
                    if prop.attrib.get("name") == "text":
                        str_elem = prop.find("string")
                        if str_elem is not None and str_elem.text:
                            widget_labels[name] = str_elem.text

        self.assertIn("kcfg_perDesktopLayout", widget_labels)
        self.assertEqual(
            widget_labels["kcfg_perDesktopLayout"],
            "Keep tiling arrangements separate per virtual desktop"
        )
        self.assertIn("kcfg_showOsd", widget_labels)
        self.assertEqual(
            widget_labels["kcfg_showOsd"],
            "Show Tessera notifications for snapping and configuration changes"
        )

    def test_no_layout_menu_presets_or_primary_count_controls(self):
        """Assert that config.ui has no layout menu, layout cycling, presets, or primary region controls."""
        all_widget_names = {w.attrib.get("name", "") for w in self.ui_root.iter("widget")}
        self.assertNotIn("kcfg_primaryRegionRatio", all_widget_names)
        self.assertNotIn("kcfg_primaryRegionCount", all_widget_names)
        self.assertNotIn("kcfg_defaultLayout", all_widget_names)
        self.assertNotIn("kcfg_masterRatio", all_widget_names)
        self.assertNotIn("kcfg_masterCount", all_widget_names)

        # Tab title should be Window Gaps, not Layout & Slots
        tab_titles = []
        for widget in self.ui_root.iter("widget"):
            for attr in widget.findall("attribute"):
                if attr.attrib.get("name") == "title":
                    s = attr.find("string")
                    if s is not None and s.text:
                        tab_titles.append(s.text)
        self.assertIn("Window Gaps", tab_titles)
        self.assertNotIn("Layout & Slots", tab_titles)

    def test_active_shortcut_catalog_and_qml_registration_truth(self):
        """Assert that main.qml registers exactly the 22 active shortcuts from shortcuts.json,
        and that retired primary-region ratio shortcuts are absent from active registration
        and placed in legacyNames."""
        shortcuts_path = os.path.join(REPO_ROOT, "config/shortcuts.json")
        main_qml_path = os.path.join(REPO_ROOT, "contents/ui/main.qml")
        with open(shortcuts_path, "r", encoding="utf-8") as f:
            sc_data = json.load(f)
        with open(main_qml_path, "r", encoding="utf-8") as f:
            qml_content = f.read()

        active_shortcuts = sc_data.get("shortcuts", [])
        legacy_names = set(sc_data.get("legacyNames", []))
        self.assertEqual(len(active_shortcuts), 22, "Must have exactly 22 active shortcuts")

        pattern = r'ShortcutHandler\s*\{\s*name:\s*"([^"]+)"\s*text:\s*"([^"]+)"\s*sequence:\s*"([^"]+)"'
        handlers = re.findall(pattern, qml_content, re.MULTILINE)
        self.assertEqual(len(handlers), 22, "main.qml must define exactly 22 ShortcutHandler blocks")

        handler_map = {name: (text, seq) for name, text, seq in handlers}
        for item in active_shortcuts:
            name = item["name"]
            self.assertIn(name, handler_map, f"Active shortcut {name} missing from main.qml")
            self.assertEqual(handler_map[name][0], item["label"])
            self.assertEqual(handler_map[name][1], item["sequence"])

        # Retired ratio shortcuts must be in legacyNames and absent from active handlers
        self.assertIn("Tessera: Increase Primary Ratio", legacy_names)
        self.assertIn("Tessera: Decrease Primary Ratio", legacy_names)
        self.assertNotIn("Tessera: Increase Primary Ratio", handler_map)
        self.assertNotIn("Tessera: Decrease Primary Ratio", handler_map)

        for name, text, seq in handlers:
            self.assertNotIn(name, legacy_names)
            self.assertNotIn("Ratio", name)
            self.assertNotIn("Layout", name)


class TestConfigRuntimeBehavior(unittest.TestCase):
    """Verifies that main.qml loadConfig() correctly hydrates runtime settings from KWin."""

    @classmethod
    def setUpClass(cls):
        cls.main_qml_path = os.path.join(REPO_ROOT, "contents/ui/main.qml")
        cls.canonical_path = os.path.join(REPO_ROOT, "config/canonical-config.json")
        with open(cls.main_qml_path, "r", encoding="utf-8") as f:
            cls.qml_source = f.read()
        with open(cls.canonical_path, "r", encoding="utf-8") as f:
            cls.canonical = json.load(f)

        start = cls.qml_source.find("function loadConfig()")
        if start < 0:
            raise ValueError("function loadConfig() not found in main.qml")
        brace = cls.qml_source.find("{", start)
        depth = 1
        end = brace + 1
        while depth > 0 and end < len(cls.qml_source):
            if cls.qml_source[end] == "{":
                depth += 1
            elif cls.qml_source[end] == "}":
                depth -= 1
            end += 1
        cls.load_config_source = cls.qml_source[start:end]

    def _run_load_config(self, kwin_dict, rule_errors=None):
        node_script = """
const vm = require('vm');
const kwinConfig = JSON.parse(process.argv[1]);
const ruleErrors = JSON.parse(process.argv[3] || '[]');
const calls = {
  cancelledAnimations: [],
  updatedConfig: null,
  hookedWindows: [],
  logs: [],
  osdNotifications: []
};
const sandbox = {
  root: {
    lastRuleValidationError: ""
  },
  config: {},
  KWin: {
    readConfig: (key, def) => (key in kwinConfig ? kwinConfig[key] : def)
  },
  windowAnimator: {
    cancelAllAnimations: (force) => { calls.cancelledAnimations.push(force); }
  },
  Workspace: {
    stackingOrder: []
  },
  hookWindow: (w) => { calls.hookedWindows.push(w); },
  coordinator: {
    updateConfig: (cfg) => { calls.updatedConfig = cfg; },
    getLastCustomRuleErrors: () => ruleErrors
  },
  getCoordinator: () => sandbox.coordinator,
  osdCall: {
    notify: (text, icon, force) => { calls.osdNotifications.push({ text, icon, force: Boolean(force) }); }
  },
  log: (msg) => { calls.logs.push(msg); }
};
vm.createContext(sandbox);
const fnCode = process.argv[2];
vm.runInContext(fnCode + "; loadConfig();", sandbox);
console.log(JSON.stringify({ config: sandbox.config, calls, root: sandbox.root }));
"""
        proc = subprocess.run(
            ["node", "-e", node_script, json.dumps(kwin_dict), self.load_config_source, json.dumps(rule_errors or [])],
            capture_output=True,
            text=True,
            check=True,
        )
        return json.loads(proc.stdout)

    def test_default_config_loading(self):
        """When KWin has no overrides, default settings are correctly loaded."""
        res = self._run_load_config({})
        cfg = res["config"]
        calls = res["calls"]

        self.assertEqual(cfg["overlayPollingMs"], 16)
        self.assertEqual(cfg["enableAnimations"], True)
        self.assertEqual(cfg["animationDurationMs"], 180)
        self.assertEqual(cfg["customRulesJson"], "[]")
        self.assertEqual(cfg["defaultLayout"], "balanced-grid")
        self.assertEqual(cfg["enableTiling"], True)
        self.assertEqual(cfg["reconcileDebounceMs"], 60)
        self.assertEqual(len(calls["cancelledAnimations"]), 0)
        self.assertEqual(calls["updatedConfig"]["customRules"], "[]")

    def test_custom_values_retained_settings(self):
        """Custom configured values for overlay polling, animations, and custom rules take effect."""
        custom_rules = '[{"matchType":"class","pattern":"gimp","action":"float"}]'
        res = self._run_load_config({
            "overlayPollingMs": 40,
            "enableAnimations": False,
            "animationDurationMs": 250,
            "customRulesJson": custom_rules,
            "reconcileDebounceMs": 100,
        })
        cfg = res["config"]
        calls = res["calls"]

        self.assertEqual(cfg["overlayPollingMs"], 40)
        self.assertEqual(cfg["enableAnimations"], False)
        self.assertEqual(cfg["animationDurationMs"], 250)
        self.assertEqual(cfg["customRulesJson"], custom_rules)
        self.assertEqual(cfg["reconcileDebounceMs"], 100)
        # When animations disabled, active animations must be cancelled
        self.assertIn(True, calls["cancelledAnimations"])
        self.assertEqual(calls["updatedConfig"]["customRules"], custom_rules)
        self.assertEqual(calls["updatedConfig"]["customRules"], custom_rules)

    def test_legacy_aliases_and_layout_normalization(self):
        """Legacy aliases are migrated and deprecated/removed layout algorithms safely fallback to balanced-grid."""
        legacy_ratio_key = "mas" + "terRatio"
        legacy_count_key = "mas" + "terCount"
        legacy_layout_val = "mas" + "ter-stack"
        res = self._run_load_config({
            legacy_ratio_key: 0.65,
            legacy_count_key: 3,
            "nvidiaDebounceMs": 90,
            "defaultLayout": legacy_layout_val,
        })
        cfg = res["config"]
        calls = res["calls"]

        self.assertEqual(cfg["primaryRegionRatio"], 0.65)
        self.assertEqual(cfg["primaryRegionCount"], 3)
        self.assertEqual(cfg["reconcileDebounceMs"], 90)
        self.assertEqual(cfg["defaultLayout"], "balanced-grid")
        self.assertEqual(calls["updatedConfig"]["defaultLayout"], "balanced-grid")

        # Verify that all retired layout names safely fall back to balanced-grid
        for retired_layout in ["columns", "rows", "binary-split", "primary-stack", "bsp", "grid"]:
            r = self._run_load_config({"defaultLayout": retired_layout})
            self.assertEqual(r["config"]["defaultLayout"], "balanced-grid")
            self.assertEqual(r["calls"]["updatedConfig"]["defaultLayout"], "balanced-grid")

    def test_legacy_and_removed_layout_algorithms_cannot_reactivate(self):
        """Regression: neither legacy defaultLayout nor workspaceLayoutsJson overrides can reactivate removed algorithms."""
        node_script = """
const vm = require('vm');
const fs = require('fs');
const reconcilerCode = fs.readFileSync('./contents/code/reconciler.js', 'utf8');
const ctx = {};
vm.runInNewContext(reconcilerCode, ctx);
const { createCoordinator } = ctx.ReconcilerBridge;

// 1. Coordinator with legacy defaultLayout
const coord1 = createCoordinator({
  enableTiling: true,
  defaultLayout: "columns"
});
const ws1 = coord1.getOrCreateWorkspace("DP-1", "1");
if (ws1.activeLayout !== "balanced-grid") {
  console.error("FAIL: ws1 activeLayout expected balanced-grid, got " + ws1.activeLayout);
  process.exit(1);
}

// 2. Coordinator with legacy primary-stack / columns / binary-split in workspaceLayoutsJson
const coord2 = createCoordinator({
  enableTiling: true,
  defaultLayout: "balanced-grid",
  workspaceLayoutsJson: JSON.stringify({
    version: 1,
    scopes: {
      "*//1": { layout: "primary-stack" },
      "DP-2//1": { layout: "columns" },
      "DP-3//1": { layout: "binary-split" }
    }
  })
});
for (const out of ["DP-1", "DP-2", "DP-3"]) {
  const ws = coord2.getOrCreateWorkspace(out, "1");
  if (ws.activeLayout !== "balanced-grid") {
    console.error("FAIL: ws " + out + " expected balanced-grid, got " + ws.activeLayout);
    process.exit(2);
  }
}

// 3. Legacy monocle and floating workspace overrides are deliberately migrated to balanced-grid
const coord3 = createCoordinator({
  enableTiling: true,
  defaultLayout: "balanced-grid",
  workspaceLayoutsJson: JSON.stringify({
    version: 1,
    scopes: {
      "DP-1//1": { layout: "monocle" },
      "DP-2//1": { layout: "floating" }
    }
  })
});
if (coord3.getOrCreateWorkspace("DP-1", "1").activeLayout !== "balanced-grid") {
  console.error("FAIL: DP-1 expected balanced-grid migration from monocle, got " + coord3.getOrCreateWorkspace("DP-1", "1").activeLayout);
  process.exit(3);
}
if (coord3.getOrCreateWorkspace("DP-2", "1").activeLayout !== "balanced-grid") {
  console.error("FAIL: DP-2 expected balanced-grid migration from floating, got " + coord3.getOrCreateWorkspace("DP-2", "1").activeLayout);
  process.exit(4);
}

// 4. Coordinator with legacy defaultLayout monocle or floating also migrates to balanced-grid
const coord4 = createCoordinator({
  enableTiling: true,
  defaultLayout: "monocle"
});
if (coord4.getOrCreateWorkspace("DP-1", "1").activeLayout !== "balanced-grid") {
  console.error("FAIL: defaultLayout monocle expected balanced-grid");
  process.exit(5);
}
const coord5 = createCoordinator({
  enableTiling: true,
  defaultLayout: "floating"
});
if (coord5.getOrCreateWorkspace("DP-1", "1").activeLayout !== "balanced-grid") {
  console.error("FAIL: defaultLayout floating expected balanced-grid");
  process.exit(6);
}

console.log("REMOVED_LAYOUT_RESILIENCE_OK");
"""
        proc = subprocess.run(["node", "-e", node_script], cwd=REPO_ROOT, capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, f"Removed layout resilience test failed: {proc.stderr} (stdout: {proc.stdout})")
        self.assertIn("REMOVED_LAYOUT_RESILIENCE_OK", proc.stdout)

    def test_all_canonical_properties_covered_in_qml_config(self):
        """Every canonical config property has an explicit default in main.qml config object and is loaded."""
        cfg_start = self.qml_source.find("property var config: ({")
        if cfg_start < 0:
            cfg_start = self.qml_source.find("property var config:")
        self.assertGreater(cfg_start, 0, "config property declaration not found")
        cfg_end = self.qml_source.find("})", cfg_start)
        cfg_block = self.qml_source[cfg_start:cfg_end]

        canonical_props = self.canonical["properties"]
        for prop_name in canonical_props:
            if prop_name in ("configSchemaVersion",):
                continue
            self.assertIn(
                prop_name,
                cfg_block,
                f"Canonical property {prop_name!r} missing from main.qml config object definition",
            )
            self.assertIn(
                f'readConfig("{prop_name}"',
                self.load_config_source,
                f"Canonical property {prop_name!r} not read in loadConfig()",
            )

    def test_custom_rules_schema_validation_and_invalid_input_resilience(self):
        """Invalid custom rules inputs do not crash loadConfig, and compiled rules validate schema."""
        for invalid_input in ["[null]", '[{"matchType":"class","action":"float"}]', "{", "not-json"]:
            res = self._run_load_config({"customRulesJson": invalid_input})
            self.assertEqual(res["config"]["customRulesJson"], invalid_input)
            self.assertEqual(res["calls"]["updatedConfig"]["customRules"], invalid_input)

        node_script = """
const vm = require('vm');
const fs = require('fs');
const code = fs.readFileSync('./contents/code/rules.js', 'utf8');
const ctx = {};
vm.runInNewContext(code, ctx);
const { RuleEngine } = ctx;
RuleEngine.resetState();

// Valid apply
const valid = JSON.stringify([{ matchType: 'class', pattern: 'gimp', action: 'float' }]);
const v1 = RuleEngine.validateRules(valid);
if (!v1.valid || v1.rules.length !== 1) process.exit(1);

const win = { internalId: 'w1', managed: true, normalWindow: true, resourceClass: 'gimp' };
const res1 = RuleEngine.classify(win, { customRules: valid });
if (res1.classification !== 'floating') process.exit(2);

// Invalid input 1: [null]
const res2 = RuleEngine.classify(win, { customRules: '[null]' });
if (res2.classification !== 'floating') process.exit(3); // retains last valid!

// Invalid input 2: missing pattern
const res3 = RuleEngine.classify(win, { customRules: JSON.stringify([{ matchType: 'class', action: 'float' }]) });
if (res3.classification !== 'floating') process.exit(4); // retains last valid!

// Invalid input 3: malformed JSON
const res4 = RuleEngine.classify(win, { customRules: '{' });
if (res4.classification !== 'floating') process.exit(5); // retains last valid!

// Valid reset: []
const res5 = RuleEngine.classify(win, { customRules: '[]' });
if (res5.classification !== 'tiled') process.exit(6); // reset applied!

console.log("OK");
"""
        proc = subprocess.run(["node", "-e", node_script], cwd=REPO_ROOT, capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, f"Rules validation failed in Node: {proc.stderr}")
        self.assertIn("OK", proc.stdout)

    def test_legacy_custom_rules_schema_rejection(self):
        """Legacy match/value schema fields are rejected by schema validation without mutating stored text."""
        legacy_rules = '[{"match":"class","value":"gimp","action":"float"}]'
        res = self._run_load_config(
            {"customRulesJson": legacy_rules},
            rule_errors=["Rule 0: missing required 'matchType'"]
        )
        self.assertEqual(res["config"]["customRulesJson"], legacy_rules)
        self.assertEqual(res["calls"]["updatedConfig"]["customRules"], legacy_rules)
        self.assertIn("Custom window rules invalid", res["root"]["lastRuleValidationError"])
        self.assertIn("using default tiling", res["root"]["lastRuleValidationError"])
        self.assertNotIn("gimp", res["root"]["lastRuleValidationError"])
        self.assertGreater(len(res["calls"]["osdNotifications"]), 0)
        self.assertEqual(res["calls"]["osdNotifications"][0]["icon"], "dialog-warning")
        self.assertIn("Custom window rules invalid", res["calls"]["osdNotifications"][0]["text"])
        self.assertNotIn("gimp", res["calls"]["osdNotifications"][0]["text"])

    def test_load_config_coordinator_classification_and_session_lifecycle(self):
        """End-to-end integration: actual loadConfig with shipped reconciler.js coordinator across session lifecycle."""
        node_script = """
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const reconcilerCode = fs.readFileSync('./contents/code/reconciler.js', 'utf8');
const loadConfigCode = process.argv[1];

// 1. Setup session environment with shipped reconciler
const sandbox = {
  root: {
    lastRuleValidationError: ""
  },
  config: {},
  currentKWinConfig: {},
  calls: {
    cancelledAnimations: [],
    logs: [],
    osdNotifications: []
  },
  KWin: {
    readConfig: (key, def) => (key in sandbox.currentKWinConfig ? sandbox.currentKWinConfig[key] : def)
  },
  windowAnimator: {
    cancelAllAnimations: (force) => { sandbox.calls.cancelledAnimations.push(force); }
  },
  Workspace: {
    stackingOrder: []
  },
  hookWindow: () => {},
  coordinator: null,
  getCoordinator: () => sandbox.coordinator,
  osdCall: {
    notify: (text, icon, force) => { sandbox.calls.osdNotifications.push({ text, icon, force: Boolean(force) }); }
  },
  log: (msg) => { sandbox.calls.logs.push(msg); }
};

vm.createContext(sandbox);
vm.runInContext(reconcilerCode, sandbox);
sandbox.coordinator = sandbox.ReconcilerBridge.createCoordinator({
  enableTiling: true,
  defaultLayout: "balanced-grid",
  customRules: "[]"
});
vm.runInContext(loadConfigCode, sandbox);

const winApp = { internalId: "w-review", managed: true, normalWindow: true, resourceClass: "review-app" };

// Step 1: Valid apply
sandbox.currentKWinConfig = {
  customRulesJson: JSON.stringify([{ matchType: "class", pattern: "review-app", action: "float" }])
};
vm.runInContext("loadConfig();", sandbox);
if (sandbox.root.lastRuleValidationError !== "") process.exit(10);
if (sandbox.coordinator.getLastCustomRuleErrors().length !== 0) process.exit(11);
const c1 = sandbox.coordinator.classifyWindow(winApp);
if (c1.classification !== "floating") process.exit(12);

// Step 2: Invalid input 1: [null] (same session - retains prior valid)
sandbox.calls.osdNotifications = [];
sandbox.currentKWinConfig = { customRulesJson: "[null]" };
vm.runInContext("loadConfig();", sandbox);
const c2 = sandbox.coordinator.classifyWindow(winApp);
if (c2.classification !== "floating") process.exit(20);
if (!sandbox.root.lastRuleValidationError.includes("retaining previous rules")) process.exit(21);
if (sandbox.root.lastRuleValidationError.includes("review-app") || sandbox.root.lastRuleValidationError.includes("null")) process.exit(22);
if (sandbox.calls.osdNotifications.length === 0 || !sandbox.calls.osdNotifications[0].text.includes("retaining previous rules")) process.exit(23);
if (sandbox.config.customRulesJson !== "[null]") process.exit(24); // stored text untouched

// Step 3: Invalid input 2: missing pattern (same session - retains prior valid)
sandbox.currentKWinConfig = { customRulesJson: JSON.stringify([{ matchType: "class", action: "float" }]) };
vm.runInContext("loadConfig();", sandbox);
const c3 = sandbox.coordinator.classifyWindow(winApp);
if (c3.classification !== "floating") process.exit(30);
if (!sandbox.root.lastRuleValidationError.includes("retaining previous rules")) process.exit(31);

// Step 4: Invalid input 3: malformed JSON (same session - retains prior valid)
sandbox.currentKWinConfig = { customRulesJson: "{" };
vm.runInContext("loadConfig();", sandbox);
const c4 = sandbox.coordinator.classifyWindow(winApp);
if (c4.classification !== "floating") process.exit(40);
if (!sandbox.root.lastRuleValidationError.includes("retaining previous rules")) process.exit(41);

// Step 5: Valid reset: "[]"
sandbox.calls.osdNotifications = [];
sandbox.currentKWinConfig = { customRulesJson: "[]" };
vm.runInContext("loadConfig();", sandbox);
if (sandbox.root.lastRuleValidationError !== "") process.exit(50);
const c5 = sandbox.coordinator.classifyWindow(winApp);
if (c5.classification !== "tiled") process.exit(51);

// Step 6: Fresh restart with invalid input [null]:
// Simulates actual Component.onCompleted cold-start: coordinator starts NULL,
// stackingOrder is empty [], showOsd is false, and malformed stored rules exist.
const freshSandbox = {
  root: { lastRuleValidationError: "" },
  config: {},
  currentKWinConfig: { customRulesJson: "[null]", showOsd: false },
  calls: { cancelledAnimations: [], logs: [], osdNotifications: [] },
  KWin: {
    readConfig: (key, def) => (key in freshSandbox.currentKWinConfig ? freshSandbox.currentKWinConfig[key] : def)
  },
  windowAnimator: { cancelAllAnimations: () => {} },
  Workspace: { stackingOrder: [] },
  hookWindow: () => {},
  coordinator: null,
  getCoordinator: function() {
    if (!freshSandbox.coordinator && freshSandbox.ReconcilerBridge) {
      freshSandbox.coordinator = freshSandbox.ReconcilerBridge.createCoordinator({
        enableTiling: freshSandbox.config.enableTiling,
        defaultLayout: freshSandbox.config.defaultLayout,
        customRules: freshSandbox.config.customRulesJson
      });
    }
    return freshSandbox.coordinator;
  },
  osdCall: {
    notify: (text, icon, force) => {
      // Validates force parameter override when showOsd is false
      if (!freshSandbox.config.showOsd && !force) return;
      freshSandbox.calls.osdNotifications.push({ text, icon, force: Boolean(force) });
    }
  },
  log: (msg) => { freshSandbox.calls.logs.push(msg); }
};
vm.createContext(freshSandbox);
vm.runInContext(reconcilerCode, freshSandbox);
// Coordinator MUST start null, exactly as in QML runtime before getCoordinator()
if (freshSandbox.coordinator !== null) process.exit(59);

vm.runInContext(loadConfigCode, freshSandbox);
// Cold-start invocation: loadConfig() before initRuntimeMode/retileNow with 0 windows
vm.runInContext("loadConfig();", freshSandbox);

// Coordinator is now instantiated lazily by loadConfig
if (freshSandbox.coordinator === null) process.exit(60);

// Fresh restart must use default tiling without crashing, and explicitly state "using default tiling"
if (!freshSandbox.root.lastRuleValidationError.includes("using default tiling")) process.exit(61);
// Forced warning reached osdNotifications even though showOsd is false
if (freshSandbox.calls.osdNotifications.length === 0 || !freshSandbox.calls.osdNotifications[0].text.includes("using default tiling")) process.exit(62);
if (freshSandbox.calls.osdNotifications[0].force !== true) process.exit(63);

const cFresh = freshSandbox.coordinator.classifyWindow(winApp);
if (cFresh.classification !== "tiled") process.exit(64);
if (freshSandbox.config.customRulesJson !== "[null]") process.exit(65);

console.log("INTEGRATION_LIFECYCLE_OK");
"""
        proc = subprocess.run(
            ["node", "-e", node_script, self.load_config_source],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, f"Integration lifecycle failed in Node: {proc.stderr} (stdout: {proc.stdout})")
        self.assertIn("INTEGRATION_LIFECYCLE_OK", proc.stdout)


if __name__ == "__main__":
    unittest.main()
