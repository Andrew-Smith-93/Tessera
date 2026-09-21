import type { Rect, RuntimeWindowId } from "@tessera/protocol";

export type SplitDirection = "horizontal" | "vertical";

export interface LeafNode {
  readonly kind: "leaf";
  readonly id: string;
  readonly windowId: RuntimeWindowId;
  rect: Rect;
  dirty: boolean;
}

export interface SplitNode {
  readonly kind: "split";
  readonly id: string;
  direction: SplitDirection;
  ratio: number; // 0.05 to 0.95
  children: [LayoutNode, LayoutNode];
  rect: Rect;
  dirty: boolean;
}

export type LayoutNode = LeafNode | SplitNode;

let nextNodeId = 1;
export function generateNodeId(): string {
  return `node-${nextNodeId++}`;
}

export function createLeaf(windowId: RuntimeWindowId, id?: string): LeafNode {
  return {
    kind: "leaf",
    id: id || generateNodeId(),
    windowId,
    rect: { x: 0, y: 0, width: 0, height: 0 },
    dirty: true
  };
}

export function createSplit(
  left: LayoutNode,
  right: LayoutNode,
  direction: SplitDirection = "horizontal",
  ratio: number = 0.5,
  id?: string
): SplitNode {
  return {
    kind: "split",
    id: id || generateNodeId(),
    direction,
    ratio: Math.max(0.05, Math.min(0.95, ratio)),
    children: [left, right],
    rect: { x: 0, y: 0, width: 0, height: 0 },
    dirty: true
  };
}

export function allLeaves(node: LayoutNode | null): LeafNode[] {
  if (!node) return [];
  if (node.kind === "leaf") return [node];
  return [...allLeaves(node.children[0]), ...allLeaves(node.children[1])];
}

export function findLeafByWindow(node: LayoutNode | null, windowId: RuntimeWindowId): LeafNode | null {
  if (!node) return null;
  if (node.kind === "leaf") {
    return node.windowId === windowId ? node : null;
  }
  return findLeafByWindow(node.children[0], windowId) || findLeafByWindow(node.children[1], windowId);
}

export function findParent(root: LayoutNode | null, targetId: string): SplitNode | null {
  if (!root || root.kind === "leaf") return null;
  if (root.children[0].id === targetId || root.children[1].id === targetId) {
    return root;
  }
  return findParent(root.children[0], targetId) || findParent(root.children[1], targetId);
}

export function insertWindow(
  root: LayoutNode | null,
  newWindowId: RuntimeWindowId,
  targetWindowId?: RuntimeWindowId,
  direction: SplitDirection = "horizontal",
  ratio: number = 0.5
): LayoutNode {
  const newLeaf = createLeaf(newWindowId);
  if (!root) return newLeaf;

  const target = targetWindowId ? findLeafByWindow(root, targetWindowId) : null;
  const insertTarget = target || allLeaves(root)[0];

  if (!insertTarget) return newLeaf;

  if (insertTarget === root) {
    return createSplit(insertTarget, newLeaf, direction, ratio);
  }

  const parent = findParent(root, insertTarget.id);
  if (!parent) {
    return createSplit(root, newLeaf, direction, ratio);
  }

  const newSubSplit = createSplit(insertTarget, newLeaf, direction, ratio);
  if (parent.children[0].id === insertTarget.id) {
    parent.children[0] = newSubSplit;
  } else {
    parent.children[1] = newSubSplit;
  }
  parent.dirty = true;
  return root;
}

export function removeWindow(root: LayoutNode | null, windowId: RuntimeWindowId): LayoutNode | null {
  if (!root) return null;
  if (root.kind === "leaf") {
    return root.windowId === windowId ? null : root;
  }

  const leaf = findLeafByWindow(root, windowId);
  if (!leaf) return root;

  const parent = findParent(root, leaf.id);
  if (!parent) return null;

  const sibling = parent.children[0].id === leaf.id ? parent.children[1] : parent.children[0];
  const grandParent = findParent(root, parent.id);

  if (!grandParent) {
    sibling.dirty = true;
    return sibling;
  }

  if (grandParent.children[0].id === parent.id) {
    grandParent.children[0] = sibling;
  } else {
    grandParent.children[1] = sibling;
  }
  grandParent.dirty = true;
  return root;
}

export function swapWindows(root: LayoutNode | null, winA: RuntimeWindowId, winB: RuntimeWindowId): boolean {
  const leafA = findLeafByWindow(root, winA);
  const leafB = findLeafByWindow(root, winB);
  if (!leafA || !leafB) return false;

  // Swap window IDs
  const tmp = (leafA as { windowId: RuntimeWindowId }).windowId;
  (leafA as { windowId: RuntimeWindowId }).windowId = leafB.windowId;
  (leafB as { windowId: RuntimeWindowId }).windowId = tmp;

  leafA.dirty = true;
  leafB.dirty = true;
  return true;
}
