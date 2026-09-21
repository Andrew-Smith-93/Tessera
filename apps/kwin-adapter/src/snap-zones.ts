import type { Rect, Point } from "@tessera/protocol";

export type SnapZoneType = "maximize" | "half" | "quarter";

export type SnapZoneId =
  | "maximize"
  | "left-half"
  | "right-half"
  | "top-left"
  | "bottom-left"
  | "top-right"
  | "bottom-right";

export interface SnapZoneTarget {
  type: SnapZoneType;
  id: SnapZoneId;
  title: string;
  badge: string;
  desc: string;
  slotIndex: number;
  rect: Rect;
  targetRect: Rect;
  triggerX: number;
  triggerY: number;
  triggerW: number;
  triggerH: number;
}

/**
 * Computes KZones-style visual snap overlay zones and prospective layout targets
 * using the given working area and inner/outer gaps.
 */
export function computeSnapZones(
  area: Rect,
  gapOuter: number,
  gapInner: number
): SnapZoneTarget[] {
  const go = gapOuter;
  const gi = gapInner;
  const uw = area.width - (go * 2);
  const uh = area.height - (go * 2);
  const hw = Math.floor((uw - gi) / 2);
  const hh = Math.floor((uh - gi) / 2);

  const zones: SnapZoneTarget[] = [];

  // 1. Top Maximize Bar Card (Index 0)
  const barW = Math.min(800, Math.floor(uw * 0.6));
  const barX = area.x + Math.floor((area.width - barW) / 2);
  zones.push({
    type: "maximize",
    id: "maximize",
    title: "Full Screen / Maximize",
    badge: "🗖 Maximize",
    desc: "Full Working Area",
    slotIndex: -1,
    rect: { x: barX, y: area.y + 10, width: barW, height: 56 },
    targetRect: { x: area.x + go, y: area.y + go, width: uw, height: uh },
    triggerX: barX - 10,
    triggerY: area.y,
    triggerW: barW + 20,
    triggerH: 66
  });

  // 2. Left Half (Master Slot) (Index 1)
  zones.push({
    type: "half",
    id: "left-half",
    title: "Left Half (Master)",
    badge: "⊞ Left Split",
    desc: "50% Primary Pane",
    slotIndex: 0,
    rect: { x: area.x + go, y: area.y + go + 70, width: hw, height: uh - 70 },
    targetRect: { x: area.x + go, y: area.y + go, width: hw, height: uh },
    triggerX: area.x,
    triggerY: area.y + 80,
    triggerW: Math.floor(area.width / 2),
    triggerH: area.height - 80
  });

  // 3. Right Half (Stack Slot) (Index 2)
  zones.push({
    type: "half",
    id: "right-half",
    title: "Right Half (Stack)",
    badge: "▥ Right Split",
    desc: "50% Secondary Pane",
    slotIndex: 1,
    rect: { x: area.x + go + hw + gi, y: area.y + go + 70, width: uw - hw - gi, height: uh - 70 },
    targetRect: { x: area.x + go + hw + gi, y: area.y + go, width: uw - hw - gi, height: uh },
    triggerX: area.x + Math.floor(area.width / 2),
    triggerY: area.y + 80,
    triggerW: Math.floor(area.width / 2),
    triggerH: area.height - 80
  });

  // 4. Top-Left Quarter (Index 3)
  zones.push({
    type: "quarter",
    id: "top-left",
    title: "Top-Left Quarter",
    badge: "◤ Top-Left",
    desc: "25% Quadrant",
    slotIndex: 0,
    rect: { x: area.x + go, y: area.y + go + 70, width: hw, height: Math.max(60, hh - 70) },
    targetRect: { x: area.x + go, y: area.y + go, width: hw, height: hh },
    triggerX: area.x,
    triggerY: area.y,
    triggerW: Math.floor(area.width * 0.22),
    triggerH: Math.floor(area.height * 0.32)
  });

  // 5. Bottom-Left Quarter (Index 4)
  zones.push({
    type: "quarter",
    id: "bottom-left",
    title: "Bottom-Left Quarter",
    badge: "◣ Bottom-Left",
    desc: "25% Quadrant",
    slotIndex: 0,
    rect: { x: area.x + go, y: area.y + go + hh + gi, width: hw, height: uh - hh - gi },
    targetRect: { x: area.x + go, y: area.y + go + hh + gi, width: hw, height: uh - hh - gi },
    triggerX: area.x,
    triggerY: area.y + Math.floor(area.height * 0.68),
    triggerW: Math.floor(area.width * 0.22),
    triggerH: Math.floor(area.height * 0.32)
  });

  // 6. Top-Right Quarter (Index 5)
  zones.push({
    type: "quarter",
    id: "top-right",
    title: "Top-Right Quarter",
    badge: "◥ Top-Right",
    desc: "25% Quadrant",
    slotIndex: 1,
    rect: { x: area.x + go + hw + gi, y: area.y + go + 70, width: uw - hw - gi, height: Math.max(60, hh - 70) },
    targetRect: { x: area.x + go + hw + gi, y: area.y + go, width: uw - hw - gi, height: hh },
    triggerX: area.x + Math.floor(area.width * 0.78),
    triggerY: area.y,
    triggerW: Math.floor(area.width * 0.22),
    triggerH: Math.floor(area.height * 0.32)
  });

  // 7. Bottom-Right Quarter (Index 6)
  zones.push({
    type: "quarter",
    id: "bottom-right",
    title: "Bottom-Right Quarter",
    badge: "◢ Bottom-Right",
    desc: "25% Quadrant",
    slotIndex: 1,
    rect: { x: area.x + go + hw + gi, y: area.y + go + hh + gi, width: uw - hw - gi, height: uh - hh - gi },
    targetRect: { x: area.x + go + hw + gi, y: area.y + go + hh + gi, width: uw - hw - gi, height: uh - hh - gi },
    triggerX: area.x + Math.floor(area.width * 0.78),
    triggerY: area.y + Math.floor(area.height * 0.68),
    triggerW: Math.floor(area.width * 0.22),
    triggerH: Math.floor(area.height * 0.32)
  });

  return zones;
}

/**
 * Matches a cursor position against calculated snap zones.
 * Checks corner quarters first, then top maximize bar, then left/right halves.
 * Returns the matching zone index, or -1 if no zone matches.
 */
export function matchSnapZoneHover(
  zones: readonly SnapZoneTarget[],
  cursorPos: Point
): number {
  if (!cursorPos || zones.length === 0) return -1;

  // 1. Check corner quarters first (indices 3, 4, 5, 6)
  for (let i = 3; i < zones.length; i++) {
    const qz = zones[i];
    if (
      cursorPos.x >= qz.triggerX &&
      cursorPos.x < qz.triggerX + qz.triggerW &&
      cursorPos.y >= qz.triggerY &&
      cursorPos.y < qz.triggerY + qz.triggerH
    ) {
      return i;
    }
  }

  // 2. Check top maximize bar (index 0)
  if (zones.length > 0) {
    const mz = zones[0];
    if (
      cursorPos.x >= mz.triggerX &&
      cursorPos.x < mz.triggerX + mz.triggerW &&
      cursorPos.y >= mz.triggerY &&
      cursorPos.y < mz.triggerY + mz.triggerH
    ) {
      return 0;
    }
  }

  // 3. Check Left / Right halves (indices 1, 2)
  if (zones.length > 1) {
    const lz = zones[1];
    if (
      cursorPos.x >= lz.triggerX &&
      cursorPos.x < lz.triggerX + lz.triggerW &&
      cursorPos.y >= lz.triggerY &&
      cursorPos.y < lz.triggerY + lz.triggerH
    ) {
      return 1;
    }
  }

  if (zones.length > 2) {
    const rz = zones[2];
    if (
      cursorPos.x >= rz.triggerX &&
      cursorPos.x < rz.triggerX + rz.triggerW &&
      cursorPos.y >= rz.triggerY &&
      cursorPos.y < rz.triggerY + rz.triggerH
    ) {
      return 2;
    }
  }

  return -1;
}
