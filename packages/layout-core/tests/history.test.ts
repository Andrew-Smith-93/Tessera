import { describe, it, expect } from 'vitest';
import { LayoutHistory } from '../src/history.js';

describe('LayoutHistory', () => {
  it('pushes and undoes state transitions', () => {
    const history = new LayoutHistory<string>();

    history.push('state-1');
    history.push('state-2');

    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);

    // Current state is state-3, undo should revert to state-2
    const undone = history.undo('state-3');
    expect(undone).toBe('state-2');
    expect(history.canRedo()).toBe(true);

    // Redo should return state-3
    const redone = history.redo(undone!);
    expect(redone).toBe('state-3');
  });

  it('clears redo stack upon new push', () => {
    const history = new LayoutHistory<number>();
    history.push(1);
    history.push(2);

    const prev = history.undo(3);
    expect(prev).toBe(2);
    expect(history.canRedo()).toBe(true);

    history.push(4);
    expect(history.canRedo()).toBe(false);
  });

  it('respects maxDepth bound', () => {
    const history = new LayoutHistory<number>({ maxDepth: 3 });
    history.push(1);
    history.push(2);
    history.push(3);
    history.push(4);

    expect(history.undoDepth).toBe(3);

    expect(history.undo(5)).toBe(4);
    expect(history.undo(4)).toBe(3);
    expect(history.undo(3)).toBe(2);
    expect(history.undo(2)).toBeUndefined();
  });
});
