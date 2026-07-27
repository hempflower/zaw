import type { Credential, Template, Workspace } from "@zaw/protocol";
import type { IManagementViewRegistry } from "./management-view-registry";
import type { IManagementSheetContributionRegistry } from "../views/management-sheet/management-sheet-contribution-registry";
import type { ISessionEventRendererRegistry } from "../views/session/session-event-renderer-registry";
import type { IDetailTabRendererRegistry } from "../views/session-details/detail-tab-renderer-registry";
import type { ColorTheme } from "../views/settings/settings-view";
import type {
  ManagementSheet,
  TemplateKind,
} from "../views/management-sheet/management-sheet-view";
import type { SessionEvent } from "../views/session/session-event-view";
import type { ManagementScope } from "../views/management/management-surface";
import type {
  RuntimeBuild,
  RuntimeJob,
  RuntimeProvisioner,
} from "../views/management/runtime-management-view";
import type { FloatingWindowState } from "./floating-window";
import type { ManagementViewAction } from "./management-view-registry";
import type { ChatComposition } from "./chat-session";

export type WorkbenchDetailTab = {
  id: string;
  title: string;
  kind: "changes" | "files" | "preview";
  content?: string;
};

export type WorkbenchTerminal = {
  resource: string;
  title: string;
  output: string;
};
export type WorkbenchChange = {
  diff: string;
  id: string;
  path: string;
  resource: string;
  reviewed: boolean;
  status: string;
};
export type WorkbenchFile = {
  name: string;
  type: "directory" | "file";
  uri: string;
};
export type WorkbenchModel = { id: string; name: string };

export type WorkbenchViewAction =
  | { kind: "addChatAttachments"; files: File[] }
  | { kind: "cancelTurn" }
  | { kind: "changeAgent"; value: string }
  | { kind: "changeApprovalMode"; value: "ask" | "allow" }
  | { kind: "changeDraft"; value: string }
  | { kind: "changeModel"; value: string }
  | { kind: "chooseNewSessionModel"; value: string }
  | { kind: "chooseNewSessionWorkspace"; value: string }
  | { kind: "chooseTemplateSource"; value: TemplateKind }
  | { kind: "closeDetailTab"; value: string }
  | { kind: "closeFloatingWindow" }
  | { kind: "closeManagementSheet" }
  | { kind: "closeMobilePanel" }
  | { kind: "confirmToolCall"; value: string; approved: boolean }
  | { kind: "continueEditing" }
  | { kind: "createSession" }
  | { kind: "createTerminal" }
  | { kind: "deleteCredential" }
  | { kind: "deleteTemplate" }
  | { kind: "discardManagementChanges" }
  | { kind: "dismissToast" }
  | { kind: "disposeTerminal"; value: string }
  | { kind: "floatingGoBack" }
  | { kind: "floatingMaximize" }
  | { kind: "floatingRestore" }
  | { kind: "managementAction"; action: ManagementViewAction }
  | { kind: "openChange"; value: string }
  | { kind: "openDirectory"; value: string }
  | { kind: "openFile"; value: string }
  | { kind: "openFilesTab" }
  | { kind: "openSettings" }
  | { kind: "openWorkspaceCreate" }
  | { kind: "pickWorkspace"; value: string }
  | { kind: "rebuildWorkspace" }
  | { kind: "refreshWorkspace" }
  | { kind: "removeChatAttachment"; index: number }
  | { kind: "requestRevertChange"; value: string }
  | { kind: "revertChange" }
  | { kind: "reviewChange"; value: string }
  | { kind: "saveCredential" }
  | { kind: "saveTemplate" }
  | { kind: "saveWorkspace" }
  | { kind: "searchManagement"; value: string }
  | { kind: "selectDetailTab"; value: string }
  | { kind: "selectManagementScope"; value: ManagementScope }
  | { kind: "selectManagementView"; value: string }
  | { kind: "selectSession"; value: string }
  | { kind: "selectTerminal"; value: string }
  | { kind: "sendMessage" }
  | { kind: "setCredentialKind"; value: Credential["kind"] }
  | { kind: "stageChange"; value: string }
  | { kind: "startNewSession" }
  | { kind: "stopWorkspace" }
  | { kind: "terminalInput"; value: string }
  | { kind: "toggleLeftPanel" }
  | { kind: "toggleRightPanel" }
  | { kind: "toggleTerminal" }
  | { kind: "toggleTerminalCollapse" }
  | { kind: "toggleWorkspaceState" }
  | { kind: "updateNewSessionDraft"; value: string };

export type WorkbenchViewContext = Readonly<{
  activeDetailTab: WorkbenchDetailTab;
  activeDetailTabID: string;
  activeTerminal: string | null;
  activeTurn: boolean;
  builds: RuntimeBuild[];
  changes: WorkbenchChange[];
  chatComposition: ChatComposition;
  connection: "connected" | "offline" | "reconnecting";
  credentialKind: Credential["kind"];
  credentials: Credential[];
  detailTabRendererRegistry: IDetailTabRendererRegistry;
  detailTabs: WorkbenchDetailTab[];
  dirtySheet: ManagementSheet;
  editingCredential: Credential | null;
  editingTemplate: Template | null;
  emitAction: (action: WorkbenchViewAction) => void;
  files: WorkbenchFile[];
  floatingWindow: FloatingWindowState | null;
  jobs: RuntimeJob[];
  leftPanelVisible: boolean;
  managementHistoryLength: number;
  managementQuery: string;
  managementScope: ManagementScope;
  managementSheetContributionRegistry: IManagementSheetContributionRegistry;
  managementViewID: string;
  managementViewRegistry: IManagementViewRegistry;
  messages: SessionEvent[];
  mobilePanel: "details" | "workspaces" | null;
  models: WorkbenchModel[];
  newSessionDraft: string;
  newSessionModelID: string;
  newSessionWorkspaceID: string;
  pendingCredentialDeleteID: string;
  pendingRevertPath: string;
  pendingTemplateDeleteID: string;
  pendingWorkspaceID: string;
  provisioners: RuntimeProvisioner[];
  rightPanelVisible: boolean;
  selectedSession: string | null;
  selectedSessionTitle: string;
  selectedWorkspaceID: string | null;
  sessionEventRendererRegistry: ISessionEventRendererRegistry;
  sessionTitles: Record<string, string>;
  sessions: Record<string, string[]>;
  sheet: ManagementSheet;
  templateKind: TemplateKind;
  templates: Template[];
  terminal: WorkbenchTerminal | undefined;
  terminalCollapsed: boolean;
  terminalOpen: boolean;
  terminalPanelHeight: number;
  terminals: WorkbenchTerminal[];
  theme: ColorTheme;
  toast: string;
  workspace: Workspace | undefined;
  workspaceFilter: string;
  workspaceOnline: boolean;
  workspaces: Workspace[];
}>;
