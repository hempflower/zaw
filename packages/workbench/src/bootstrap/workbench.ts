import type { Credential, Template, Workspace } from "@zaw/protocol";
import { inject, injectable } from "inversify";
import type { AHPAction, IAgentHost } from "../services/agent-host";
import {
  IActiveSessionService,
  parseSessionIdentityKey,
  sessionIdentityKey,
} from "../services/active-session";
import { IManagementProvider } from "../services/management";
import {
  ISessionCatalogProvider,
  type SessionCatalogItem,
} from "../services/session-catalog";
import { IWorkspaceProvider } from "../services/workspace";
import { IWorkspaceAttachmentService } from "../services/workspace-attachment";
import {
  IWorkbenchStorage,
  IWorkspaceUIStateService,
} from "../services/workspace-ui-state";
import {
  IFloatingWindowService,
  type FloatingWindowBounds,
} from "../services/floating-window";
import {
  IManagementViewRegistry,
  type ManagementViewAction,
} from "../services/management-view-registry";
import { IManagementSheetContributionRegistry } from "../views/management-sheet/management-sheet-contribution-registry";
import { IAHPActionContributionRegistry } from "../services/ahp-action-contribution-registry";
import { ISessionEventRendererRegistry } from "../views/session/session-event-renderer-registry";
import { IDetailTabRendererRegistry } from "../views/session-details/detail-tab-renderer-registry";
import {
  IChatSessionService,
  type ChatAttachment,
} from "../services/chat-session";
import {
  objectValue,
  stringOrMarkdown,
  stringValue,
  toolActionValue,
} from "../services/ahp-action-utils";
import { WorkbenchShell } from "../widgets/workbench-shell";
import type { IDisposable } from "@zaw/ui";
import type {
  WorkbenchChange,
  WorkbenchDetailTab,
  WorkbenchFile,
  WorkbenchModel,
  WorkbenchTerminal,
  WorkbenchViewAction,
  WorkbenchViewContext,
} from "../services/workbench-view-context";
import { WorkbenchViewHost } from "../services/workbench-view-host";
import { IWorkbenchViewHost } from "../services/workbench-view-host";

export const WorkbenchRoot = Symbol.for("WorkbenchRoot");

type MobilePanel = "details" | "workspaces" | null;
type DetailTab = "changes" | "files";
type DetailPaneTab = WorkbenchDetailTab;
type TerminalView = WorkbenchTerminal;
type WorkspaceChange = WorkbenchChange;
type FileEntry = WorkbenchFile;
type ModelOption = WorkbenchModel;
type Sheet = WorkbenchViewContext["sheet"];
type TemplateKind = WorkbenchViewContext["templateKind"];
type SessionEvent = WorkbenchViewContext["messages"][number];
type ManagementScope = WorkbenchViewContext["managementScope"];
type RuntimeBuild = WorkbenchViewContext["builds"][number];
type RuntimeJob = WorkbenchViewContext["jobs"][number];
type RuntimeProvisioner = WorkbenchViewContext["provisioners"][number];
type ColorTheme = WorkbenchViewContext["theme"];

@injectable()
export class Workbench {
  private readonly managementActionHandlers: {
    [K in ManagementViewAction["kind"]]: (
      action: Extract<ManagementViewAction, { kind: K }>,
    ) => void;
  } = {
    addCredential: () => {
      this.sheet = "credential";
      this.editingCredential = null;
      this.credentialKind = "token";
      this.managementDirty = false;
      this.updateWorkbench();
    },
    addTemplate: () => {
      this.sheet = "template-source";
      this.editingTemplate = null;
      this.managementDirty = false;
      this.updateWorkbench();
    },
    changeTheme: (action) => {
      this.theme = action.value;
      this.applyTheme();
      window.localStorage.setItem("zaw.theme", this.theme);
      this.updateWorkbench();
    },
    editCredential: (action) => {
      this.editCredential(action.id);
      this.updateWorkbench();
    },
    editTemplate: (action) => {
      this.editTemplate(action.id);
      this.updateWorkbench();
    },
    requestDeleteCredential: (action) => {
      this.pendingCredentialDeleteID = action.id;
      this.sheet = "confirm-credential-delete";
      this.updateWorkbench();
    },
    requestDeleteTemplate: (action) => {
      this.pendingTemplateDeleteID = action.id;
      this.sheet = "confirm-template-delete";
      this.updateWorkbench();
    },
    requestWorkspaceStop: (action) => {
      this.pendingWorkspaceID = action.id;
      this.sheet = "confirm-workspace-stop";
      this.updateWorkbench();
    },
    startWorkspace: (action) =>
      void this.requestWorkspaceBuild(action.id, "start").then(() =>
        this.updateWorkbench(),
      ),
  };
  private activeTerminal: string | null = null;
  private changes: Record<string, WorkspaceChange[]> = {};
  private builds: RuntimeBuild[] = [];
  private changesetResources: Record<string, string> = {};
  private catalogTimer: number | null = null;
  private connectionState: Record<
    string,
    "connected" | "offline" | "reconnecting"
  > = {};
  private credentials: Credential[] = [];
  private credentialKind: Credential["kind"] = "token";
  private editingCredential: Credential | null = null;
  private activeDetailTabID = "changes";
  private detailTabs: DetailPaneTab[] = [
    { id: "changes", title: "Changes", kind: "changes" },
  ];
  private files: Record<string, FileEntry[]> = {};
  private floatingFocusRestore: HTMLElement | null = null;
  private leftPanelWidth = 272;
  private messages: Record<string, SessionEvent[]> = {};
  private jobs: RuntimeJob[] = [];
  private managementHistory: string[] = [];
  private managementQuery = "";
  private managementScope: ManagementScope = "user";
  private managementViewID = "settings";
  private managementDirty = false;
  private dirtySheet: Sheet = null;
  private mobilePanel: MobilePanel = null;
  private models: ModelOption[] = [];
  private leftPanelVisible = true;
  private rightPanelVisible = true;
  private rightPanelWidth = 390;
  private provisioners: RuntimeProvisioner[] = [];
  private pendingRevertPath = "";
  private pendingCredentialDeleteID = "";
  private pendingTemplateDeleteID = "";
  private pendingWorkspaceID = "";
  private newSessionDraft = "";
  private newSessionModelID = "";
  private newSessionWorkspaceID = "";
  private selectedWorkspaceID: string | null = null;
  private sessions: Record<string, string[]> = {};
  private sessionTitles: Record<string, string> = {};
  private sheet: Sheet = null;
  private templateKind: TemplateKind = "git";
  private editingTemplate: Template | null = null;
  private toast = "";
  private workspaceFilter = "";
  private terminals: Record<string, TerminalView[]> = {};
  private terminalResizeObserver: ResizeObserver | null = null;
  private templates: Template[] = [];
  private terminalOpen = false;
  private terminalCollapsed = false;
  private terminalPanelHeight = 300;
  private theme: ColorTheme;
  private workspaces: Workspace[] = [];
  private shell: IDisposable | null = null;

  private get selectedSession() {
    return this.activeSessionService.current()?.resource ?? null;
  }

  constructor(
    @inject(WorkbenchRoot)
    private readonly root: HTMLElement,
    @inject(IWorkspaceProvider)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(IManagementProvider)
    private readonly managementProvider: IManagementProvider,
    @inject(IActiveSessionService)
    private readonly activeSessionService: IActiveSessionService,
    @inject(IWorkspaceAttachmentService)
    private readonly attachmentService: IWorkspaceAttachmentService,
    @inject(ISessionCatalogProvider)
    private readonly sessionCatalogProvider: ISessionCatalogProvider,
    @inject(IWorkspaceUIStateService)
    private readonly workspaceUIStateService: IWorkspaceUIStateService,
    @inject(IChatSessionService)
    private readonly chatSessionService: IChatSessionService,
    @inject(IFloatingWindowService)
    private readonly floatingWindowService: IFloatingWindowService,
    @inject(IManagementViewRegistry)
    private readonly managementViewRegistry: IManagementViewRegistry,
    @inject(IManagementSheetContributionRegistry)
    private readonly managementSheetContributionRegistry: IManagementSheetContributionRegistry,
    @inject(IAHPActionContributionRegistry)
    private readonly ahpActionContributionRegistry: IAHPActionContributionRegistry,
    @inject(ISessionEventRendererRegistry)
    private readonly sessionEventRendererRegistry: ISessionEventRendererRegistry,
    @inject(IDetailTabRendererRegistry)
    private readonly detailTabRendererRegistry: IDetailTabRendererRegistry,
    @inject(IWorkbenchViewHost)
    private readonly workbenchViewHost: WorkbenchViewHost<WorkbenchViewContext>,
    @inject(IWorkbenchStorage)
    private readonly storage?: Storage,
  ) {
    const saved = this.storage?.getItem("zaw.theme") ?? null;
    this.theme = isTheme(saved) ? saved : "system";
    this.attachmentService.onAction((workspaceID, action) => {
      this.applyAction(workspaceID, action);
    });
    this.attachmentService.onClose((workspaceID) => {
      this.reconnectWorkspace(workspaceID);
    });
  }

  async start() {
    this.applyTheme();
    this.root.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Node) this.closeInactiveDropdowns(target);
    });
    this.root.addEventListener("pointerdown", (event) =>
      this.startResize(event),
    );
    this.root.addEventListener(
      "keydown",
      (event) => void this.handleKeydown(event),
    );
    this.updateWorkbench();
    const [workspaces, templates, credentials, catalog, models] =
      await Promise.all([
        this.workspaceProvider.list(),
        this.managementProvider.listTemplates(),
        this.managementProvider.listCredentials(),
        this.sessionCatalogProvider.list(),
        this.managementProvider.request<ModelOption[]>("/models"),
      ]).catch(
        () =>
          [[], [], [], [], []] as [
            Workspace[],
            Template[],
            Credential[],
            Awaited<ReturnType<ISessionCatalogProvider["list"]>>,
            ModelOption[],
          ],
      );
    this.workspaces = workspaces;
    this.templates = templates;
    this.credentials = credentials;
    this.models = models;
    await this.reloadRuntimeMetadata().catch(() => undefined);
    this.applySessionCatalog(catalog);
    this.catalogTimer = window.setInterval(() => {
      void this.refreshSessionCatalog();
    }, 5_000);
    this.updateWorkbench();
  }

  private async refreshSessionCatalog() {
    try {
      if (this.applySessionCatalog(await this.sessionCatalogProvider.list())) {
        this.updateWorkbench();
      }
    } catch {
      // The last-known catalog remains visible while the control plane is
      // temporarily unavailable. A later polling cycle reconciles it.
    }
  }

  private applySessionCatalog(items: SessionCatalogItem[]) {
    const previousSessions = JSON.stringify(this.sessions);
    const previousTitles = JSON.stringify(this.sessionTitles);
    const previousConnectionState = JSON.stringify(this.connectionState);
    const sessions: Record<string, string[]> = {};
    const titles: Record<string, string> = {};
    for (const item of items) {
      sessions[item.workspaceId] = [
        ...(sessions[item.workspaceId] ?? []),
        item.resource,
      ];
      titles[
        sessionIdentityKey({
          workspaceID: item.workspaceId,
          resource: item.resource,
        })
      ] = item.title;
      if (item.agentHostOnline && !this.connectionState[item.workspaceId]) {
        this.connectionState[item.workspaceId] = "connected";
      }
      if (!item.agentHostOnline) {
        this.connectionState[item.workspaceId] = "offline";
      }
    }
    this.sessions = sessions;
    this.sessionTitles = titles;
    return (
      previousSessions !== JSON.stringify(sessions) ||
      previousTitles !== JSON.stringify(titles) ||
      previousConnectionState !== JSON.stringify(this.connectionState)
    );
  }

  private closeInactiveDropdowns(target: Node) {
    for (const details of this.root.querySelectorAll<HTMLDetailsElement>(
      ".zaw-dropdown details[open]",
    )) {
      if (!details.contains(target)) details.open = false;
    }
  }

  private async handleKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === ",") {
      event.preventDefault();
      this.openSettingsWindow();
      this.updateWorkbench();
      return;
    }
    const messageInput = (event.target as HTMLElement).closest<HTMLElement>(
      ".composer-input",
    );
    if (
      messageInput &&
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      await this.sendPrompt();
      return;
    }
    if (event.key === "Escape") {
      if (this.sheet) this.requestCloseManagementSheet();
      else if (this.floatingWindowService.current()) {
        this.closeFloatingWindow();
      } else if (this.mobilePanel) this.mobilePanel = null;
      else if (this.terminalOpen) this.terminalOpen = false;
      else return;
      event.preventDefault();
      this.updateWorkbench();
      return;
    }
    if (event.key === "Tab" && this.floatingWindowService.current()) {
      this.trapFloatingFocus(event);
      return;
    }
  }

  private startResize(event: PointerEvent) {
    if (this.startFloatingMove(event)) return;
    const handle = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-resize-panel]",
    );
    const side = handle?.dataset.resizePanel;
    if (!handle || (side !== "left" && side !== "right" && side !== "bottom")) {
      return;
    }
    if (side === "bottom" && window.matchMedia("(max-width: 860px)").matches) {
      return;
    }
    const workbench = this.root.querySelector<HTMLElement>(".zaw-workbench");
    if (!workbench) return;
    event.preventDefault();
    const resize = (move: PointerEvent) => {
      const bounds = workbench.getBoundingClientRect();
      const minimum = 180;
      if (side === "bottom") {
        this.terminalPanelHeight = clamp(
          bounds.bottom - move.clientY - 10,
          minimum,
          Math.max(minimum, bounds.height - 120),
        );
        this.root
          .querySelector<HTMLElement>(".terminal-panel")
          ?.style.setProperty(
            "--zaw-terminal-panel-height",
            `${this.terminalPanelHeight}px`,
          );
      } else if (side === "left") {
        const maximum = Math.max(
          minimum,
          bounds.width - this.rightPanelWidth - 370,
        );
        this.leftPanelWidth = clamp(
          move.clientX - bounds.left,
          minimum,
          maximum,
        );
        workbench.style.setProperty(
          "--zaw-left-panel-width",
          `${this.leftPanelWidth}px`,
        );
      } else {
        const maximum = Math.max(
          minimum,
          bounds.width - this.leftPanelWidth - 370,
        );
        this.rightPanelWidth = clamp(
          bounds.right - move.clientX,
          minimum,
          maximum,
        );
        workbench.style.setProperty(
          "--zaw-right-panel-width",
          `${this.rightPanelWidth}px`,
        );
      }
    };
    const stop = () => {
      document.body.classList.remove("panel-resizing");
      document.body.classList.remove("bottom-panel-resizing");
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
      this.saveWorkspaceUIState();
    };
    document.body.classList.add("panel-resizing");
    if (side === "bottom") {
      document.body.classList.add("bottom-panel-resizing");
    }
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop, { once: true });
  }

  private startFloatingMove(event: PointerEvent) {
    const target = event.target as HTMLElement;
    const resize = target.closest<HTMLElement>("[data-floating-resize]");
    const drag = target.closest<HTMLElement>("[data-floating-window-drag]");
    const state = this.floatingWindowService.current();
    if ((!resize && !drag) || !state || state.maximized) return false;
    if (window.matchMedia("(max-width: 540px)").matches) return true;
    if (target.closest("button")) return false;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = state.bounds;
    const edge = resize?.dataset.floatingResize ?? "";
    const move = (current: PointerEvent) => {
      const deltaX = current.clientX - startX;
      const deltaY = current.clientY - startY;
      const bounds = drag
        ? this.dragFloatingBounds(initial, deltaX, deltaY)
        : this.resizeFloatingBounds(initial, edge, deltaX, deltaY);
      this.floatingWindowService.updateBounds(bounds);
      this.applyFloatingBounds(bounds);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    return true;
  }

  private dragFloatingBounds(
    initial: FloatingWindowBounds,
    deltaX: number,
    deltaY: number,
  ) {
    return {
      ...initial,
      left: clamp(initial.left + deltaX, 0, window.innerWidth - initial.width),
      top: clamp(initial.top + deltaY, 0, window.innerHeight - initial.height),
    };
  }

  private resizeFloatingBounds(
    initial: FloatingWindowBounds,
    edge: string,
    deltaX: number,
    deltaY: number,
  ) {
    let { height, left, top, width } = initial;
    if (edge.includes("e")) width += deltaX;
    if (edge.includes("s")) height += deltaY;
    if (edge.includes("w")) {
      left += deltaX;
      width -= deltaX;
    }
    if (edge.includes("n")) {
      top += deltaY;
      height -= deltaY;
    }
    width = clamp(width, 360, window.innerWidth - left);
    height = clamp(height, 260, window.innerHeight - top);
    left = clamp(left, 0, window.innerWidth - width);
    top = clamp(top, 0, window.innerHeight - height);
    return { height, left, top, width };
  }

  private applyFloatingBounds(bounds: FloatingWindowBounds) {
    const floating = this.root.querySelector<HTMLElement>(
      ".zaw-floating-window",
    );
    if (!floating) return;
    floating.style.left = `${bounds.left}px`;
    floating.style.top = `${bounds.top}px`;
    floating.style.width = `${bounds.width}px`;
    floating.style.height = `${bounds.height}px`;
  }

  private async selectWorkspace(
    workspaceID: string,
    preferredSession?: string,
  ) {
    this.saveWorkspaceUIState();
    this.selectedWorkspaceID = workspaceID;
    const restored = this.workspaceUIStateService.load(workspaceID);
    const session = preferredSession ?? restored.sessionResource;
    if (session && (this.sessions[workspaceID] ?? []).includes(session)) {
      this.activeSessionService.select({ workspaceID, resource: session });
    } else {
      this.activeSessionService.clear();
    }
    this.activeDetailTabID = restored.activeDetailTabID ?? "changes";
    this.activeTerminal = restored.activeTerminal ?? null;
    this.terminalOpen = restored.terminalOpen ?? false;
    this.terminalPanelHeight = restored.terminalPanelHeight ?? 300;
    this.mobilePanel = null;
    this.updateWorkbench();
    try {
      const client = await this.clientFor(workspaceID);
      const active = this.activeSessionService.current();
      const [changeset, files] = await Promise.all([
        active?.workspaceID === workspaceID
          ? client.loadChangeset(active.resource)
          : Promise.resolve({ files: [], operations: [], resource: "" }),
        client.listResources(),
      ]);
      if (
        this.selectedWorkspaceID !== workspaceID ||
        this.attachmentService.attachedWorkspaceID() !== workspaceID
      ) {
        return;
      }
      this.changes[workspaceID] = changeset.files;
      this.changesetResources[workspaceID] = changeset.resource;
      this.files[workspaceID] = files.map((entry) => ({
        ...entry,
        uri: client.resourceURI(
          entry.type === "directory" ? `${entry.name}/` : entry.name,
        ),
      }));
      await this.reattachTerminals(workspaceID, client);
    } catch {
      this.connectionState[workspaceID] = "offline";
      if (this.selectedWorkspaceID === workspaceID) {
        this.toast =
          "Agent Host is offline. You can still browse this workspace.";
        this.updateWorkbench();
      }
    }
  }

  private async pickWorkspace(workspaceID: string) {
    this.sheet = null;
    this.newSessionWorkspaceID = workspaceID;
    await this.createSession();
  }

  private async selectSession(value: string) {
    const identity = parseSessionIdentityKey(value);
    if (!identity) return;
    this.mobilePanel = null;
    await this.selectWorkspace(identity.workspaceID, identity.resource);
  }

  private showNewSession() {
    this.saveWorkspaceUIState();
    this.activeSessionService.clear();
    this.selectedWorkspaceID = null;
    this.newSessionWorkspaceID ||=
      this.workspaces.find((workspace) => this.isOnline(workspace.id))?.id ??
      "";
    this.mobilePanel = null;
  }

  private async createSession() {
    const workspaceID =
      this.newSessionWorkspaceID ||
      this.workspaces.find((workspace) => this.isOnline(workspace.id))?.id;
    if (!workspaceID || !this.isOnline(workspaceID)) {
      this.toast = "Choose an online workspace before creating a session.";
      return;
    }
    try {
      const session = await this.clientFor(workspaceID).then((client) =>
        client.createSession("New Session"),
      );
      this.sessions[workspaceID] = [
        ...(this.sessions[workspaceID] ?? []),
        session.resource,
      ];
      this.sessionTitles[
        sessionIdentityKey({ workspaceID, resource: session.resource })
      ] = "New Session";
      this.selectedWorkspaceID = workspaceID;
      this.activeSessionService.select({
        workspaceID,
        resource: session.resource,
      });
      const draft = this.newSessionDraft.trim();
      this.newSessionDraft = "";
      if (draft) {
        const active = { workspaceID, resource: session.resource };
        this.chatSessionService.update(active, {
          draft,
          model: this.newSessionModelID,
        });
        await this.sendPrompt();
      } else if (this.newSessionModelID) {
        this.chatSessionService.update(
          { workspaceID, resource: session.resource },
          { model: this.newSessionModelID },
        );
      }
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private async sendPrompt() {
    const active = this.activeSessionService.current();
    if (!active || !this.selectedWorkspaceID) return;
    const composition = this.chatSessionService.composition(active);
    const text = composition.draft.trim();
    if (!text) return;
    try {
      await this.clientFor(this.selectedWorkspaceID).then((client) =>
        client.promptSession(active.resource, {
          agent: composition.agent,
          attachments: composition.attachments,
          model: composition.model,
          text,
        }),
      );
      this.chatSessionService.clearAfterSend(active);
      await this.attachmentService
        .attached(this.selectedWorkspaceID)
        ?.updateDraft(active.resource);
      this.updateWorkbench();
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private async cancelTurn() {
    const active = this.activeSessionService.current();
    if (!active) return;
    const turnID = this.chatSessionService.activeTurn(active);
    if (!turnID) return;
    try {
      await this.clientFor(active.workspaceID).then((client) =>
        client.cancelTurn(active.resource, turnID),
      );
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private async syncDraft(active: { workspaceID: string; resource: string }) {
    const client = this.attachmentService.attached(active.workspaceID);
    if (!client) return;
    const composition = this.chatSessionService.composition(active);
    await client.updateDraft(active.resource, {
      agent: composition.agent,
      attachments: composition.attachments,
      model: composition.model,
      text: composition.draft,
    });
  }

  private async addChatAttachments(files: File[]) {
    const active = this.activeSessionService.current();
    if (!active || files.length === 0) return;
    const attachments = await Promise.all(files.map(fileAttachment));
    const composition = this.chatSessionService.composition(active);
    this.chatSessionService.update(active, {
      attachments: [...composition.attachments, ...attachments],
    });
    await this.syncDraft(active);
    this.updateWorkbench();
  }

  private removeChatAttachment(index: number) {
    const active = this.activeSessionService.current();
    if (!active || !Number.isInteger(index)) return;
    const composition = this.chatSessionService.composition(active);
    this.chatSessionService.update(active, {
      attachments: composition.attachments.filter(
        (_attachment, attachmentIndex) => attachmentIndex !== index,
      ),
    });
    void this.syncDraft(active);
  }

  private confirmToolCall(value: string, approved: boolean) {
    const target = parseToolAction(value);
    if (!target) return;
    const client = this.attachmentService.attached(target.workspaceID);
    if (!client) return;
    client.confirmToolCall(
      target.chat,
      target.turnID,
      target.toolCallID,
      approved,
    );
  }

  private async createTerminal() {
    if (!this.selectedWorkspaceID || !this.isOnline(this.selectedWorkspaceID)) {
      this.toast =
        "The workspace is offline. Start it before creating a terminal.";
      return;
    }
    try {
      const terminal = await this.clientFor(this.selectedWorkspaceID).then(
        (client) =>
          client.createTerminal(
            `ahp-terminal:/${crypto.randomUUID()}`,
            "Terminal",
          ),
      );
      this.terminals[this.selectedWorkspaceID] = [
        ...(this.terminals[this.selectedWorkspaceID] ?? []),
        { ...terminal, title: "Terminal", output: "" },
      ];
      this.activeTerminal = terminal.resource;
      this.terminalOpen = true;
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private async disposeTerminal(resource: string) {
    if (!this.selectedWorkspaceID) return;
    try {
      await this.attachmentService
        .attached(this.selectedWorkspaceID)
        ?.disposeTerminal(resource);
      this.terminals[this.selectedWorkspaceID] = (
        this.terminals[this.selectedWorkspaceID] ?? []
      ).filter((terminal) => terminal.resource !== resource);
      if (this.activeTerminal === resource) this.activeTerminal = null;
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private async reattachTerminals(workspaceID: string, client: IAgentHost) {
    const terminals = await Promise.all(
      client.listTerminals().map(async (terminal) => {
        try {
          return await client.attachTerminal(terminal.resource);
        } catch {
          return terminal;
        }
      }),
    );
    if (
      this.selectedWorkspaceID !== workspaceID ||
      this.attachmentService.attachedWorkspaceID() !== workspaceID
    ) {
      return;
    }
    this.terminals[workspaceID] = terminals;
    if (
      this.activeTerminal &&
      !terminals.some((terminal) => terminal.resource === this.activeTerminal)
    ) {
      this.activeTerminal = null;
    }
    if (this.terminalOpen && !this.activeTerminal) {
      this.activeTerminal = terminals[0]?.resource ?? null;
    }
    this.updateWorkbench();
  }

  private async openFile(uri: string) {
    if (!this.selectedWorkspaceID) return;
    try {
      const content = await this.clientFor(this.selectedWorkspaceID).then(
        (client) => client.readResource(uri),
      );
      this.openPreviewTab(uri, fileName(uri), content);
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private async openDirectory(uri: string) {
    if (!this.selectedWorkspaceID) return;
    try {
      const client = await this.clientFor(this.selectedWorkspaceID);
      const entries = await client.listResources(uri);
      this.files[this.selectedWorkspaceID] = entries.map((entry) => ({
        ...entry,
        uri: client.resourceURI(
          entry.type === "directory" ? `${entry.name}/` : entry.name,
          uri,
        ),
      }));
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private async refreshWorkspaceData() {
    if (!this.selectedWorkspaceID) return;
    try {
      const client = await this.clientFor(this.selectedWorkspaceID);
      const active = this.activeSessionService.current();
      const [changeset, files] = await Promise.all([
        active
          ? client.loadChangeset(active.resource)
          : Promise.resolve({ files: [], operations: [], resource: "" }),
        client.listResources(),
      ]);
      this.changes[this.selectedWorkspaceID] = changeset.files;
      this.changesetResources[this.selectedWorkspaceID] = changeset.resource;
      this.files[this.selectedWorkspaceID] = files.map((entry) => ({
        ...entry,
        uri: client.resourceURI(
          entry.type === "directory" ? `${entry.name}/` : entry.name,
        ),
      }));
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private async openChange(path: string) {
    if (!this.selectedWorkspaceID) return;
    const change = (this.changes[this.selectedWorkspaceID] ?? []).find(
      (item) => item.path === path,
    );
    if (!change) return;
    this.openPreviewTab(`diff:${path}`, path, change.diff);
  }

  private openDetailTab(kind: DetailTab) {
    const existing = this.detailTabs.find((tab) => tab.id === kind);
    if (!existing) {
      this.detailTabs.push({
        id: kind,
        title: kind === "changes" ? "Changes" : "Files",
        kind,
      });
    }
    this.activeDetailTabID = kind;
  }

  private openPreviewTab(id: string, title: string, content: string) {
    const existing = this.detailTabs.find((tab) => tab.id === id);
    if (existing) existing.content = content;
    else this.detailTabs.push({ id, title, kind: "preview", content });
    this.activeDetailTabID = id;
  }

  private closeDetailTab(id: string) {
    if (this.detailTabs.length === 1) return;
    const index = this.detailTabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    this.detailTabs.splice(index, 1);
    if (this.activeDetailTabID === id) {
      this.activeDetailTabID = this.detailTabs[Math.max(0, index - 1)].id;
    }
  }

  private activeDetailTab(): DetailPaneTab {
    return (
      this.detailTabs.find((tab) => tab.id === this.activeDetailTabID) ?? {
        id: "changes",
        title: "Changes",
        kind: "changes",
      }
    );
  }

  private async stageChange(path: string) {
    if (!this.selectedWorkspaceID) return;
    const changeset = this.changesetResources[this.selectedWorkspaceID];
    const change = (this.changes[this.selectedWorkspaceID] ?? []).find(
      (item) => item.path === path,
    );
    if (!changeset || !change) return;
    try {
      await this.clientFor(this.selectedWorkspaceID).then((client) =>
        client.invokeChangesetOperation(changeset, "stage", change.resource),
      );
      this.toast = `${path} accepted into the Git index.`;
      await this.refreshWorkspaceData();
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private async revertChange() {
    if (!this.selectedWorkspaceID || !this.pendingRevertPath) return;
    const changeset = this.changesetResources[this.selectedWorkspaceID];
    const change = (this.changes[this.selectedWorkspaceID] ?? []).find(
      (item) => item.path === this.pendingRevertPath,
    );
    if (!changeset || !change) return;
    try {
      await this.clientFor(this.selectedWorkspaceID).then((client) =>
        client.invokeChangesetOperation(changeset, "revert", change.resource),
      );
      this.toast = `${this.pendingRevertPath} was restored from Git.`;
      this.pendingRevertPath = "";
      this.sheet = null;
      await this.refreshWorkspaceData();
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private reviewChange(path: string) {
    if (!this.selectedWorkspaceID) return;
    const changeset = this.changesetResources[this.selectedWorkspaceID];
    const change = (this.changes[this.selectedWorkspaceID] ?? []).find(
      (item) => item.path === path,
    );
    if (!changeset || !change) return;
    this.attachmentService
      .attached(this.selectedWorkspaceID)
      ?.setChangesReviewed(changeset, [change.id], !change.reviewed);
    change.reviewed = !change.reviewed;
  }

  private async clientFor(workspaceID: string) {
    const client = await this.attachmentService.attach(workspaceID);
    this.connectionState[workspaceID] = "connected";
    return client;
  }

  private applyAction(workspaceID: string, update: AHPAction) {
    this.ahpActionContributionRegistry.dispatch(workspaceID, update, {
      applyToolApproval: (identity, action, state) =>
        this.applyToolApproval(identity, action, state),
      applyToolCall: (identity, action, state) =>
        this.applyToolCall(identity, action, state),
      attachmentService: this.attachmentService,
      changes: this.changes,
      changesetResources: this.changesetResources,
      chatSessionService: this.chatSessionService,
      identityForChat: (id, chat) => this.identityForChat(id, chat),
      messages: this.messages,
      reattachTerminals: (id) => {
        const client = this.attachmentService.attached(id);
        if (client) void this.reattachTerminals(id, client);
      },
      sessionTitles: this.sessionTitles,
      sessions: this.sessions,
      terminals: this.terminals,
    });
    this.updateWorkbench();
  }

  private identityForChat(workspaceID: string, chat: string) {
    if (!chat.startsWith("ahp-chat:/")) return undefined;
    const resource =
      this.attachmentService.attached(workspaceID)?.sessionForChat(chat) ??
      `ahp-session:/${chat.slice("ahp-chat:/".length)}`;
    return { workspaceID, resource };
  }

  private applyToolCall(
    identity: { workspaceID: string; resource: string },
    update: AHPAction,
    state: string,
  ) {
    const toolCallID = stringValue(update.action.toolCallId);
    if (!toolCallID) return;
    const key = sessionIdentityKey(identity);
    const events = this.messages[key] ?? [];
    const existing = events.find(
      (event) => event.kind === "tool" && event.toolCallID === toolCallID,
    );
    const result = objectValue(update.action.result);
    const detail =
      stringValue(update.action.toolInput) ||
      JSON.stringify(result.content ?? update.action.result ?? "");
    if (existing?.kind === "tool") {
      existing.state = state;
      if (detail) existing.detail = detail;
    } else {
      events.push({
        kind: "tool",
        toolCallID,
        title:
          stringValue(update.action.displayName) ||
          stringValue(update.action.toolName) ||
          "Agent tool",
        detail,
        state,
      });
    }
    this.messages[key] = events;
  }

  private applyToolApproval(
    identity: { workspaceID: string; resource: string },
    update: AHPAction,
    state: "approved" | "denied" | "pending",
  ) {
    const toolCallID = stringValue(update.action.toolCallId);
    const turnID = stringValue(update.action.turnId);
    if (!toolCallID || !turnID) return;
    const key = sessionIdentityKey(identity);
    const events = this.messages[key] ?? [];
    const existing = events.find(
      (event) => event.kind === "approval" && event.toolCallID === toolCallID,
    );
    if (existing?.kind === "approval") {
      existing.state = state;
    } else {
      events.push({
        kind: "approval",
        actionValue: toolActionValue({
          chat: update.channel,
          toolCallID,
          turnID,
          workspaceID: identity.workspaceID,
        }),
        toolCallID,
        title:
          stringOrMarkdown(update.action.confirmationTitle) ||
          "Agent approval requested",
        detail:
          stringOrMarkdown(update.action.invocationMessage) ||
          stringValue(update.action.toolInput),
        state,
      });
    }
    this.messages[key] = events;
  }

  private reconnectWorkspace(workspaceID: string) {
    if (this.selectedWorkspaceID !== workspaceID) return;
    if (this.connectionState[workspaceID] === "reconnecting") return;
    this.connectionState[workspaceID] = "reconnecting";
    this.updateWorkbench();
    window.setTimeout(async () => {
      if (this.selectedWorkspaceID !== workspaceID) return;
      try {
        await this.clientFor(workspaceID);
        this.toast = "Reconnected to Agent Host.";
      } catch {
        this.connectionState[workspaceID] = "offline";
      }
      this.updateWorkbench();
    }, 1_000);
  }

  private selectedWorkspace() {
    return this.workspaces.find(
      (workspace) => workspace.id === this.selectedWorkspaceID,
    );
  }

  private selectedTerminal() {
    return (this.terminals[this.selectedWorkspaceID ?? ""] ?? []).find(
      (terminal) => terminal.resource === this.activeTerminal,
    );
  }

  private saveWorkspaceUIState() {
    if (!this.selectedWorkspaceID) return;
    const active = this.activeSessionService.current();
    this.workspaceUIStateService.save(this.selectedWorkspaceID, {
      activeDetailTabID: this.activeDetailTabID,
      activeTerminal: this.activeTerminal ?? undefined,
      sessionResource:
        active?.workspaceID === this.selectedWorkspaceID
          ? active.resource
          : undefined,
      terminalOpen: this.terminalOpen,
      terminalPanelHeight: this.terminalPanelHeight,
    });
  }

  private isOnline(workspaceID: string) {
    const connection = this.connectionState[workspaceID];
    if (connection) return connection === "connected";
    return this.workspaces.some(
      (workspace) =>
        workspace.id === workspaceID && workspace.agentHostState === "online",
    );
  }

  private applyTheme() {
    document.documentElement.dataset.zawTheme = this.theme;
    window.localStorage.setItem("zaw.theme", this.theme);
  }

  private openSettingsWindow() {
    this.floatingFocusRestore = document.activeElement as HTMLElement | null;
    const width = Math.min(960, Math.max(360, window.innerWidth - 48));
    const height = Math.min(720, Math.max(260, window.innerHeight - 48));
    this.floatingWindowService.open("management", "Settings", {
      height,
      left: Math.max(0, (window.innerWidth - width) / 2),
      top: Math.max(0, (window.innerHeight - height) / 2),
      width,
    });
    const state = this.floatingWindowService.current();
    if (state) {
      this.floatingWindowService.updateBounds(
        this.resizeFloatingBounds(state.bounds, "", 0, 0),
      );
    }
  }

  private requestCloseManagementSheet() {
    if (this.sheet === "confirm-discard") {
      this.sheet = this.dirtySheet;
      this.dirtySheet = null;
      return;
    }
    if (this.managementDirty && this.sheet) {
      this.dirtySheet = this.sheet;
      this.sheet = "confirm-discard";
      return;
    }
    this.sheet = null;
  }

  private selectManagementView(viewID: string) {
    if (!this.managementViewRegistry.get(viewID)) return;
    if (viewID !== this.managementViewID) {
      this.managementHistory.push(this.managementViewID);
      this.managementViewID = viewID;
    }
  }

  private closeFloatingWindow() {
    const restore = this.floatingFocusRestore;
    this.floatingWindowService.close();
    this.floatingFocusRestore = null;
    window.requestAnimationFrame(() => restore?.focus());
  }

  private trapFloatingFocus(event: KeyboardEvent) {
    const floating = this.root.querySelector<HTMLElement>(
      ".zaw-floating-window",
    );
    if (!floating) return;
    const focusable = Array.from(
      floating.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), " +
          "textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
      ),
    );
    if (focusable.length === 0) return;
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? current <= 0
        ? focusable.length - 1
        : current - 1
      : current < 0 || current === focusable.length - 1
        ? 0
        : current + 1;
    event.preventDefault();
    focusable[next]?.focus();
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    return this.managementProvider.request<T>(path, init);
  }

  private async reloadMetadata() {
    const [workspaces, templates, credentials] = await Promise.all([
      this.workspaceProvider.list(),
      this.managementProvider.listTemplates(),
      this.managementProvider.listCredentials(),
    ]);
    this.workspaces = workspaces;
    this.templates = templates;
    this.credentials = credentials;
    await this.reloadRuntimeMetadata();
  }

  private async reloadRuntimeMetadata() {
    const [provisioners, jobs, builds] = await Promise.all([
      this.managementProvider.request<RuntimeProvisioner[]>("/provisioners"),
      this.managementProvider.request<RuntimeJob[]>("/provisioner-jobs"),
      this.managementProvider.request<RuntimeBuild[]>("/builds"),
    ]);
    this.provisioners = provisioners;
    this.jobs = jobs;
    this.builds = builds;
  }

  private formValue(name: string) {
    return (
      this.root
        .querySelector<HTMLInputElement>(`[name="${name}"]`)
        ?.value.trim() ?? ""
    );
  }

  private async saveTemplate() {
    const kind = this.templateKind;
    const source: Record<string, string> = {
      kind,
      url: this.formValue("template-url"),
      credentialId: this.formValue("template-credential"),
    };
    if (kind === "git") {
      source.ref = this.formValue("template-ref");
      source.directory = this.formValue("template-directory");
    } else {
      source.sha256 = this.formValue("template-sha256");
      source.format = this.formValue("template-format");
    }
    try {
      const editing = this.editingTemplate;
      await this.request<Template>(
        editing ? `/templates/${editing.id}` : "/templates",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: this.formValue("template-name"),
            description: this.formValue("template-description"),
            source,
          }),
        },
      );
      await this.reloadMetadata();
      this.sheet = null;
      this.managementDirty = false;
      this.editingTemplate = null;
      this.toast = editing
        ? "Template source updated and pinned."
        : "Template saved with its resolved source snapshot.";
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private async saveWorkspace() {
    try {
      const created = await this.workspaceProvider.create({
        name: this.formValue("workspace-name"),
        parameters: {},
        templateId: this.formValue("workspace-template"),
      });
      await this.reloadMetadata();
      this.newSessionWorkspaceID = created.id;
      this.activeSessionService.clear();
      this.selectedWorkspaceID = null;
      this.sheet = null;
      this.managementDirty = false;
      this.toast = "Workspace creation started.";
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private async saveCredential() {
    const kind = this.credentialKind;
    const metadata: Record<string, string> = {};
    const secret: Record<string, string> = {};
    if (kind === "token") {
      const token = this.formValue("credential-token");
      if (token) secret.token = token;
    }
    if (kind === "username_password") {
      metadata.username = this.formValue("credential-username");
      const password = this.formValue("credential-password");
      if (password) secret.password = password;
    }
    if (kind === "ssh_key") {
      metadata.username = this.formValue("credential-username");
      metadata.publicKey = this.formValue("credential-public-key");
      metadata.fingerprint = this.formValue("credential-fingerprint");
      const privateKey = this.formValue("credential-private-key");
      if (privateKey) secret.privateKey = privateKey;
    }
    try {
      const editing = this.editingCredential;
      await this.request<Credential>(
        editing ? `/credentials/${editing.id}` : "/credentials",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: this.formValue("credential-name"),
            kind,
            metadata,
            secret,
          }),
        },
      );
      await this.reloadMetadata();
      this.sheet = null;
      this.managementDirty = false;
      this.editingCredential = null;
      this.toast = editing
        ? "System credential updated."
        : "System credential saved to the configured secret manager.";
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private async deleteCredential(credentialID: string) {
    try {
      await this.request<void>(`/credentials/${credentialID}`, {
        method: "DELETE",
      });
      await this.reloadMetadata();
      this.toast = "System credential deleted.";
      this.sheet = null;
      this.pendingCredentialDeleteID = "";
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private editCredential(credentialID: string) {
    const credential = this.credentials.find(
      (item) => item.id === credentialID,
    );
    if (!credential) return;
    this.editingCredential = credential;
    this.credentialKind = credential.kind;
    this.sheet = "credential";
    this.managementDirty = false;
  }

  private editTemplate(templateID: string) {
    const template = this.templates.find((item) => item.id === templateID);
    if (!template) return;
    this.editingTemplate = template;
    this.templateKind = template.source.kind;
    this.sheet = "template";
    this.managementDirty = false;
  }

  private async deleteTemplate() {
    if (!this.pendingTemplateDeleteID) return;
    try {
      await this.request<void>(`/templates/${this.pendingTemplateDeleteID}`, {
        method: "DELETE",
      });
      await this.reloadMetadata();
      this.sheet = null;
      this.pendingTemplateDeleteID = "";
      this.toast = "Template deleted.";
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private async requestBuild(
    operation: "rebuild-from-current-template" | "start" | "stop",
  ) {
    if (!this.selectedWorkspaceID) return;
    await this.requestWorkspaceBuild(this.selectedWorkspaceID, operation);
  }

  private async requestWorkspaceBuild(
    workspaceID: string,
    operation: "rebuild-from-current-template" | "start" | "stop",
  ) {
    try {
      await this.workspaceProvider.requestBuild(workspaceID, operation);
      await this.reloadMetadata();
      this.toast = `Workspace ${operation} build queued.`;
    } catch (error) {
      this.toast = errorMessage(error);
    }
  }

  private updateWorkbench() {
    this.shell?.dispose();
    const rendered = this.workbenchViewHost.render(this.viewContext());
    const shellRoot = document.createElement("div");
    this.shell = new WorkbenchShell(shellRoot, {
      leftPanelVisible: this.leftPanelVisible,
      leftPanelWidth: this.leftPanelWidth,
      locations: rendered.byLocation,
      rightPanelVisible: this.rightPanelVisible,
      rightPanelWidth: this.rightPanelWidth,
    });
    this.root.replaceChildren(...Array.from(shellRoot.childNodes));
    this.observeTerminalResize();
    this.applyModalFocus();
  }

  private viewContext(): WorkbenchViewContext {
    const workspace = this.selectedWorkspace();
    const workspaceID = this.selectedWorkspaceID ?? "";
    const activeSession = this.activeSessionService.current();
    const messages = activeSession
      ? (this.messages[sessionIdentityKey(activeSession)] ?? [])
      : [];
    const changes = this.changes[workspaceID] ?? [];
    const files = this.files[workspaceID] ?? [];
    const terminals = this.terminals[workspaceID] ?? [];
    const terminal = this.selectedTerminal();
    const workspaceOnline = workspace ? this.isOnline(workspace.id) : false;
    const connection = workspace
      ? (this.connectionState[workspace.id] ??
        (workspaceOnline ? "connected" : "offline"))
      : "offline";
    const composition = activeSession
      ? this.chatSessionService.composition(activeSession)
      : {
          agent: "copilot",
          approvalMode: "ask" as const,
          attachments: [],
          draft: "",
          model: "",
        };
    const selectedSessionTitle = this.selectedSession
      ? (this.sessionTitles[
          sessionIdentityKey({
            workspaceID,
            resource: this.selectedSession,
          })
        ] ?? this.selectedSession.replace("ahp-session:/", ""))
      : "New session";
    return {
      activeDetailTab: this.activeDetailTab(),
      activeDetailTabID: this.activeDetailTabID,
      activeTerminal: this.activeTerminal,
      activeTurn: activeSession
        ? this.chatSessionService.activeTurn(activeSession) !== undefined
        : false,
      builds: this.builds,
      changes,
      chatComposition: composition,
      connection,
      credentialKind: this.credentialKind,
      credentials: this.credentials,
      detailTabRendererRegistry: this.detailTabRendererRegistry,
      detailTabs: this.detailTabs,
      dirtySheet: this.dirtySheet,
      editingCredential: this.editingCredential,
      editingTemplate: this.editingTemplate,
      emitAction: (action) => this.handleViewAction(action),
      files,
      floatingWindow: this.floatingWindowService.current(),
      jobs: this.jobs,
      leftPanelVisible: this.leftPanelVisible,
      managementHistoryLength: this.managementHistory.length,
      managementQuery: this.managementQuery,
      managementScope: this.managementScope,
      managementSheetContributionRegistry:
        this.managementSheetContributionRegistry,
      managementViewID: this.managementViewID,
      managementViewRegistry: this.managementViewRegistry,
      messages,
      mobilePanel: this.mobilePanel,
      models: this.models,
      newSessionDraft: this.newSessionDraft,
      newSessionModelID: this.newSessionModelID,
      newSessionWorkspaceID: this.newSessionWorkspaceID,
      pendingCredentialDeleteID: this.pendingCredentialDeleteID,
      pendingRevertPath: this.pendingRevertPath,
      pendingTemplateDeleteID: this.pendingTemplateDeleteID,
      pendingWorkspaceID: this.pendingWorkspaceID,
      provisioners: this.provisioners,
      rightPanelVisible: this.rightPanelVisible,
      selectedSession: this.selectedSession,
      selectedSessionTitle,
      selectedWorkspaceID: this.selectedWorkspaceID,
      sessionEventRendererRegistry: this.sessionEventRendererRegistry,
      sessionTitles: this.sessionTitles,
      sessions: this.sessions,
      sheet: this.sheet,
      templateKind: this.templateKind,
      templates: this.templates,
      terminal,
      terminalCollapsed: this.terminalCollapsed,
      terminalOpen: this.terminalOpen,
      terminalPanelHeight: this.terminalPanelHeight,
      terminals,
      theme: this.theme,
      toast: this.toast,
      workspace,
      workspaceFilter: this.workspaceFilter,
      workspaceOnline,
      workspaces: this.workspaces,
    };
  }

  private updateActiveComposition(
    update: Partial<ReturnType<IChatSessionService["composition"]>>,
  ) {
    const active = this.activeSessionService.current();
    if (!active) return;
    this.chatSessionService.update(active, update);
    void this.syncDraft(active);
  }

  private observeTerminalResize() {
    this.terminalResizeObserver?.disconnect();
    const output = this.root.querySelector<HTMLElement>(
      "[data-terminal-output]",
    );
    const terminal = this.selectedTerminal();
    if (!output || !terminal || !this.selectedWorkspaceID) return;
    const workspaceID = this.selectedWorkspaceID;
    let previous = "";
    this.terminalResizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const cols = Math.max(20, Math.floor(entry.contentRect.width / 8));
      const rows = Math.max(4, Math.floor(entry.contentRect.height / 18));
      const size = `${cols}x${rows}`;
      if (size === previous) return;
      previous = size;
      this.attachmentService
        .attached(workspaceID)
        ?.terminalResize(terminal.resource, cols, rows);
    });
    this.terminalResizeObserver.observe(output);
  }

  private handleViewAction(action: WorkbenchViewAction) {
    switch (action.kind) {
      case "addChatAttachments":
        void this.addChatAttachments(action.files);
        return;
      case "cancelTurn":
        this.refreshAfter(this.cancelTurn());
        return;
      case "changeAgent":
        this.updateActiveComposition({ agent: action.value });
        return;
      case "changeApprovalMode":
        this.updateActiveComposition({ approvalMode: action.value });
        return;
      case "changeDraft":
        this.updateActiveComposition({ draft: action.value });
        return;
      case "changeModel":
        this.updateActiveComposition({ model: action.value });
        return;
      case "chooseNewSessionModel":
        this.newSessionModelID = action.value;
        return;
      case "chooseNewSessionWorkspace":
        this.newSessionWorkspaceID = action.value;
        break;
      case "chooseTemplateSource":
        this.templateKind = action.value;
        this.sheet = "template";
        this.managementDirty = false;
        break;
      case "closeDetailTab":
        this.closeDetailTab(action.value);
        break;
      case "closeFloatingWindow":
        this.closeFloatingWindow();
        break;
      case "closeManagementSheet":
        this.requestCloseManagementSheet();
        break;
      case "closeMobilePanel":
        this.mobilePanel = null;
        break;
      case "confirmToolCall":
        this.confirmToolCall(action.value, action.approved);
        break;
      case "continueEditing":
        this.sheet = this.dirtySheet;
        this.dirtySheet = null;
        break;
      case "createSession":
        this.refreshAfter(this.createSession());
        return;
      case "createTerminal":
        this.refreshAfter(this.createTerminal());
        return;
      case "deleteCredential":
        this.refreshAfter(
          this.deleteCredential(this.pendingCredentialDeleteID),
        );
        return;
      case "deleteTemplate":
        this.refreshAfter(this.deleteTemplate());
        return;
      case "discardManagementChanges":
        this.managementDirty = false;
        this.dirtySheet = null;
        this.sheet = null;
        break;
      case "dismissToast":
        this.toast = "";
        break;
      case "disposeTerminal":
        this.refreshAfter(this.disposeTerminal(action.value));
        return;
      case "floatingGoBack": {
        const previous = this.managementHistory.pop();
        if (previous) this.managementViewID = previous;
        break;
      }
      case "floatingMaximize":
        this.floatingWindowService.maximize(
          window.innerWidth,
          window.innerHeight,
        );
        break;
      case "floatingRestore":
        this.floatingWindowService.restore();
        break;
      case "managementAction":
        this.applyManagementViewAction(action.action);
        return;
      case "openChange":
        this.refreshAfter(this.openChange(action.value));
        return;
      case "openDirectory":
        this.refreshAfter(this.openDirectory(action.value));
        return;
      case "openFile":
        this.refreshAfter(this.openFile(action.value));
        return;
      case "openFilesTab":
        this.openDetailTab("files");
        break;
      case "openSettings":
        this.openSettingsWindow();
        break;
      case "openWorkspaceCreate":
        this.sheet = "workspace";
        this.managementDirty = false;
        break;
      case "pickWorkspace":
        this.refreshAfter(this.pickWorkspace(action.value));
        return;
      case "rebuildWorkspace":
        this.refreshAfter(this.requestBuild("rebuild-from-current-template"));
        return;
      case "refreshWorkspace":
        this.refreshAfter(this.refreshWorkspaceData());
        return;
      case "removeChatAttachment":
        this.removeChatAttachment(action.index);
        break;
      case "requestRevertChange":
        this.pendingRevertPath = action.value;
        this.sheet = "confirm-revert";
        break;
      case "revertChange":
        this.refreshAfter(this.revertChange());
        return;
      case "reviewChange":
        this.reviewChange(action.value);
        break;
      case "saveCredential":
        this.refreshAfter(this.saveCredential());
        return;
      case "saveTemplate":
        this.refreshAfter(this.saveTemplate());
        return;
      case "saveWorkspace":
        this.refreshAfter(this.saveWorkspace());
        return;
      case "searchManagement":
        this.managementQuery = action.value;
        break;
      case "selectDetailTab":
        this.activeDetailTabID = action.value;
        break;
      case "selectManagementScope": {
        this.managementScope = action.value;
        const first = this.managementViewRegistry
          .all()
          .find((item) => item.scope === action.value);
        if (first) this.selectManagementView(first.id);
        break;
      }
      case "selectManagementView":
        this.selectManagementView(action.value);
        break;
      case "selectSession":
        this.refreshAfter(this.selectSession(action.value));
        return;
      case "selectTerminal":
        this.activeTerminal = action.value;
        break;
      case "sendMessage":
        this.refreshAfter(this.sendPrompt());
        return;
      case "setCredentialKind":
        this.credentialKind = action.value;
        this.managementDirty = true;
        break;
      case "stageChange":
        this.refreshAfter(this.stageChange(action.value));
        return;
      case "startNewSession":
        this.showNewSession();
        break;
      case "stopWorkspace":
        this.refreshAfter(this.stopPendingWorkspace());
        return;
      case "terminalInput": {
        const terminal = this.selectedTerminal();
        if (terminal && this.selectedWorkspaceID) {
          this.attachmentService
            .attached(this.selectedWorkspaceID)
            ?.terminalInput(terminal.resource, action.value);
        }
        return;
      }
      case "toggleLeftPanel":
        this.togglePanel("workspaces");
        break;
      case "toggleRightPanel":
        this.togglePanel("details");
        break;
      case "toggleTerminal":
        this.terminalOpen = !this.terminalOpen;
        this.saveWorkspaceUIState();
        break;
      case "toggleTerminalCollapse":
        this.terminalCollapsed = !this.terminalCollapsed;
        break;
      case "toggleWorkspaceState":
        this.refreshAfter(
          this.requestBuild(
            this.selectedWorkspace()?.desiredState === "running"
              ? "stop"
              : "start",
          ),
        );
        return;
      case "updateNewSessionDraft":
        this.newSessionDraft = action.value;
        return;
      default:
        action satisfies never;
    }
    this.updateWorkbench();
  }

  private refreshAfter(operation: Promise<unknown>) {
    void operation.then(() => this.updateWorkbench());
  }

  private togglePanel(panel: Exclude<MobilePanel, null>) {
    if (window.matchMedia("(max-width: 860px)").matches) {
      this.mobilePanel = this.mobilePanel === panel ? null : panel;
    } else if (panel === "workspaces") {
      this.leftPanelVisible = !this.leftPanelVisible;
    } else {
      this.rightPanelVisible = !this.rightPanelVisible;
    }
  }

  private async stopPendingWorkspace() {
    await this.requestWorkspaceBuild(this.pendingWorkspaceID, "stop");
    this.sheet = null;
    this.pendingWorkspaceID = "";
  }

  private applyManagementViewAction(action: ManagementViewAction) {
    this.managementActionHandlers[action.kind](action as never);
  }

  private applyModalFocus() {
    const floating = this.root.querySelector<HTMLElement>(
      ".zaw-floating-window",
    );
    if (!floating) return;
    for (const element of this.root.querySelectorAll<HTMLElement>(
      ".app-titlebar, .workspace-sidebar, .session-canvas, .session-sidebar",
    )) {
      element.inert = true;
    }
    if (!floating.contains(document.activeElement)) floating.focus();
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

type ToolActionTarget = {
  chat: string;
  toolCallID: string;
  turnID: string;
  workspaceID: string;
};

function parseToolAction(value: string): ToolActionTarget | undefined {
  try {
    const target = JSON.parse(decodeURIComponent(value)) as ToolActionTarget;
    if (
      !target.chat ||
      !target.toolCallID ||
      !target.turnID ||
      !target.workspaceID
    ) {
      return undefined;
    }
    return target;
  } catch {
    return undefined;
  }
}

async function fileAttachment(file: File): Promise<ChatAttachment> {
  const dataURL = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
  return {
    type: "embeddedResource",
    label: file.name,
    data: dataURL.slice(dataURL.indexOf(",") + 1),
    contentType: file.type || "application/octet-stream",
    displayKind: file.type.startsWith("image/") ? "image" : "document",
  };
}

function fileName(uri: string) {
  const parts = uri.split("/").filter(Boolean);
  return parts.at(-1) || "Untitled";
}
function isTheme(value: string | null): value is ColorTheme {
  return (
    value === "dark" ||
    value === "hc" ||
    value === "light" ||
    value === "system"
  );
}
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}
