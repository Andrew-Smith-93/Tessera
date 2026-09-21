/**
 * Transactional layout state history stack supporting bounded undo/redo.
 * Operates purely on immutable state snapshots or serialized tree representations.
 */

export interface HistoryOptions {
  /** Maximum number of history entries to retain. Defaults to 50. */
  maxDepth?: number;
}

export class LayoutHistory<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private readonly maxDepth: number;

  constructor(options: HistoryOptions = {}) {
    this.maxDepth = options.maxDepth ?? 50;
  }

  /**
   * Records a new state onto the history stack.
   * Clears the redo stack.
   */
  public push(state: T): void {
    this.undoStack.push(state);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /**
   * Reverts to the previous state.
   * @param currentState The current active state before undoing (to be saved to redo stack).
   * @returns The previous state, or undefined if no undo is possible.
   */
  public undo(currentState: T): T | undefined {
    if (this.undoStack.length === 0) {
      return undefined;
    }
    const previous = this.undoStack.pop()!;
    this.redoStack.push(currentState);
    return previous;
  }

  /**
   * Re-applies a previously undone state.
   * @param currentState The current active state before redoing (to be saved to undo stack).
   * @returns The restored state, or undefined if no redo is possible.
   */
  public redo(currentState: T): T | undefined {
    if (this.redoStack.length === 0) {
      return undefined;
    }
    const next = this.redoStack.pop()!;
    this.undoStack.push(currentState);
    return next;
  }

  /**
   * Whether an undo operation is available.
   */
  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Whether a redo operation is available.
   */
  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Current depth of the undo stack.
   */
  public get undoDepth(): number {
    return this.undoStack.length;
  }

  /**
   * Current depth of the redo stack.
   */
  public get redoDepth(): number {
    return this.redoStack.length;
  }

  /**
   * Clears both undo and redo stacks.
   */
  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
