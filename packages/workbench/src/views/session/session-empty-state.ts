import type { Workspace } from "@zaw/protocol";
import {
  ButtonWidget,
  DropdownPanelWidget,
  DropdownWidget,
  Emitter,
  SelectWidget,
  TextAreaWidget,
  Widget,
  append,
  createElement,
} from "@zaw/ui";

export class SessionEmptyStateView extends Widget {
  private readonly _onDidChangeDraft = this._register(new Emitter<string>());
  private readonly _onDidChangeModel = this._register(new Emitter<string>());
  private readonly _onDidChooseWorkspace = this._register(
    new Emitter<string>(),
  );
  private readonly _onDidCreateSession = this._register(new Emitter<void>());
  private readonly _onDidOpenWorkspaceCreate = this._register(
    new Emitter<void>(),
  );
  readonly onDidChangeDraft = this._onDidChangeDraft.event;
  readonly onDidChangeModel = this._onDidChangeModel.event;
  readonly onDidChooseWorkspace = this._onDidChooseWorkspace.event;
  readonly onDidCreateSession = this._onDidCreateSession.event;
  readonly onDidOpenWorkspaceCreate = this._onDidOpenWorkspaceCreate.event;

  constructor(
    root: HTMLElement,
    private readonly options:
      | { workspaceName: string }
      | {
          draft: string;
          models: Array<{ id: string; name: string }>;
          selectedModelID: string;
          selectedWorkspaceID: string;
          workspaces: Workspace[];
        },
  ) {
    super(root);
    const emptyStateOptions = this.options;
    if ("workspaceName" in emptyStateOptions) {
      const state = createElement("div", { className: "session-empty-state" });
      append(
        state,
        createElement("span", { className: "codicon codicon-sparkle" }),
        createElement("h1", { textContent: "Ready to work" }),
        createElement("p", {
          textContent: `Ask the agent to work in ${emptyStateOptions.workspaceName}.`,
        }),
      );
      this.root.replaceChildren(state);
      return;
    }
    const composerOptions = emptyStateOptions;
    const available = composerOptions.workspaces;
    const selectedWorkspaceID = available.some(
      (workspace) => workspace.id === composerOptions.selectedWorkspaceID,
    )
      ? composerOptions.selectedWorkspaceID
      : available[0]?.id;
    const selectedWorkspace = available.find(
      (workspace) => workspace.id === selectedWorkspaceID,
    );
    const workspacePanel = createElement("div");
    const workspaceMenu = new DropdownPanelWidget(workspacePanel, {
      className: "new-session-workspace-menu",
      emptyText: "No workspaces yet",
      sections: [
        {
          items: [
            {
              className: "new-session-workspace-create",
              icon: "add",
              label: "New Workspace",
            },
          ],
        },
        {
          items: available.map((item) => ({
            className: "new-session-workspace-item",
            label: `${item.name}${item.agentHostState === "online" ? "" : " · Offline"}`,
            selected: item.id === selectedWorkspaceID,
            value: item.id,
          })),
        },
      ],
    });
    workspaceMenu.onDidSelect(
      ({ item }) => {
        if (item.className === "new-session-workspace-create") {
          this._onDidOpenWorkspaceCreate.fire();
        } else if (item.value) {
          this._onDidChooseWorkspace.fire(item.value);
        }
      },
      undefined,
      this.disposables,
    );
    const trigger = createElement("span");
    append(
      trigger,
      createElement("span", { className: "codicon codicon-folder" }),
      createElement("span", {
        textContent: selectedWorkspace?.name ?? "Select workspace",
      }),
    );
    const workspace = createElement("div");
    new DropdownWidget(workspace, {
      ariaLabel: "Choose workspace for new session",
      className: "new-session-workspace-picker",
      panel: workspacePanel.firstElementChild ?? workspacePanel,
      trigger,
      variant: "borderless",
    });
    const agent = createElement("div");
    new SelectWidget(agent, {
      ariaLabel: "Agent for new session",
      className: "new-session-agent-picker",
      options: [{ label: "Copilot", value: "copilot" }],
      value: "copilot",
      variant: "borderless",
    });
    const prompt = createElement("div");
    const promptInput = new TextAreaWidget(prompt, {
      ariaLabel: "Start a new session",
      className: "new-session-input",
      placeholder: "What do you want to build?",
      rows: 3,
      value: composerOptions.draft,
    });
    promptInput.onDidInput(
      ({ value }) => this._onDidChangeDraft.fire(value),
      undefined,
      this.disposables,
    );
    const model = createElement("div");
    const modelSelect = new SelectWidget(model, {
      ariaLabel: "Model for new session",
      className: "new-session-model-picker",
      options: [
        { label: "Server default", value: "" },
        ...composerOptions.models.map((item) => ({
          label: item.name,
          value: item.id,
        })),
      ],
      value: composerOptions.selectedModelID,
      variant: "borderless",
    });
    modelSelect.onDidSelect(
      ({ value }) => this._onDidChangeModel.fire(value),
      undefined,
      this.disposables,
    );
    const sourceRef =
      selectedWorkspace?.sourceSnapshot.ref ??
      selectedWorkspace?.sourceSnapshot.commit;
    const state = createElement("div", { className: "new-session-state" });
    const context = createElement("div", { className: "new-session-context" });
    const agentLabel = createElement("label");
    append(
      agentLabel,
      createElement("span", { className: "codicon codicon-hubot" }),
      ...Array.from(agent.childNodes),
    );
    append(
      context,
      createElement("span", { textContent: "New session in" }),
      ...Array.from(workspace.childNodes),
      createElement("span", { textContent: "with" }),
      agentLabel,
    );
    const composer = createElement("div", {
      className: "new-session-composer",
    });
    const toolbar = createElement("div", { className: "new-session-toolbar" });
    const disabledAttach = createElement("span");
    new ButtonWidget(disabledAttach, {
      disabled: true,
      icon: "add",
      label: "Attach context after creating the session",
    });
    const modelLabel = createElement("label", {
      className: "new-session-model",
    });
    append(
      modelLabel,
      createElement("span", { className: "codicon codicon-hubot" }),
      ...Array.from(model.childNodes),
    );
    const create = createElement("span");
    const createButton = new ButtonWidget(create, {
      disabled:
        !selectedWorkspace || selectedWorkspace.agentHostState !== "online",
      icon: "send",
      label:
        selectedWorkspace?.agentHostState === "online"
          ? "Create session"
          : "Workspace is offline",
      variant: "primary",
    });
    createButton.onDidClick(
      () => this._onDidCreateSession.fire(),
      undefined,
      this.disposables,
    );
    const toolLabel = createElement("span", {
      className: "new-session-tool-label",
    });
    append(
      toolLabel,
      createElement("span", { className: "codicon codicon-attach" }),
      document.createTextNode("Agent"),
    );
    append(
      toolbar,
      ...Array.from(disabledAttach.childNodes),
      toolLabel,
      modelLabel,
      createElement("span", { className: "new-session-spacer" }),
      ...Array.from(create.childNodes),
    );
    append(composer, ...Array.from(prompt.childNodes), toolbar);
    const status = createElement("div", { className: "new-session-statusbar" });
    const statusItem = (icon: string, text: string) => {
      const item = createElement("span");
      append(
        item,
        createElement("span", { className: `codicon codicon-${icon}` }),
        document.createTextNode(text),
      );
      return item;
    };
    append(
      status,
      statusItem("comment-discussion", "Interactive"),
      statusItem("shield", "Ask for approval"),
      createElement("span", { className: "new-session-spacer" }),
      statusItem(
        "workspace-trusted",
        selectedWorkspace?.name ?? "No workspace",
      ),
      sourceRef ? statusItem("git-branch", sourceRef) : null,
    );
    append(state, context, composer, status);
    this.root.replaceChildren(state);
  }
}
