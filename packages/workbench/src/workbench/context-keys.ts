import { RawContextKey } from "../platform/context-key/context-key";

/**
 * Core context keys for the Workbench.
 *
 * Each domain service owns and updates its keys when state changes.
 * Views, Menus, and Keybindings use these keys in expressions for
 * enablement and visibility decisions.
 */

// ── Workspace / Session ──
export const WorkspaceContext = {
  /** A workspace is selected and active. */
  active: new RawContextKey<boolean>("workspace.active", false),
  /** The active workspace's agent host is online. */
  online: new RawContextKey<boolean>("workspace.online", false),
  /** A session is active (selected). */
  sessionActive: new RawContextKey<boolean>("session.active", false),
  /** A tool approval is pending for the active session. */
  toolApprovalPending: new RawContextKey<boolean>(
    "session.toolApprovalPending",
    false,
  ),
  /** The active session has an active (streaming) turn. */
  turnActive: new RawContextKey<boolean>("session.turnActive", false),
  /** Which persistent workspace detail view is active. */
  changesVisible: new RawContextKey<boolean>("workspace.changesVisible", true),
  filesVisible: new RawContextKey<boolean>("workspace.filesVisible", false),
  previewVisible: new RawContextKey<boolean>("workspace.previewVisible", false),
};

// ── Terminal ──
export const TerminalContext = {
  /** Any terminal panel is open. */
  open: new RawContextKey<boolean>("terminal.open", false),
  /** A terminal is the active terminal. */
  active: new RawContextKey<boolean>("terminal.active", false),
};

// ── Panel / Sidebar ──
export const PanelContext = {
  /** Left sidebar is visible. */
  leftSidebarVisible: new RawContextKey<boolean>(
    "panel.leftSidebarVisible",
    true,
  ),
  /** Right (secondary) sidebar is visible. */
  rightSidebarVisible: new RawContextKey<boolean>(
    "panel.rightSidebarVisible",
    true,
  ),
  /** Bottom panel is visible. */
  bottomPanelVisible: new RawContextKey<boolean>(
    "panel.bottomPanelVisible",
    false,
  ),
};

export const NavigationContext = {
  canGoBack: new RawContextKey<boolean>("navigation.canGoBack", false),
  canGoForward: new RawContextKey<boolean>("navigation.canGoForward", false),
};

// ── Management ──
export const ManagementContext = {
  /** Management floating window is open. */
  open: new RawContextKey<boolean>("management.open", false),
  /** Management form has unsaved changes. */
  dirty: new RawContextKey<boolean>("management.dirty", false),
};

// ── Viewport ──
export const ViewportContext = {
  /** Desktop layout (>= 1024px). */
  desktop: new RawContextKey<boolean>("viewport.desktop", true),
  /** Tablet layout (540px–1023px). */
  tablet: new RawContextKey<boolean>("viewport.tablet", false),
  /** Mobile layout (< 540px). */
  mobile: new RawContextKey<boolean>("viewport.mobile", false),
};
