import {
  Disposable,
  DisposableStore,
  IconActionButton,
  PickerAction,
  createElement,
} from "@zaw/ui";
import type { ApprovalMode, ChatAttachment } from "../../services/chat-session";
import type { IManagementService } from "../management/management-service";
import {
  isWorkspaceRunning,
  workspaceLifecycleState,
  type IWorkspaceService,
} from "../workspace/workspace-service";
import type { ICommandService } from "../../platform/commands/commands";
import type { IActionRegistry } from "../../platform/actions/actions";
import { AgentComposer, type ComposerAgent } from "./agent-composer";
import { runtimeModelID } from "./model-identity";

/** New-session specialization; active sessions reuse the same stable input core. */
export class NewSessionComposer extends AgentComposer {}

type UntitledState = {
  agent: string;
  approvalMode: ApprovalMode;
  attachments: ChatAttachment[];
  draft: string;
  model: string;
  reasoningEffort: string;
};

const emptyState = (): UntitledState => ({
  agent: "",
  approvalMode: "ask",
  attachments: [],
  draft: "",
  model: "",
  reasoningEffort: "",
});

export class NewSessionInputModel {
  private readonly states = new Map<string, UntitledState>();

  constructor(private readonly storage?: Storage) {}

  get(workspaceID?: string | null): UntitledState {
    const key = workspaceID || "global";
    const existing = this.states.get(key);
    if (existing) return existing;
    let state = emptyState();
    try {
      const stored = this.storage?.getItem(`zaw.untitled-session.${key}`);
      if (stored)
        state = { ...state, ...(JSON.parse(stored) as UntitledState) };
    } catch {
      // A memory draft remains available when persistence is unavailable.
    }
    this.states.set(key, state);
    return state;
  }

  update(
    workspaceID: string | null | undefined,
    changes: Partial<UntitledState>,
  ): void {
    const key = workspaceID || "global";
    const state = { ...this.get(workspaceID), ...changes };
    this.states.set(key, state);
    try {
      this.storage?.setItem(
        `zaw.untitled-session.${key}`,
        JSON.stringify(state),
      );
    } catch {
      // Keep the in-memory copy.
    }
  }

  clear(workspaceID?: string | null): void {
    const key = workspaceID || "global";
    this.states.delete(key);
    this.storage?.removeItem(`zaw.untitled-session.${key}`);
  }
}

export class NewSessionView extends Disposable {
  readonly element = createElement("section", {
    ariaLabel: "New session",
    className: "agent-new-session-view",
  });
  private readonly content = createElement("div", {
    className: "agent-new-session-content",
  });
  private readonly heading = createElement("div", {
    className: "agent-new-session-heading",
  });
  private readonly composer: AgentComposer;
  private readonly controls = createElement("div", {
    className: "agent-new-session-controls",
  });
  private controlsPicker: PickerAction | undefined;
  private agentPicker: PickerAction | undefined;
  private workspacePicker: PickerAction | undefined;
  private workspaceActions = new DisposableStore();
  private workspaceActionPending = false;
  private submitting = false;
  private submitError = "";

  constructor(
    private readonly workspaces: IWorkspaceService | undefined,
    private readonly management: IManagementService | undefined,
    private readonly commands: ICommandService,
    private readonly input: NewSessionInputModel,
    private readonly actions?: IActionRegistry,
    private readonly agents: () => readonly ComposerAgent[] = () => [],
  ) {
    super();
    this.composer = this._register(
      new NewSessionComposer({
        actions: this.actions,
        ariaLabel: "Describe what you want to build",
        composition: () => this.input.get(this.workspaces?.selectedWorkspaceID),
        commands: this.commands,
        disabled: () =>
          this.submitting ||
          !this.workspaces?.selectedWorkspaceID ||
          !isWorkspaceRunning(this.selectedWorkspace()) ||
          this.management?.modelsState === "error" ||
          this.management?.modelsState === "loading" ||
          (this.management?.modelsState === "ready" &&
            this.management.models.length === 0),
        models: () =>
          (this.management?.models ?? []).map((model) => ({
            ...model,
            id: runtimeModelID(model),
            vendor: (this.management?.modelProviders ?? []).find(
              (provider) => provider.id === model.providerId,
            )?.name,
          })),
        modelsState: () => this.management?.modelsState ?? "ready",
        onChange: (changes) => {
          this.input.update(this.workspaces?.selectedWorkspaceID, changes);
        },
        notification: () =>
          this.submitError
            ? { kind: "error", message: this.submitError }
            : this.management?.modelsState === "error"
              ? {
                  kind: "error",
                  message:
                    this.management.modelsError || "Unable to load models",
                }
              : undefined,
        onSubmit: () => void this.submit(),
        placeholder: () =>
          !this.workspaces?.selectedWorkspaceID
            ? "Select a workspace to start"
            : !isWorkspaceRunning(this.selectedWorkspace())
              ? "Workspace must be running to create a session"
              : this.management?.modelsState === "loading"
                ? "Loading language models"
                : this.management?.modelsState === "error"
                  ? "Language models are unavailable"
                  : this.management?.modelsState === "ready" &&
                      this.management.models.length === 0
                    ? "No language models available"
                    : "Describe what you want to build",
        working: () => this.submitting,
        workingAction: "progress",
      }),
    );
    this.content.append(this.heading, this.composer.element, this.controls);
    this.element.append(this.content);
    this._register(
      this.workspaces?.onDidChange(() => this.refresh()) ?? { dispose() {} },
    );
    this._register(
      this.management?.onDidChange(() => {
        this.composer.refreshPickers();
        this.refresh();
      }) ?? { dispose() {} },
    );
    this.refresh();
  }

  private refresh(): void {
    const workspaceID = this.workspaces?.selectedWorkspaceID;
    const workspace = this.workspaces?.workspaces.find(
      (entry) => entry.id === workspaceID,
    );
    const agents = this.agents();
    const state = this.input.get(workspaceID);
    if (!state.agent && agents[0])
      this.input.update(workspaceID, { agent: agents[0].id });
    this.heading.replaceChildren(
      createElement("span", { textContent: "New session in" }),
    );
    const pickerHost = createElement("span");
    this.workspacePicker?.dispose();
    const picker = new PickerAction(pickerHost, {
      ariaLabel: "Select workspace",
      className: "agent-workspace-picker",
      icon: "folder",
      items: [
        ...(this.workspaces?.workspaces ?? []).map((entry) => ({
          icon: "folder",
          label: entry.name,
          value: entry.id,
        })),
        {
          icon: "add",
          label: "Create New Workspace…",
          value: "__create_workspace__",
        },
      ],
      value: workspaceID ?? undefined,
    });
    picker.onDidSelect(({ item }) => {
      if (item.value === "__create_workspace__") {
        void this.commands.executeCommand("zaw.workspace.openCreate");
        return;
      }
      void this.workspaces?.select(item.value);
    });
    this.workspacePicker = picker;
    this.agentPicker?.dispose();
    const agentHost = createElement("span");
    this.agentPicker = new PickerAction(agentHost, {
      ariaLabel: "Session agent",
      className: "agent-heading-agent-picker",
      disabled: agents.length === 0,
      icon: "hubot",
      items: agents.length
        ? agents.map((item) => ({ label: item.name, value: item.id }))
        : [{ label: "No agents available", value: "" }],
      value: this.input.get(workspaceID).agent,
    });
    this.agentPicker.onDidSelect(({ item }) =>
      this.input.update(workspaceID, { agent: item.value }),
    );
    this.heading.append(
      pickerHost,
      createElement("span", { textContent: "using" }),
      agentHost,
    );
    this.element.dataset.workspace = String(Boolean(workspace));
    this.workspaceActions.dispose();
    this.workspaceActions = new DisposableStore();
    this.controlsPicker?.dispose();
    const permissionHost = createElement("span", {
      className: "agent-control-picker agent-permission-picker",
    });
    this.controlsPicker = new PickerAction(permissionHost, {
      ariaLabel: "Permission level",
      icon: "shield",
      items: [
        { label: "Ask for approval", value: "ask" },
        { label: "Bypass approvals", value: "allow" },
        { label: "Autopilot", value: "autopilot" },
      ],
      value: this.input.get(workspaceID).approvalMode,
    });
    this.controlsPicker.onDidSelect(({ item }) =>
      this.input.update(workspaceID, {
        approvalMode:
          item.value === "allow" || item.value === "autopilot"
            ? item.value
            : "ask",
      }),
    );
    const workspaceActions = createElement("span", {
      className: "agent-workspace-state-actions",
    });
    if (workspace) {
      workspaceActions.append(
        this.workspaceAction(
          "output",
          `View build logs for ${workspace.name}`,
          () => this.management?.openBuildLogs(workspace.id),
        ),
      );
      const lifecycle = this.workspaceActionPending
        ? "transitioning"
        : workspaceLifecycleState(workspace);
      if (lifecycle === "running")
        workspaceActions.append(
          this.workspaceAction(
            "debug-stop",
            `Stop ${workspace.name}`,
            () =>
              void this.runWorkspaceAction(() =>
                this.management?.stopWorkspace(workspace.id),
              ),
            "stop",
          ),
        );
      if (lifecycle === "stopped")
        workspaceActions.append(
          this.workspaceAction(
            "debug-start",
            `Start ${workspace.name}`,
            () =>
              void this.runWorkspaceAction(() =>
                this.management?.startWorkspace(workspace.id),
              ),
            "start",
          ),
        );
      if (lifecycle === "transitioning")
        workspaceActions.append(
          createElement("span", {
            ariaLabel: `Workspace ${workspace.observedState || "transitioning"}`,
            className:
              "codicon codicon-loading codicon-modifier-spin agent-workspace-transition",
          }),
        );
    }
    this.controls.replaceChildren(
      permissionHost,
      createElement("span", { className: "agent-composer-spacer" }),
      this.status(
        isWorkspaceRunning(workspace)
          ? "workspace-trusted"
          : "workspace-untrusted",
        workspace
          ? `Workspace ${workspace.observedState || workspace.desiredState}`
          : "No agent host",
      ),
      workspaceActions,
      ...this.workspaceSourceStatus(workspace?.parameters),
    );
    this.composer.refresh();
  }

  refreshAgents(): void {
    this.composer.refreshPickers();
    this.refresh();
  }

  private selectedWorkspace() {
    return this.workspaces?.workspaces.find(
      (entry) => entry.id === this.workspaces?.selectedWorkspaceID,
    );
  }

  override dispose(): void {
    this.controlsPicker?.dispose();
    this.agentPicker?.dispose();
    this.workspacePicker?.dispose();
    this.workspaceActions.dispose();
    super.dispose();
  }

  private async submit(): Promise<void> {
    const workspaceID = this.workspaces?.selectedWorkspaceID;
    if (
      !workspaceID ||
      this.submitting ||
      !isWorkspaceRunning(this.selectedWorkspace())
    )
      return;
    const state = this.input.get(workspaceID);
    this.submitting = true;
    this.submitError = "";
    this.composer.refresh();
    try {
      await this.commands.executeCommand(
        "zaw.session.create",
        "New session",
        state,
      );
      this.input.clear(workspaceID);
    } catch (error) {
      this.submitError =
        error instanceof Error ? error.message : "Unable to create session";
    } finally {
      this.submitting = false;
      this.composer.refresh();
    }
  }

  private workspaceAction(
    icon: string,
    label: string,
    run: () => void,
    kind: "neutral" | "start" | "stop" = "neutral",
  ): HTMLElement {
    const host = createElement("span", {
      className: `agent-workspace-action state-${kind}`,
    });
    const action = this.workspaceActions.add(
      new IconActionButton(host, { ariaLabel: label, icon }),
    );
    this.workspaceActions.add(action.onDidClick(run));
    return host;
  }

  private async runWorkspaceAction(
    action: () => Promise<void> | undefined,
  ): Promise<void> {
    if (this.workspaceActionPending) return;
    this.workspaceActionPending = true;
    this.submitError = "";
    this.refresh();
    try {
      await action();
      await this.workspaces?.reload();
    } catch (error) {
      this.submitError =
        error instanceof Error ? error.message : "Workspace action failed";
    } finally {
      this.workspaceActionPending = false;
      this.refresh();
    }
  }

  private status(icon: string, label: string): HTMLElement {
    const status = createElement("span", {
      className: "agent-new-session-status",
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
    const worktree = parameters?.worktree;
    const branch = parameters?.branch;
    if (typeof worktree === "string" && worktree)
      result.push(this.status("check", worktree));
    if (typeof branch === "string" && branch)
      result.push(this.status("git-branch", branch));
    return result;
  }
}
