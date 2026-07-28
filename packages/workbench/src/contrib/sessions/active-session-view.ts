import { Disposable, PickerAction, createElement } from "@zaw/ui";
import type { ICommandService } from "../../platform/commands/commands";
import type { IActionRegistry } from "../../platform/actions/actions";
import type { ComposerAgent } from "./agent-composer";
import type { SessionIdentity } from "../../services/active-session";
import { sessionIdentityKey } from "../../services/active-session";
import type { IChatSessionService } from "../../services/chat-session";
import type { IManagementService } from "../management/management-service";
import type { IWorkspaceService } from "../workspace/workspace-service";
import { isWorkspaceRunning } from "../workspace/workspace-service";
import { ConversationTranscript } from "./conversation-transcript";
import {
  ActiveSessionComposer,
  ComposerPersistentLane,
  FollowupSuggestions,
  InterruptionLane,
} from "./chat-input-lanes";
import type { ISessionCatalogService } from "./session-catalog-service";
import { runtimeModelID } from "./model-identity";

export class ActiveSessionView extends Disposable {
  readonly element = createElement("section", {
    ariaLabel: "Active session",
    className: "agent-active-session-view",
  });
  private readonly transcript: ConversationTranscript;
  private readonly composer: ActiveSessionComposer;
  private readonly interruption: InterruptionLane;
  private readonly persistent = new ComposerPersistentLane();
  private readonly followups = new FollowupSuggestions();
  private lastFocused: HTMLElement | undefined;

  constructor(
    private readonly identity: SessionIdentity,
    private readonly catalog: ISessionCatalogService,
    private readonly chat: IChatSessionService,
    private readonly commands: ICommandService,
    private readonly actions?: IActionRegistry,
    private readonly workspaces?: IWorkspaceService,
    private readonly management?: IManagementService,
    private readonly agents: () => readonly ComposerAgent[] = () => [],
  ) {
    super();
    const renderOptions = {
      confirmToolCall: (chat: string, toolCallID: string, approved: boolean) =>
        void this.commands.executeCommand(
          "zaw.session.confirmToolCall",
          chat,
          toolCallID,
          approved,
        ),
    };
    this.transcript = this._register(new ConversationTranscript(renderOptions));
    this.interruption = this._register(new InterruptionLane(renderOptions));
    const composerLane = createElement("div", {
      className: "agent-active-composer-lane",
    });
    this.composer = this._register(
      new ActiveSessionComposer({
        actions: this.actions,
        ariaLabel: "Message the agent",
        composition: () => this.chat.composition(this.identity),
        commands: this.commands,
        disabled: () =>
          Boolean(
            this.workspaces &&
              !this.chat.activeTurn(this.identity) &&
              !isWorkspaceRunning(
                this.workspaces.workspaces.find(
                  (workspace) => workspace.id === this.identity.workspaceID,
                ),
              ),
          ),
        models: () =>
          (this.management?.models ?? []).map((model) => ({
            ...model,
            id: runtimeModelID(model),
            vendor: (this.management?.modelProviders ?? []).find(
              (provider) => provider.id === model.providerId,
            )?.name,
          })),
        modelsState: () => this.management?.modelsState ?? "ready",
        onChange: (changes) => this.chat.update(this.identity, changes),
        onSubmit: () =>
          void this.commands.executeCommand(
            this.chat.activeTurn(this.identity)
              ? "zaw.session.cancel"
              : "zaw.session.send",
          ),
        placeholder: () =>
          !this.workspaces ||
          isWorkspaceRunning(
            this.workspaces.workspaces.find(
              (workspace) => workspace.id === this.identity.workspaceID,
            ),
          )
            ? "Message the agent"
            : "Workspace must be running to send messages",
        working: () => Boolean(this.chat.activeTurn(this.identity)),
        workingAction: "cancel",
      }),
    );
    composerLane.append(
      this.persistent.element,
      this.interruption.element,
      this.composer.element,
      this.followups.element,
      this.createContextLine(),
    );
    this.element.append(
      this.transcript.element,
      this.transcript.scrollDownHost,
      composerLane,
    );
    this._register(
      this.chat.onDidChange((changed) => {
        if (sessionIdentityKey(changed) === sessionIdentityKey(this.identity))
          this.refresh();
      }),
    );
    this._register(this.catalog.onDidChange(() => this.updateAccessibleName()));
    this._register(
      this.management?.onDidChange(() => this.composer.refreshPickers()) ?? {
        dispose() {},
      },
    );
    this._register(
      this.workspaces?.onDidChange(() => {
        this.composer.refreshPickers();
        this.composer.refresh();
      }) ?? {
        dispose() {},
      },
    );
    this.refresh();
  }

  setVisible(visible: boolean): void {
    if (!visible) {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && this.element.contains(focused))
        this.lastFocused = focused;
      this.element.hidden = true;
      return;
    }
    this.element.hidden = false;
    const restore = this.lastFocused;
    if (restore)
      requestAnimationFrame(() => {
        if (!this.element.hidden && restore.isConnected) restore.focus();
      });
  }

  refreshAgents(): void {
    this.composer.refreshPickers();
  }

  private refresh(): void {
    const events = this.chat.events(this.identity);
    const pending = events.filter(
      (event) => event.kind === "approval" && event.state === "pending",
    );
    const notifications = events.filter(
      (event) => event.kind === "notification",
    );
    this.transcript.update(
      events.filter(
        (event) => event.kind !== "approval" && event.kind !== "notification",
      ),
    );
    this.persistent.update(notifications);
    this.interruption.update(pending);
    this.composer.refresh();
    this.updateAccessibleName();
  }

  private updateAccessibleName(): void {
    const title =
      this.catalog.sessionTitles[sessionIdentityKey(this.identity)] ??
      "Session";
    this.element.setAttribute("aria-label", title);
  }

  private createContextLine(): HTMLElement {
    const workspace = this.workspaces?.workspaces.find(
      (entry) => entry.id === this.identity.workspaceID,
    );
    const line = createElement("div", {
      className: "agent-session-context-line",
    });
    const permissionHost = createElement("span", {
      className: "agent-control-picker agent-permission-picker",
    });
    const permission = this._register(
      new PickerAction(permissionHost, {
        ariaLabel: "Permission level",
        icon: "shield",
        items: [
          { label: "Ask for approval", value: "ask" },
          { label: "Bypass approvals", value: "allow" },
          { label: "Autopilot", value: "autopilot" },
        ],
        value: this.chat.composition(this.identity).approvalMode,
      }),
    );
    this._register(
      permission.onDidSelect(({ item }) =>
        this.chat.update(this.identity, {
          approvalMode:
            item.value === "allow" || item.value === "autopilot"
              ? item.value
              : "ask",
        }),
      ),
    );
    line.append(
      createElement("span", { className: "codicon codicon-folder" }),
      document.createTextNode(workspace?.name ?? this.identity.workspaceID),
      permissionHost,
      this.contextStatus(
        workspace?.agentHostState === "online"
          ? "workspace-trusted"
          : "workspace-untrusted",
        `Agent host ${workspace?.agentHostState || "offline"}`,
      ),
      ...this.workspaceSourceStatus(workspace?.parameters),
    );
    return line;
  }

  private contextStatus(icon: string, label: string): HTMLElement {
    const status = createElement("span", {
      className: "agent-session-context-status",
    });
    status.append(
      createElement("span", { className: `codicon codicon-${icon}` }),
      document.createTextNode(label),
    );
    return status;
  }

  private workspaceSourceStatus(
    parameters: Record<string, unknown> | undefined,
  ): HTMLElement[] {
    const result: HTMLElement[] = [];
    if (typeof parameters?.worktree === "string" && parameters.worktree)
      result.push(this.contextStatus("check", parameters.worktree));
    if (typeof parameters?.branch === "string" && parameters.branch)
      result.push(this.contextStatus("git-branch", parameters.branch));
    return result;
  }
}
