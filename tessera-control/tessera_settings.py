#!/usr/bin/env python3
"""
Tessera Control Center
Configuration and visual control interface for Tessera Tiling Window Manager on KDE Plasma 6.
Backed by transactional ConfigManager and canonical settings contract.
"""

import sys
import os
import subprocess
from typing import Any, Dict, Optional

from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QSlider, QSpinBox, QDoubleSpinBox, QCheckBox,
    QTabWidget, QTableWidget, QTableWidgetItem, QHeaderView, QComboBox,
    QLineEdit, QMessageBox, QFrame, QScrollArea, QGroupBox, QGridLayout,
    QDialog
)
from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtGui import QFont, QColor

from config_manager import ConfigManager
from presets import PRESETS
from ui_preview import LiveDesktopPreview
from window_picker import get_active_window_info

APP_STYLESHEET = """
QMainWindow {
    background-color: #1e222b;
}
QWidget {
    color: #eff0f1;
    font-family: 'Noto Sans', 'Segoe UI', sans-serif;
    font-size: 10pt;
}
QTabWidget::pane {
    border: 1px solid #31363b;
    background-color: #232629;
    border-radius: 8px;
    padding: 10px;
}
QTabBar::tab {
    background: #1e222b;
    color: #a0a6ad;
    padding: 10px 18px;
    border-top-left-radius: 6px;
    border-top-right-radius: 6px;
    margin-right: 4px;
    font-weight: 500;
}
QTabBar::tab:selected {
    background: #232629;
    color: #3daee9;
    border-bottom: 2px solid #3daee9;
}
QTabBar::tab:hover {
    color: #eff0f1;
}
QGroupBox {
    border: 1px solid #31363b;
    border-radius: 8px;
    margin-top: 18px;
    padding-top: 14px;
    font-weight: bold;
    color: #3daee9;
}
QGroupBox::title {
    subcontrol-origin: margin;
    subcontrol-position: top left;
    left: 12px;
    padding: 0 6px;
}
QPushButton {
    background-color: #31363b;
    border: 1px solid #474f56;
    border-radius: 6px;
    padding: 7px 16px;
    color: #eff0f1;
    font-weight: 500;
}
QPushButton:hover {
    background-color: #3daee9;
    border-color: #3daee9;
    color: #ffffff;
}
QPushButton:pressed {
    background-color: #2b84b5;
}
QPushButton#primaryBtn {
    background-color: #1b668f;
    border: 1px solid #3daee9;
    color: #ffffff;
    font-weight: bold;
}
QPushButton#primaryBtn:hover {
    background-color: #3daee9;
}
QSlider::groove:horizontal {
    height: 6px;
    background: #31363b;
    border-radius: 3px;
}
QSlider::sub-page:horizontal {
    background: #3daee9;
    border-radius: 3px;
}
QSlider::handle:horizontal {
    background: #eff0f1;
    width: 16px;
    margin-top: -5px;
    margin-bottom: -5px;
    border-radius: 8px;
}
QSlider::handle:horizontal:hover {
    background: #3daee9;
}
QTableWidget {
    background-color: #1e222b;
    border: 1px solid #31363b;
    border-radius: 6px;
    gridline-color: #31363b;
}
QTableWidget::item:selected {
    background-color: #1b668f;
}
QHeaderView::section {
    background-color: #2b2e33;
    padding: 6px;
    border: 1px solid #31363b;
    font-weight: bold;
}
QLineEdit, QComboBox, QSpinBox, QDoubleSpinBox {
    background-color: #1e222b;
    border: 1px solid #474f56;
    border-radius: 6px;
    padding: 6px;
    color: #eff0f1;
}
QLineEdit:focus, QComboBox:focus, QSpinBox:focus, QDoubleSpinBox:focus {
    border: 1px solid #3daee9;
}
"""

class LayoutCard(QFrame):
    def __init__(self, layout_id: str, title: str, desc: str, parent_window: Any):
        super().__init__()
        self.layout_id = layout_id
        self.parent_window = parent_window
        self.setFrameShape(QFrame.StyledPanel)
        self.setCursor(Qt.PointingHandCursor)
        self.setStyleSheet("""
            QFrame {
                background-color: #282c34;
                border: 2px solid #3a3f4b;
                border-radius: 8px;
                padding: 10px;
            }
            QFrame:hover {
                border-color: #3daee9;
                background-color: #2c313c;
            }
        """)

        layout = QVBoxLayout(self)
        layout.setSpacing(4)

        self.title_lbl = QLabel(title)
        self.title_lbl.setFont(QFont("SansSerif", 10, QFont.Bold))
        self.title_lbl.setStyleSheet("color: #eff0f1;")
        layout.addWidget(self.title_lbl)

        self.desc_lbl = QLabel(desc)
        self.desc_lbl.setStyleSheet("color: #8a98a8; font-size: 8.5pt;")
        self.desc_lbl.setWordWrap(True)
        layout.addWidget(self.desc_lbl)

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.parent_window.select_default_layout(self.layout_id)

    def set_selected(self, selected: bool):
        if selected:
            self.setStyleSheet("""
                QFrame {
                    background-color: #1c364d;
                    border: 2px solid #3daee9;
                    border-radius: 8px;
                    padding: 10px;
                }
            """)
            self.title_lbl.setStyleSheet("color: #3daee9; font-weight: bold;")
        else:
            self.setStyleSheet("""
                QFrame {
                    background-color: #282c34;
                    border: 2px solid #3a3f4b;
                    border-radius: 8px;
                    padding: 10px;
                }
                QFrame:hover {
                    border-color: #3daee9;
                    background-color: #2c313c;
                }
            """)
            self.title_lbl.setStyleSheet("color: #eff0f1;")


class TesseraControlWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Tessera Control Center — KDE Plasma 6")
        self.resize(880, 700)
        self.setStyleSheet(APP_STYLESHEET)

        self.cfg_mgr = ConfigManager()
        self.layout_cards: Dict[str, LayoutCard] = {}
        self._is_loading = False

        self.init_ui()
        self.load_settings_into_ui()

    def init_ui(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_vbox = QVBoxLayout(central_widget)
        main_vbox.setContentsMargins(16, 16, 16, 16)
        main_vbox.setSpacing(12)

        # Header Bar
        header_hbox = QHBoxLayout()
        title_vbox = QVBoxLayout()
        app_title = QLabel("TESSERA CONTROL CENTER")
        app_title.setFont(QFont("SansSerif", 14, QFont.Bold))
        app_title.setStyleSheet("color: #3daee9; letter-spacing: 1px;")
        app_sub = QLabel("Dynamic Tiling Window Manager for KDE Plasma 6")
        app_sub.setStyleSheet("color: #8c939d; font-size: 9pt;")
        title_vbox.addWidget(app_title)
        title_vbox.addWidget(app_sub)

        header_hbox.addLayout(title_vbox)
        header_hbox.addStretch()

        self.enable_switch = QCheckBox("Enable Tiling")
        self.enable_switch.setFont(QFont("SansSerif", 11, QFont.Bold))
        self.enable_switch.toggled.connect(self.on_enable_toggled)
        header_hbox.addWidget(self.enable_switch)

        main_vbox.addLayout(header_hbox)

        # Tabs
        self.tabs = QTabWidget()
        self.tabs.addTab(self.create_layouts_tab(), "📐 Layouts & Presets")
        self.tabs.addTab(self.create_gaps_tab(), "📏 Gaps & Primary Region")
        self.tabs.addTab(self.create_workspaces_tab(), "🖥️ Workspaces")
        self.tabs.addTab(self.create_rules_tab(), "🎯 Window Rules")
        self.tabs.addTab(self.create_performance_tab(), "⚡ Performance & Motion")
        self.tabs.addTab(self.create_shortcuts_tab(), "⌨️ Shortcuts")

        main_vbox.addWidget(self.tabs)

        # Footer Actions
        footer_hbox = QHBoxLayout()
        self.status_lbl = QLabel("Ready")
        self.status_lbl.setStyleSheet("color: #6c757d; font-style: italic;")
        footer_hbox.addWidget(self.status_lbl)
        footer_hbox.addStretch()

        self.reset_btn = QPushButton("↺ Reset")
        self.reset_btn.setToolTip("Discard unsaved changes and reload current saved settings")
        self.reset_btn.clicked.connect(self.reset_to_saved)
        footer_hbox.addWidget(self.reset_btn)

        self.defaults_btn = QPushButton("⚙ Restore Defaults")
        self.defaults_btn.setToolTip("Load factory default settings into draft")
        self.defaults_btn.clicked.connect(self.restore_defaults)
        footer_hbox.addWidget(self.defaults_btn)

        self.reload_kwin_btn = QPushButton("🔄 Retile Now")
        self.reload_kwin_btn.setToolTip("Trigger immediate workspace retiling without saving draft")
        self.reload_kwin_btn.clicked.connect(self.retile_kwin)
        footer_hbox.addWidget(self.reload_kwin_btn)

        self.save_btn = QPushButton("💾 Save & Apply")
        self.save_btn.setObjectName("primaryBtn")
        self.save_btn.setToolTip("Validate and write changes to kwinrc transactionally")
        self.save_btn.clicked.connect(self.save_and_apply)
        footer_hbox.addWidget(self.save_btn)

        main_vbox.addLayout(footer_hbox)

    # -------------------------------------------------------------
    # TAB 1: Layouts & Presets
    # -------------------------------------------------------------
    def create_layouts_tab(self):
        tab = QWidget()
        layout = QVBoxLayout(tab)

        # Presets Bar
        preset_box = QGroupBox("Workflow Presets")
        preset_layout = QHBoxLayout(preset_box)
        preset_layout.addWidget(QLabel("Load Preset Configuration:"))

        self.preset_combo = QComboBox()
        self.preset_combo.addItems(list(PRESETS.keys()))
        preset_layout.addWidget(self.preset_combo, 1)

        apply_preset_btn = QPushButton("Apply Preset")
        apply_preset_btn.clicked.connect(self.on_apply_preset_clicked)
        preset_layout.addWidget(apply_preset_btn)
        layout.addWidget(preset_box)

        lbl = QLabel("Select Default Tiling Layout:")
        lbl.setFont(QFont("SansSerif", 11, QFont.Bold))
        layout.addWidget(lbl)

        grid = QGridLayout()
        grid.setSpacing(12)

        card_defs = [
            ("balanced-grid", "Balanced Grid", "Optimal square tiles with equitable distribution (no single dominant master)."),
            ("primary-stack", "Primary + Stack", "Prominent primary work area on left; secondary windows stacked on right."),
            ("binary-split", "Binary Split (BSP)", "Alternates horizontal and vertical partitions recursively (Dwindle style)."),
            ("columns", "Columns", "Arranges all open windows into equal vertical columns across the screen."),
            ("rows", "Rows", "Arranges windows in horizontal bands across the screen."),
            ("monocle", "Monocle (Deck)", "Full-screen working area for focused window with rapid cycle switching."),
            ("floating", "Floating Only", "Preserves manual floating positions without automatic tiling.")
        ]

        row = 0
        col = 0
        for lid, title, desc in card_defs:
            card = LayoutCard(lid, title, desc, self)
            self.layout_cards[lid] = card
            grid.addWidget(card, row, col)
            col += 1
            if col > 1:
                col = 0
                row += 1

        layout.addLayout(grid)

        # Behavior options
        grp = QGroupBox("Tiling Behavior")
        grp_layout = QVBoxLayout(grp)
        self.tile_new_chk = QCheckBox("Automatically tile newly spawned windows")
        self.tile_new_chk.toggled.connect(lambda v: self.on_bool_changed("tileNewWindows", v))
        self.ignore_minimized_chk = QCheckBox("Ignore minimized windows during tile layout calculation")
        self.ignore_minimized_chk.toggled.connect(lambda v: self.on_bool_changed("ignoreMinimized", v))
        self.show_osd_chk = QCheckBox("Show On-Screen Display (OSD) on layout change")
        self.show_osd_chk.toggled.connect(lambda v: self.on_bool_changed("showOsd", v))

        grp_layout.addWidget(self.tile_new_chk)
        grp_layout.addWidget(self.ignore_minimized_chk)
        grp_layout.addWidget(self.show_osd_chk)
        layout.addWidget(grp)

        layout.addStretch()
        return tab

    def on_apply_preset_clicked(self):
        name = self.preset_combo.currentText()
        if name in PRESETS:
            preset = PRESETS[name]
            self.cfg_mgr.apply_preset_to_draft(preset["values"])
            self.load_settings_into_ui()
            self.set_status(f"Loaded preset: {name} (click Save & Apply to commit)")

    def select_default_layout(self, layout_id: str):
        self.cfg_mgr.set_draft_value("defaultLayout", layout_id)
        for lid, card in self.layout_cards.items():
            card.set_selected(lid == layout_id)
        self.refresh_preview()
        self.update_dirty_status()

    # -------------------------------------------------------------
    # TAB 2: Gaps & Primary Region (With Live Preview)
    # -------------------------------------------------------------
    def create_gaps_tab(self):
        tab = QWidget()
        layout = QHBoxLayout(tab)
        layout.setSpacing(16)

        # Controls VBox
        ctrl_vbox = QVBoxLayout()

        # Inner Gap
        inner_grp = QGroupBox("Inner Gap (Spacing between windows)")
        ig_layout = QVBoxLayout(inner_grp)
        self.inner_gap_val = QLabel("8 px")
        self.inner_gap_val.setStyleSheet("color: #3daee9; font-weight: bold;")
        self.inner_gap_slider = QSlider(Qt.Horizontal)
        self.inner_gap_slider.setRange(0, 40)
        self.inner_gap_slider.setValue(8)
        self.inner_gap_slider.valueChanged.connect(self.on_inner_gap_changed)
        ig_layout.addWidget(self.inner_gap_val)
        ig_layout.addWidget(self.inner_gap_slider)
        ctrl_vbox.addWidget(inner_grp)

        # Outer Gap
        outer_grp = QGroupBox("Outer Gap (Screen edge margin)")
        og_layout = QVBoxLayout(outer_grp)
        self.outer_gap_val = QLabel("10 px")
        self.outer_gap_val.setStyleSheet("color: #3daee9; font-weight: bold;")
        self.outer_gap_slider = QSlider(Qt.Horizontal)
        self.outer_gap_slider.setRange(0, 60)
        self.outer_gap_slider.setValue(10)
        self.outer_gap_slider.valueChanged.connect(self.on_outer_gap_changed)
        og_layout.addWidget(self.outer_gap_val)
        og_layout.addWidget(self.outer_gap_slider)
        ctrl_vbox.addWidget(outer_grp)

        # Primary Region Ratio
        ratio_grp = QGroupBox("Primary Region Ratio (% of screen width)")
        rg_layout = QVBoxLayout(ratio_grp)
        self.primary_ratio_val = QLabel("50%")
        self.primary_ratio_val.setStyleSheet("color: #3daee9; font-weight: bold;")
        self.primary_ratio_slider = QSlider(Qt.Horizontal)
        self.primary_ratio_slider.setRange(20, 80)
        self.primary_ratio_slider.setValue(50)
        self.primary_ratio_slider.valueChanged.connect(self.on_primary_ratio_changed)
        rg_layout.addWidget(self.primary_ratio_val)
        rg_layout.addWidget(self.primary_ratio_slider)
        ctrl_vbox.addWidget(ratio_grp)

        # Primary Region Count
        count_grp = QGroupBox("Primary Region Window Count")
        cg_layout = QHBoxLayout(count_grp)
        self.primary_count_spin = QSpinBox()
        self.primary_count_spin.setRange(1, 5)
        self.primary_count_spin.setValue(1)
        self.primary_count_spin.valueChanged.connect(self.on_primary_count_changed)
        cg_layout.addWidget(QLabel("Primary Windows:"))
        cg_layout.addWidget(self.primary_count_spin)
        ctrl_vbox.addWidget(count_grp)

        ctrl_vbox.addStretch()
        layout.addLayout(ctrl_vbox, 1)

        # Live Preview VBox
        preview_vbox = QVBoxLayout()
        p_title = QLabel("LIVE DESKTOP PREVIEW")
        p_title.setFont(QFont("SansSerif", 10, QFont.Bold))
        p_title.setStyleSheet("color: #3daee9;")
        preview_vbox.addWidget(p_title)

        self.preview_widget = LiveDesktopPreview()
        preview_vbox.addWidget(self.preview_widget, 1)

        p_hint = QLabel("Adjust sliders above to observe spacing and margins in real-time.")
        p_hint.setStyleSheet("color: #6c757d; font-size: 8.5pt;")
        p_hint.setWordWrap(True)
        preview_vbox.addWidget(p_hint)

        layout.addLayout(preview_vbox, 1)
        return tab

    def on_inner_gap_changed(self, val: int):
        self.inner_gap_val.setText(f"{val} px")
        if not self._is_loading:
            self.cfg_mgr.set_draft_value("gapInner", val)
            self.refresh_preview()
            self.update_dirty_status()

    def on_outer_gap_changed(self, val: int):
        self.outer_gap_val.setText(f"{val} px")
        if not self._is_loading:
            self.cfg_mgr.set_draft_value("gapOuter", val)
            self.refresh_preview()
            self.update_dirty_status()

    def on_primary_ratio_changed(self, val: int):
        self.primary_ratio_val.setText(f"{val}%")
        if not self._is_loading:
            self.cfg_mgr.set_draft_value("primaryRegionRatio", val / 100.0)
            self.refresh_preview()
            self.update_dirty_status()

    def on_primary_count_changed(self, val: int):
        if not self._is_loading:
            self.cfg_mgr.set_draft_value("primaryRegionCount", val)
            self.refresh_preview()
            self.update_dirty_status()

    def on_bool_changed(self, key: str, val: bool):
        if not self._is_loading:
            self.cfg_mgr.set_draft_value(key, val)
            self.update_dirty_status()

    def refresh_preview(self):
        dl = self.cfg_mgr.get_draft_value("defaultLayout", "balanced-grid")
        gi = self.cfg_mgr.get_draft_value("gapInner", 8)
        go = self.cfg_mgr.get_draft_value("gapOuter", 10)
        pr = self.cfg_mgr.get_draft_value("primaryRegionRatio", 0.50)
        pc = self.cfg_mgr.get_draft_value("primaryRegionCount", 1)
        self.preview_widget.update_params(dl, gi, go, pr, pc)
        if hasattr(self, 'anim_preview_widget'):
            self.anim_preview_widget.update_params(dl, gi, go, pr, pc)

    # -------------------------------------------------------------
    # TAB 3: Workspaces
    # -------------------------------------------------------------
    def create_workspaces_tab(self):
        tab = QWidget()
        layout = QVBoxLayout(tab)

        self.per_desktop_chk = QCheckBox("Enable Independent Layouts per Virtual Desktop")
        self.per_desktop_chk.setChecked(True)
        self.per_desktop_chk.toggled.connect(lambda v: self.on_bool_changed("perDesktopLayout", v))
        layout.addWidget(self.per_desktop_chk)

        grp = QGroupBox("Virtual Desktop Layout Assignments")
        grp_layout = QGridLayout(grp)
        grp_layout.setSpacing(12)

        self.desk_combos: Dict[str, QComboBox] = {}
        layouts_list = ["balanced-grid", "primary-stack", "binary-split", "columns", "rows", "monocle", "floating"]

        for d in range(1, 7):
            lbl = QLabel(f"Virtual Desktop {d}:")
            lbl.setFont(QFont("SansSerif", 10, QFont.Bold))
            cb = QComboBox()
            cb.addItems(layouts_list)
            cb.currentTextChanged.connect(self.on_workspace_layout_changed)
            self.desk_combos[str(d)] = cb

            row = (d - 1) // 2
            col = ((d - 1) % 2) * 2
            grp_layout.addWidget(lbl, row, col)
            grp_layout.addWidget(cb, row, col + 1)

        layout.addWidget(grp)
        layout.addStretch()
        return tab

    def on_workspace_layout_changed(self):
        if self._is_loading:
            return
        desk_map = {d: cb.currentText() for d, cb in self.desk_combos.items()}
        self.cfg_mgr.set_draft_value("desktopLayouts", desk_map)
        self.update_dirty_status()

    # -------------------------------------------------------------
    # TAB 4: Window Rules (Interactive)
    # -------------------------------------------------------------
    def create_rules_tab(self):
        tab = QWidget()
        layout = QVBoxLayout(tab)

        # Picker bar
        picker_box = QGroupBox("Interactive Window Rule Creator")
        p_layout = QHBoxLayout(picker_box)

        self.capture_btn = QPushButton("🎯 Capture Active Window")
        self.capture_btn.setStyleSheet("background-color: #2e5b88; font-weight: bold;")
        self.capture_btn.clicked.connect(self.capture_active_window)
        p_layout.addWidget(self.capture_btn)

        self.rule_pattern_edit = QLineEdit()
        self.rule_pattern_edit.setPlaceholderText("Window class or title (e.g. Steam, spotify, kcalc)")
        p_layout.addWidget(self.rule_pattern_edit, 2)

        self.rule_type_combo = QComboBox()
        self.rule_type_combo.addItems(["class", "title"])
        p_layout.addWidget(self.rule_type_combo)

        self.rule_action_combo = QComboBox()
        self.rule_action_combo.addItems(["float", "tile"])
        p_layout.addWidget(self.rule_action_combo)

        add_rule_btn = QPushButton("➕ Add Rule")
        add_rule_btn.clicked.connect(self.add_custom_rule)
        p_layout.addWidget(add_rule_btn)

        layout.addWidget(picker_box)

        # Game Window Policy
        game_box = QGroupBox("Game Window Classification")
        g_layout = QHBoxLayout(game_box)
        g_label = QLabel("Default behavior for game windows (Steam games, Gamescope, borderless games):")
        self.game_policy_combo = QComboBox()
        self.game_policy_combo.addItems(["floating", "tile"])
        self.game_policy_combo.currentTextChanged.connect(self.on_game_policy_changed)
        g_layout.addWidget(g_label)
        g_layout.addWidget(self.game_policy_combo)
        layout.addWidget(game_box)

        # Rules Table
        self.rules_table = QTableWidget(0, 3)
        self.rules_table.setHorizontalHeaderLabels(["Pattern", "Match Type", "Action"])
        self.rules_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.rules_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.rules_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        layout.addWidget(self.rules_table)

        btn_bar = QHBoxLayout()
        del_rule_btn = QPushButton("🗑️ Remove Selected Rule")
        del_rule_btn.clicked.connect(self.remove_selected_rule)
        btn_bar.addWidget(del_rule_btn)
        btn_bar.addStretch()
        layout.addLayout(btn_bar)

        return tab

    def capture_active_window(self):
        self.set_status("Inspecting active window...")
        info = get_active_window_info()
        target = info.get("class") or info.get("title")
        if target:
            self.rule_pattern_edit.setText(target)
            self.rule_type_combo.setCurrentText("class" if info.get("class") else "title")
            self.set_status(f"Captured window: {target}")
        else:
            self.set_status("Focus desired window, then click Capture again.")

    def on_game_policy_changed(self, val: str):
        if not self._is_loading:
            self.cfg_mgr.set_draft_value("gameWindowPolicy", val)
            self.update_dirty_status()

    def add_custom_rule(self):
        pat = self.rule_pattern_edit.text().strip()
        if not pat:
            return
        mtype = self.rule_type_combo.currentText()
        act = self.rule_action_combo.currentText()

        rules = list(self.cfg_mgr.get_draft_value("customRules", []))
        rules.append({"pattern": pat, "matchType": mtype, "action": act})
        self.cfg_mgr.set_draft_value("customRules", rules)
        self.populate_rules_table()
        self.rule_pattern_edit.clear()
        self.update_dirty_status()

    def remove_selected_rule(self):
        row = self.rules_table.currentRow()
        if row >= 0:
            rules = list(self.cfg_mgr.get_draft_value("customRules", []))
            if row < len(rules):
                del rules[row]
                self.cfg_mgr.set_draft_value("customRules", rules)
                self.populate_rules_table()
                self.update_dirty_status()

    def populate_rules_table(self):
        rules = self.cfg_mgr.get_draft_value("customRules", [])
        self.rules_table.setRowCount(len(rules))
        for r_idx, rule in enumerate(rules):
            self.rules_table.setItem(r_idx, 0, QTableWidgetItem(rule.get("pattern", "")))
            self.rules_table.setItem(r_idx, 1, QTableWidgetItem(rule.get("matchType", "class")))
            act_item = QTableWidgetItem(rule.get("action", "float"))
            if rule.get("action") == "float":
                act_item.setForeground(QColor("#f67400"))
            else:
                act_item.setForeground(QColor("#27ae60"))
            self.rules_table.setItem(r_idx, 2, act_item)

    # -------------------------------------------------------------
    # TAB 5: Performance & Motion
    # -------------------------------------------------------------
    def create_performance_tab(self):
        tab = QWidget()
        layout = QHBoxLayout(tab)
        layout.setSpacing(16)

        left_vbox = QVBoxLayout()

        grp = QGroupBox("Performance & Debounce Timing")
        g_layout = QVBoxLayout(grp)
        g_layout.setSpacing(12)

        lbl_desc = QLabel(
            "Tessera coalesces window events through the runtime coordinator to prevent resize flicker "
            "and unnecessary layout recomputations."
        )
        lbl_desc.setWordWrap(True)
        lbl_desc.setStyleSheet("color: #a0a6ad; margin-bottom: 6px;")
        g_layout.addWidget(lbl_desc)

        # Debounce slider
        deb_box = QVBoxLayout()
        d_top = QHBoxLayout()
        d_label = QLabel("Reconciliation Debounce:")
        d_label.setFont(QFont("SansSerif", 10, QFont.Bold))
        self.debounce_val = QLabel("60 ms")
        self.debounce_val.setStyleSheet("color: #3daee9; font-weight: bold;")
        d_top.addWidget(d_label)
        d_top.addStretch()
        d_top.addWidget(self.debounce_val)
        deb_box.addLayout(d_top)

        self.debounce_slider = QSlider(Qt.Horizontal)
        self.debounce_slider.setRange(0, 300)
        self.debounce_slider.setValue(60)
        self.debounce_slider.valueChanged.connect(self.on_debounce_changed)
        deb_box.addWidget(self.debounce_slider)
        g_layout.addLayout(deb_box)

        # Polling rate slider
        resp_box = QVBoxLayout()
        r_top = QHBoxLayout()
        r_label = QLabel("Cursor Tracking & Snap Overlay Polling:")
        r_label.setFont(QFont("SansSerif", 10, QFont.Bold))
        self.polling_val = QLabel("16 ms (60 FPS)")
        self.polling_val.setStyleSheet("color: #3daee9; font-weight: bold;")
        r_top.addWidget(r_label)
        r_top.addStretch()
        r_top.addWidget(self.polling_val)
        resp_box.addLayout(r_top)

        self.polling_slider = QSlider(Qt.Horizontal)
        self.polling_slider.setRange(8, 60)
        self.polling_slider.setValue(16)
        self.polling_slider.valueChanged.connect(self.on_polling_changed)
        resp_box.addWidget(self.polling_slider)
        g_layout.addLayout(resp_box)

        # Movement animation preview options
        anim_grp = QGroupBox("Window Movement Animation Preview")
        a_layout = QVBoxLayout(anim_grp)

        a_top = QHBoxLayout()
        a_lbl = QLabel("Preview Animation Curve:")
        self.anim_mode_combo = QComboBox()
        self.anim_mode_combo.addItem("Off (Instant)", "off")
        self.anim_mode_combo.addItem("Smooth Slide (Linear)", "slide")
        self.anim_mode_combo.addItem("Gentle Ease-Out (Cubic)", "ease_out")
        self.anim_mode_combo.addItem("Dynamic Spring (Back-Out)", "spring")
        self.anim_mode_combo.currentIndexChanged.connect(self.on_animation_changed)
        a_top.addWidget(a_lbl)
        a_top.addWidget(self.anim_mode_combo, 1)
        a_layout.addLayout(a_top)

        self.test_anim_btn = QPushButton("▶ Test Movement Animation")
        self.test_anim_btn.clicked.connect(self.test_window_animation)
        a_layout.addWidget(self.test_anim_btn)

        g_layout.addWidget(anim_grp)

        left_vbox.addWidget(grp)
        left_vbox.addStretch()
        layout.addLayout(left_vbox, 1)

        # Right side: Animation Preview
        right_vbox = QVBoxLayout()
        r_title = QLabel("MOTION PREVIEW")
        r_title.setFont(QFont("SansSerif", 10, QFont.Bold))
        r_title.setStyleSheet("color: #3daee9;")
        right_vbox.addWidget(r_title)

        self.anim_preview_widget = LiveDesktopPreview()
        right_vbox.addWidget(self.anim_preview_widget, 1)

        anim_hint = QLabel("Select an animation curve and click 'Test Movement Animation' to preview window motion.")
        anim_hint.setStyleSheet("color: #6c757d; font-size: 8.5pt;")
        anim_hint.setWordWrap(True)
        right_vbox.addWidget(anim_hint)

        layout.addLayout(right_vbox, 1)
        return tab

    def on_debounce_changed(self, val: int):
        self.debounce_val.setText(f"{val} ms")
        if not self._is_loading:
            self.cfg_mgr.set_draft_value("reconcileDebounceMs", val)
            self.update_dirty_status()

    def on_polling_changed(self, val: int):
        fps = round(1000 / val) if val > 0 else 60
        self.polling_val.setText(f"{val} ms ({fps} FPS)")
        if not self._is_loading:
            self.cfg_mgr.set_draft_value("overlayPollingMs", val)
            self.update_dirty_status()

    def on_animation_changed(self):
        mode = self.anim_mode_combo.currentData()
        self.preview_widget.set_animation_settings(mode, 200)
        self.anim_preview_widget.set_animation_settings(mode, 200)

    def test_window_animation(self):
        mode = self.anim_mode_combo.currentData()
        self.anim_preview_widget.set_animation_settings(mode, 200)
        self.anim_preview_widget.test_animation()
        self.preview_widget.set_animation_settings(mode, 200)
        self.preview_widget.test_animation()

    # -------------------------------------------------------------
    # TAB 6: Shortcuts Cheatsheet
    # -------------------------------------------------------------
    def create_shortcuts_tab(self):
        tab = QWidget()
        layout = QVBoxLayout(tab)

        lbl = QLabel("Plasma 6 Global Shortcuts for Tessera:")
        lbl.setFont(QFont("SansSerif", 11, QFont.Bold))
        layout.addWidget(lbl)

        shortcuts = [
            ("Toggle Zone Overlay (KZones-Style)", "Ctrl + Shift + C"),
            ("Cycle to Next Layout", "Ctrl + Space"),
            ("Cycle to Previous Layout", "Ctrl + Shift + Space"),
            ("Toggle Tiling Globally", "Ctrl + Shift + T"),
            ("Toggle Active Window Floating", "Ctrl + Shift + F"),
            ("Focus Left Window (WASD)", "Ctrl + Shift + A"),
            ("Focus Right Window (WASD)", "Ctrl + Shift + D"),
            ("Focus Up Window (WASD)", "Ctrl + Shift + W"),
            ("Focus Down Window (WASD)", "Ctrl + Shift + S"),
            ("Swap Window Left (Counter-Clockwise)", "Ctrl + Shift + Q"),
            ("Swap Window Right (Clockwise)", "Ctrl + Shift + E"),
            ("Focus Next Window (Vim)", "Ctrl + Shift + J"),
            ("Focus Previous Window (Vim)", "Ctrl + Shift + K"),
            ("Swap Window Forward (Vim)", "Ctrl + Alt + J"),
            ("Swap Window Backward (Vim)", "Ctrl + Alt + K"),
            ("Expand Primary Region Ratio", "Ctrl + Shift + L"),
            ("Shrink Primary Region Ratio", "Ctrl + Shift + H"),
            ("Increase Primary Region Count", "Ctrl + Shift + I"),
            ("Decrease Primary Region Count", "Ctrl + Shift + O"),
            ("Move Window to Next Screen", "Ctrl + Shift + Z"),
            ("Cycle Layout on Other Screen", "Ctrl + Shift + X"),
            ("Swap Screen Layouts", "Ctrl + Alt + X"),
            ("Force Retile Workspace", "Ctrl + Shift + R")
        ]

        table = QTableWidget(len(shortcuts), 2)
        table.setHorizontalHeaderLabels(["Action", "Keybinding"])
        table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)

        for idx, (act, sc) in enumerate(shortcuts):
            table.setItem(idx, 0, QTableWidgetItem(act))
            sc_item = QTableWidgetItem(sc)
            sc_item.setForeground(QColor("#3daee9"))
            table.setItem(idx, 1, sc_item)

        layout.addWidget(table)
        hint = QLabel("Shortcuts can also be customized directly in KDE System Settings -> Shortcuts -> KWin.")
        hint.setStyleSheet("color: #6c757d; font-size: 8.5pt;")
        layout.addWidget(hint)
        return tab

    # -------------------------------------------------------------
    # State Management & Transactions
    # -------------------------------------------------------------
    def on_enable_toggled(self, checked: bool):
        if not self._is_loading:
            self.cfg_mgr.set_draft_value("enableTiling", checked)
            self.update_dirty_status()

    def update_dirty_status(self):
        if self.cfg_mgr.is_dirty():
            keys = ", ".join(self.cfg_mgr.get_dirty_keys())
            self.set_status(f"Unsaved changes: [{keys}]", is_warning=True)
        else:
            self.set_status("Ready")

    def load_settings_into_ui(self):
        self._is_loading = True
        try:
            cfg = self.cfg_mgr.config
            self.enable_switch.setChecked(self.cfg_mgr.get_draft_value("enableTiling", True))
            self.inner_gap_slider.setValue(self.cfg_mgr.get_draft_value("gapInner", 8))
            self.inner_gap_val.setText(f"{self.inner_gap_slider.value()} px")
            self.outer_gap_slider.setValue(self.cfg_mgr.get_draft_value("gapOuter", 10))
            self.outer_gap_val.setText(f"{self.outer_gap_slider.value()} px")

            ratio_val = int(self.cfg_mgr.get_draft_value("primaryRegionRatio", 0.50) * 100)
            self.primary_ratio_slider.setValue(ratio_val)
            self.primary_ratio_val.setText(f"{ratio_val}%")

            self.primary_count_spin.setValue(self.cfg_mgr.get_draft_value("primaryRegionCount", 1))

            self.debounce_slider.setValue(self.cfg_mgr.get_draft_value("reconcileDebounceMs", 60))
            self.debounce_val.setText(f"{self.debounce_slider.value()} ms")

            self.polling_slider.setValue(self.cfg_mgr.get_draft_value("overlayPollingMs", 16))
            fps = round(1000 / self.polling_slider.value()) if self.polling_slider.value() > 0 else 60
            self.polling_val.setText(f"{self.polling_slider.value()} ms ({fps} FPS)")

            self.tile_new_chk.setChecked(self.cfg_mgr.get_draft_value("tileNewWindows", True))
            self.ignore_minimized_chk.setChecked(self.cfg_mgr.get_draft_value("ignoreMinimized", True))
            self.show_osd_chk.setChecked(self.cfg_mgr.get_draft_value("showOsd", True))
            self.per_desktop_chk.setChecked(self.cfg_mgr.get_draft_value("perDesktopLayout", True))

            dl = self.cfg_mgr.get_draft_value("defaultLayout", "balanced-grid")
            for lid, card in self.layout_cards.items():
                card.set_selected(lid == dl)

            self.game_policy_combo.setCurrentText(self.cfg_mgr.get_draft_value("gameWindowPolicy", "floating"))

            desk_map = self.cfg_mgr.get_draft_value("desktopLayouts", {})
            for d, combo in self.desk_combos.items():
                if d in desk_map:
                    combo.setCurrentText(desk_map[d])

            self.populate_rules_table()
            self.refresh_preview()
            self.update_dirty_status()
        finally:
            self._is_loading = False

    def reset_to_saved(self):
        self.cfg_mgr.reset_draft()
        self.load_settings_into_ui()
        self.set_status("↺ Reverted unsaved draft changes.")

    def restore_defaults(self):
        self.cfg_mgr.restore_defaults_to_draft()
        self.load_settings_into_ui()
        self.set_status("⚙ Draft set to factory defaults (click Save & Apply to commit).")

    def save_and_apply(self):
        ok, err = self.cfg_mgr.apply(retile=False)
        if ok:
            self.load_settings_into_ui()
            self.set_status("✓ Settings saved and synced with KWin!")
        else:
            self.set_status(f"Error saving settings: {err}", is_warning=True)
            QMessageBox.critical(self, "Save Error", f"Failed to save settings:\n{err}")

    def retile_kwin(self):
        ok, err = self.cfg_mgr.retile_now()
        if ok:
            self.set_status("✓ Retile command sent to KWin.")
        else:
            self.set_status(f"Retile warning: {err}", is_warning=True)

    def set_status(self, msg: str, is_warning: bool = False):
        self.status_lbl.setText(msg)
        if is_warning:
            self.status_lbl.setStyleSheet("color: #e06c75; font-weight: bold;")
        else:
            self.status_lbl.setStyleSheet("color: #3daee9; font-weight: bold;")


def main():
    app = QApplication(sys.argv)
    window = TesseraControlWindow()
    window.show()
    sys.exit(app.exec_())

if __name__ == "__main__":
    main()
