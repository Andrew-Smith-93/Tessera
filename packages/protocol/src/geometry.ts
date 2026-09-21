export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SizeConstraints {
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
}

export interface GapConfig {
  readonly inner: number;
  readonly outer: number;
}

export type Direction = "left" | "right" | "up" | "down";
