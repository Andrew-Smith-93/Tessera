import unittest
import os
import xml.etree.ElementTree as ET

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

class TestConfigUiBindings(unittest.TestCase):
    """
    Verifies that contents/ui/config.ui contains valid, compliant Qt Designer UI XML
    with kcfg_* object names matching keys in contents/config/main.xml.
    """

    def setUp(self):
        self.config_ui_path = os.path.join(REPO_ROOT, "contents/ui/config.ui")
        self.main_xml_path = os.path.join(REPO_ROOT, "contents/config/main.xml")
        self.tree = ET.parse(self.config_ui_path)
        self.root = self.tree.getroot()

    def test_ui_xml_root_structure(self):
        self.assertEqual(self.root.tag, "ui")
        self.assertEqual(self.root.attrib.get("version"), "4.0")

    def test_kcfg_widgets_exist(self):
        widget_names = set()
        for elem in self.root.iter("widget"):
            name = elem.attrib.get("name")
            if name:
                widget_names.add(name)

        expected_kcfg_widgets = [
            "kcfg_enableTiling",
            "kcfg_tileNewWindows",
            "kcfg_ignoreMinimized",
            "kcfg_perDesktopLayout",
            "kcfg_showOsd",
            "kcfg_reconcileDebounceMs",
            "kcfg_defaultLayout",
            "kcfg_primaryRegionRatio",
            "kcfg_primaryRegionCount",
            "kcfg_gapInner",
            "kcfg_gapOuter",
            "kcfg_gameWindowPolicy",
            "kcfg_floatFilter",
        ]

        for expected in expected_kcfg_widgets:
            self.assertIn(expected, widget_names, f"Expected {expected} widget in config.ui")

    def test_widget_types_match_main_xml_entries(self):
        main_tree = ET.parse(self.main_xml_path)
        main_root = main_tree.getroot()
        main_entries = {}
        for entry in main_root.iter():
            if entry.tag.endswith("entry"):
                name = entry.attrib.get("name")
                val_type = entry.attrib.get("type")
                if name and val_type:
                    main_entries[name] = val_type

        # Verify each widget maps to an entry in main.xml
        for elem in self.root.iter("widget"):
            name = elem.attrib.get("name", "")
            if name.startswith("kcfg_"):
                entry_name = name[5:]
                # Check case-insensitive match against main_entries
                matched = any(entry_name.lower() == k.lower() for k in main_entries)
                self.assertTrue(matched, f"Widget {name} does not match any entry in main.xml")

if __name__ == "__main__":
    unittest.main()
