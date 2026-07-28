import { type Event, type IDisposable } from "@zaw/ui";

export const IWorkbenchLayoutService = Symbol.for("IWorkbenchLayoutService");

/**
 * Identifies a stable Part in the workbench layout.
 */
export enum Part {
  Titlebar = "titlebar",
  Sidebar = "sidebar",
  Primary = "primary",
  AuxiliaryBar = "auxiliarybar",
  Panel = "panel",
  Overlay = "overlay",
}

/**
 * Layout service manages stable Parts, their visibility, and dimensions.
 * Workbench creates Parts once at startup; this service owns their lifecycle.
 */
export interface IWorkbenchLayoutService {
  /** Fires when a Part's visibility changes. */
  readonly onDidTogglePart: Event<{ part: Part; visible: boolean }>;
  /** Fires when a persisted Part dimension changes. */
  readonly onDidChangeSize: Event<Part>;
  /** Fires when semantic editor content opens or closes. */
  readonly onDidChangeEditorVisibility: Event<boolean>;

  /** Get the root DOM element for a Part, creating it if needed. */
  getPartRoot(part: Part): HTMLElement;

  /** Check if a Part is currently visible. */
  isVisible(part: Part): boolean;

  /** Show or hide a Part. */
  setVisible(part: Part, visible: boolean): void;

  /**
   * Temporarily hide a Part without changing the user's persisted choice.
   * Independent layout controllers use distinct sources so one controller
   * cannot accidentally clear another controller's hidden state.
   */
  setAutoHidden(part: Part, hidden: boolean, source?: string): void;

  /** Editor content is hosted by a feature View but participates in layout policy. */
  readonly editorVisible: boolean;
  setEditorVisible(visible: boolean): void;

  /** Get/set the sidebar width in pixels. */
  readonly sidebarWidth: number;
  setSidebarWidth(width: number): void;

  /** Get/set the auxiliary sidebar width in pixels. */
  readonly auxiliaryBarWidth: number;
  setAuxiliaryBarWidth(width: number): void;

  /** Get/set the panel height in pixels. */
  readonly panelHeight: number;
  setPanelHeight(height: number): void;

  /** Dispose all parts and their views. */
  dispose(): void;
}
