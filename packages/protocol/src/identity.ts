export type RuntimeWindowId = string;

export interface LogicalWindowIdentity {
  readonly appId: string;
  readonly windowClass: string;
  readonly title?: string;
  readonly role?: string;
  readonly isManaged?: boolean;
  readonly isNormal?: boolean;
}

export type WindowClassification =
  | "tiled"
  | "floating"
  | "dialog"
  | "fullscreen"
  | "ignored";
