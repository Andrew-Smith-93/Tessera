export enum AdapterCapability {
  WINDOW_ENUMERATION      = 1 << 0,
  WINDOW_GEOMETRY_MUTATE  = 1 << 1,
  WINDOW_MIN_MAX_HINTS    = 1 << 2,
  TRANSIENT_RELATIONSHIPS = 1 << 3,
  VIRTUAL_DESKTOPS        = 1 << 4,
  MULTI_MONITOR           = 1 << 5,
  INTERACTIVE_RESIZE_HOOK = 1 << 6,
  NATIVE_OUTLINE_PREVIEW  = 1 << 7,
  GLOBAL_SHORTCUTS        = 1 << 8,
  CUSTOM_RULES_OVERRIDE   = 1 << 9,
}

export interface AdapterHandshake {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly protocolVersion: number;
  readonly capabilities: number;
}
