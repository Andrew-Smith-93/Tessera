"""
Live Desktop Preview Widget
Renders an interactive miniature desktop preview reflecting the chosen layout,
inner gaps, outer gaps, and master ratios in real time.
"""

from PyQt5.QtWidgets import QWidget
from PyQt5.QtGui import QPainter, QColor, QPen, QBrush, QFont
from PyQt5.QtCore import Qt, QRect

class LiveDesktopPreview(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMinimumSize(280, 180)
        self.layout_type = "master-stack"
        self.gap_inner = 8
        self.gap_outer = 10
        self.master_ratio = 0.55
        self.master_count = 1
        self.window_count = 3

    def update_params(self, layout_type, gap_inner, gap_outer, master_ratio, master_count, window_count=3):
        self.layout_type = layout_type
        self.gap_inner = gap_inner
        self.gap_outer = gap_outer
        self.master_ratio = master_ratio
        self.master_count = master_count
        self.window_count = window_count
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        w = self.width()
        h = self.height()

        # Draw outer monitor bezel
        painter.setBrush(QBrush(QColor(24, 28, 36)))
        painter.setPen(QPen(QColor(50, 56, 68), 2))
        painter.drawRoundedRect(4, 4, w - 8, h - 8, 8, 8)

        # Draw miniature panel / dock at bottom
        panel_h = 14
        painter.setBrush(QBrush(QColor(18, 20, 26, 220)))
        painter.setPen(Qt.NoPen)
        painter.drawRect(6, h - panel_h - 6, w - 12, panel_h)

        # Working area for windows
        screen_x = 10
        screen_y = 10
        screen_w = w - 20
        screen_h = h - panel_h - 22

        # Scale gaps to preview dimensions
        scale_x = screen_w / 1920.0
        scale_y = screen_h / 1080.0
        scaled_outer = max(2, int(self.gap_outer * scale_x * 2.5))
        scaled_inner = max(2, int(self.gap_inner * scale_x * 2.5))

        client_x = screen_x + scaled_outer
        client_y = screen_y + scaled_outer
        client_w = screen_w - (scaled_outer * 2)
        client_h = screen_h - (scaled_outer * 2)

        if client_w <= 10 or client_h <= 10:
            return

        rects = []
        count = self.window_count

        if self.layout_type == "master-stack":
            if count == 1:
                rects.append(QRect(client_x, client_y, client_w, client_h))
            else:
                m_w = int(client_w * self.master_ratio) - (scaled_inner // 2)
                s_w = client_w - m_w - scaled_inner

                # Master window
                rects.append(QRect(client_x, client_y, m_w, client_h))

                # Stack windows
                stack_count = count - 1
                stack_h = (client_h - (scaled_inner * (stack_count - 1))) // stack_count
                for s in range(stack_count):
                    sy = client_y + s * (stack_h + scaled_inner)
                    rects.append(QRect(client_x + m_w + scaled_inner, sy, s_w, stack_h))

        elif self.layout_type == "bsp":
            if count == 1:
                rects.append(QRect(client_x, client_y, client_w, client_h))
            elif count == 2:
                half_w = (client_w - scaled_inner) // 2
                rects.append(QRect(client_x, client_y, half_w, client_h))
                rects.append(QRect(client_x + half_w + scaled_inner, client_y, half_w, client_h))
            else:
                half_w = (client_w - scaled_inner) // 2
                half_h = (client_h - scaled_inner) // 2
                rects.append(QRect(client_x, client_y, half_w, client_h))
                rects.append(QRect(client_x + half_w + scaled_inner, client_y, half_w, half_h))
                rects.append(QRect(client_x + half_w + scaled_inner, client_y + half_h + scaled_inner, half_w, half_h))

        elif self.layout_type == "columns":
            col_w = (client_w - (scaled_inner * (count - 1))) // count
            for i in range(count):
                rects.append(QRect(client_x + i * (col_w + scaled_inner), client_y, col_w, client_h))

        elif self.layout_type == "rows":
            row_h = (client_h - (scaled_inner * (count - 1))) // count
            for i in range(count):
                rects.append(QRect(client_x, client_y + i * (row_h + scaled_inner), client_w, row_h))

        elif self.layout_type == "monocle":
            rects.append(QRect(client_x, client_y, client_w, client_h))

        else: # Floating preview
            rects.append(QRect(client_x + 10, client_y + 10, int(client_w * 0.55), int(client_h * 0.6)))
            rects.append(QRect(client_x + 35, client_y + 35, int(client_w * 0.55), int(client_h * 0.6)))

        # Draw the calculated mock windows
        window_colors = [
            QColor(60, 110, 210, 190),  # Primary accent / Active window
            QColor(42, 54, 75, 170),
            QColor(38, 48, 66, 170),
            QColor(34, 44, 60, 170)
        ]

        font = QFont("SansSerif", 8, QFont.Bold)
        painter.setFont(font)

        for idx, r in enumerate(rects):
            col = window_colors[idx % len(window_colors)]
            painter.setBrush(QBrush(col))
            painter.setPen(QPen(QColor(80, 140, 240) if idx == 0 else QColor(70, 85, 115), 1.5))
            painter.drawRoundedRect(r, 4, 4)

            # Draw miniature titlebar
            tb_h = max(6, int(r.height() * 0.15))
            painter.setBrush(QBrush(QColor(0, 0, 0, 40)))
            painter.setPen(Qt.NoPen)
            painter.drawRoundedRect(r.x(), r.y(), r.width(), tb_h, 4, 4)

            # Label index
            painter.setPen(QColor(220, 230, 255))
            painter.drawText(r, Qt.AlignCenter, str(idx + 1))
