import { describe, it, expect } from 'vitest';
import {
  createLeaf,
  insertWindow,
  removeWindow,
  swapWindows,
  findLeafByWindow,
  findParent,
  allLeaves,
  type SplitNode,
} from '../src/tree.js';

describe('binary space partition layout tree', () => {
  it('creates a leaf node', () => {
    const leaf = createLeaf('win-1');
    expect(leaf.kind).toBe('leaf');
    expect(leaf.windowId).toBe('win-1');
    expect(leaf.id).toBeDefined();
  });

  it('inserts into an empty root', () => {
    const root = insertWindow(null, 'win-1');
    expect(root).not.toBeNull();
    expect(root?.kind).toBe('leaf');
    expect(allLeaves(root!).map(l => l.windowId)).toEqual(['win-1']);
  });

  it('splits root when inserting second window', () => {
    const root1 = insertWindow(null, 'win-1');
    const root2 = insertWindow(root1, 'win-2');

    expect(root2?.kind).toBe('split');
    const split = root2 as SplitNode;
    expect(split.direction).toBe('horizontal');
    expect(split.ratio).toBe(0.5);
    expect(allLeaves(root2!).map(l => l.windowId)).toEqual(['win-1', 'win-2']);
  });

  it('finds node by window id', () => {
    let root = insertWindow(null, 'win-1');
    root = insertWindow(root, 'win-2');
    root = insertWindow(root, 'win-3');

    const found = findLeafByWindow(root!, 'win-2');
    expect(found).not.toBeNull();
    expect(found?.kind).toBe('leaf');
    if (found?.kind === 'leaf') {
      expect(found.windowId).toBe('win-2');
    }
  });

  it('finds parent of a target node', () => {
    let root = insertWindow(null, 'win-1');
    root = insertWindow(root, 'win-2');

    const leaf2 = findLeafByWindow(root!, 'win-2');
    expect(leaf2).not.toBeNull();

    const parent = findParent(root!, leaf2!.id);
    expect(parent).not.toBeNull();
    expect(parent?.kind).toBe('split');
  });

  it('removes window and collapses tree', () => {
    let root = insertWindow(null, 'win-1');
    root = insertWindow(root, 'win-2');
    root = insertWindow(root, 'win-3');

    expect(allLeaves(root!).map(l => l.windowId)).toContain('win-2');

    root = removeWindow(root!, 'win-2');
    expect(root).not.toBeNull();
    expect(allLeaves(root!).map(l => l.windowId)).toEqual(['win-1', 'win-3']);

    root = removeWindow(root!, 'win-1');
    expect(root?.kind).toBe('leaf');
    expect(allLeaves(root!).map(l => l.windowId)).toEqual(['win-3']);

    root = removeWindow(root!, 'win-3');
    expect(root).toBeNull();
  });

  it('swaps two windows cleanly', () => {
    let root = insertWindow(null, 'win-1');
    root = insertWindow(root, 'win-2');
    root = insertWindow(root, 'win-3');

    const swapped = swapWindows(root!, 'win-1', 'win-3');
    expect(swapped).toBe(true);

    const leaves = allLeaves(root!).map(l => l.windowId);
    expect(leaves).toEqual(['win-3', 'win-1', 'win-2']);
  });
});
