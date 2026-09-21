export interface QRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KWinSignal<T = void> {
  connect(callback: (arg: T) => void): void;
  disconnect?(callback: (arg: T) => void): void;
}

export interface KWinOutput {
  readonly name: string;
  readonly geometry?: QRect;
}

export interface KWinVirtualDesktop {
  readonly id: string;
  readonly name?: string;
}

export interface KWinWindow {
  readonly internalId?: { toString(): string } | string;
  readonly caption: string;
  readonly resourceClass?: string;
  readonly resourceName?: string;
  readonly windowRole?: string;
  readonly managed: boolean;
  readonly normalWindow: boolean;
  readonly desktopWindow?: boolean;
  readonly dock?: boolean;
  readonly splash?: boolean;
  readonly notification?: boolean;
  readonly onScreenDisplay?: boolean;
  readonly popupMenu?: boolean;
  readonly tooltip?: boolean;
  readonly specialWindow?: boolean;
  readonly dialog?: boolean;
  readonly transient?: boolean;

  minimized: boolean;
  fullScreen: boolean;
  maximizeMode: number; // 0: None, 1: Horiz, 2: Vert, 3: Both
  frameGeometry: QRect;
  output: KWinOutput;
  desktops: KWinVirtualDesktop[];
  onAllDesktops: boolean;

  setMaximize(vertical: boolean, horizontal: boolean): void;

  readonly frameGeometryChanged: KWinSignal;
  readonly minimizedChanged: KWinSignal;
  readonly fullScreenChanged: KWinSignal;
  readonly outputChanged?: KWinSignal;
  readonly desktopsChanged?: KWinSignal;
  readonly interactiveMoveResizeStarted?: KWinSignal;
  readonly interactiveMoveResizeStepped?: KWinSignal;
  readonly interactiveMoveResizeFinished?: KWinSignal;
}

export interface KWinWorkspace {
  readonly screens: KWinOutput[];
  readonly activeScreen: KWinOutput;
  readonly currentDesktop: KWinVirtualDesktop;
  readonly stackingOrder: KWinWindow[];
  activeWindow: KWinWindow | null;
  readonly cursorPos: { x: number; y: number };

  clientArea(areaType: number, screen: KWinOutput, desktop: KWinVirtualDesktop): QRect;
  showOutline(rect: QRect): void;
  hideOutline(): void;

  readonly windowAdded: KWinSignal<KWinWindow>;
  readonly windowRemoved: KWinSignal<KWinWindow>;
  readonly windowActivated: KWinSignal<KWinWindow | null>;
  readonly currentDesktopChanged: KWinSignal;
  readonly screensChanged: KWinSignal;
}

export interface KWinGlobal {
  readConfig(key: string, defaultValue: unknown): unknown;
  registerShortcut(title: string, desc: string, keySequence: string, cb: () => void): void;
}

export interface KWinOptions {
  readonly configChanged: KWinSignal;
}

declare global {
  const workspace: KWinWorkspace;
  const KWin: KWinGlobal;
  const options: KWinOptions;
  function print(...args: unknown[]): void;
  function callDBus(
    service: string,
    path: string,
    interfaceName: string,
    method: string,
    ...args: unknown[]
  ): void;
}
