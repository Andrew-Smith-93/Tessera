import type { Rect, Direction, RuntimeWindowId } from "@tessera/protocol";
import { centerPoint } from "./geometry.js";

export function findDirectionalNeighbor(
  currentId: RuntimeWindowId,
  direction: Direction,
  rectMap: Map<RuntimeWindowId, Rect>
): RuntimeWindowId | null {
  const currentRect = rectMap.get(currentId);
  if (!currentRect) return null;

  const currentCenter = centerPoint(currentRect);
  let bestCandidate: RuntimeWindowId | null = null;
  let bestScore = Infinity;

  for (const [candidateId, candidateRect] of rectMap.entries()) {
    if (candidateId === currentId) continue;

    const candCenter = centerPoint(candidateRect);
    const dx = candCenter.x - currentCenter.x;
    const dy = candCenter.y - currentCenter.y;

    let inDirection = false;
    let primaryDist = 0;
    let orthoDist = 0;
    let overlap = 0;

    switch (direction) {
      case "left":
        inDirection = candCenter.x < currentCenter.x;
        primaryDist = currentCenter.x - candCenter.x;
        orthoDist = Math.abs(dy);
        overlap = Math.max(0, Math.min(currentRect.y + currentRect.height, candidateRect.y + candidateRect.height) - Math.max(currentRect.y, candidateRect.y));
        break;
      case "right":
        inDirection = candCenter.x > currentCenter.x;
        primaryDist = candCenter.x - currentCenter.x;
        orthoDist = Math.abs(dy);
        overlap = Math.max(0, Math.min(currentRect.y + currentRect.height, candidateRect.y + candidateRect.height) - Math.max(currentRect.y, candidateRect.y));
        break;
      case "up":
        inDirection = candCenter.y < currentCenter.y;
        primaryDist = currentCenter.y - candCenter.y;
        orthoDist = Math.abs(dx);
        overlap = Math.max(0, Math.min(currentRect.x + currentRect.width, candidateRect.x + candidateRect.width) - Math.max(currentRect.x, candidateRect.x));
        break;
      case "down":
        inDirection = candCenter.y > currentCenter.y;
        primaryDist = candCenter.y - currentCenter.y;
        orthoDist = Math.abs(dx);
        overlap = Math.max(0, Math.min(currentRect.x + currentRect.width, candidateRect.x + candidateRect.width) - Math.max(currentRect.x, candidateRect.x));
        break;
    }

    if (!inDirection) continue;

    // Favor candidates with perpendicular overlap and minimal primary distance
    const overlapBonus = overlap * 1.5;
    const score = primaryDist + orthoDist * 2.0 - overlapBonus;

    if (score < bestScore) {
      bestScore = score;
      bestCandidate = candidateId;
    }
  }

  return bestCandidate;
}
