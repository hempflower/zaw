import type { Workspace } from "@zaw/protocol";
import { ButtonWidget, Emitter, Widget, append, createElement } from "@zaw/ui";

export type WorkspaceConnectionState = "connected" | "offline" | "reconnecting";

export type WorkspaceSummaryOptions = {
  changeCount: number;
  connection: WorkspaceConnectionState;
  workspace?: Workspace;
};

export class WorkspaceSummaryWidget extends Widget {
  private readonly _onDidRebuildWorkspace = this._register(new Emitter<void>());
  private readonly _onDidToggleWorkspaceState = this._register(
    new Emitter<void>(),
  );
  readonly onDidRebuildWorkspace = this._onDidRebuildWorkspace.event;
  readonly onDidToggleWorkspaceState = this._onDidToggleWorkspaceState.event;

  constructor(
    root: HTMLElement,
    private readonly options: WorkspaceSummaryOptions,
  ) {
    super(root);
    const workspace = this.options.workspace;
    if (!workspace) {
      this.root.replaceChildren();
      return;
    }
    const action = workspace.desiredState === "running" ? "stop" : "start";
    const stateButton = createElement("span");
    const stateToggle = new ButtonWidget(stateButton, {
      icon: `debug-${action === "stop" ? "stop" : "start"}`,
      label: `${action === "stop" ? "Stop" : "Start"} workspace`,
    });
    stateToggle.onDidClick(
      () => this._onDidToggleWorkspaceState.fire(),
      undefined,
      this.disposables,
    );
    const rebuildButton = createElement("span");
    const rebuild = new ButtonWidget(rebuildButton, {
      icon: "refresh",
      label: "Rebuild from current template",
    });
    rebuild.onDidClick(
      () => this._onDidRebuildWorkspace.fire(),
      undefined,
      this.disposables,
    );
    const summary = createElement("div", { className: "workspace-summary" });
    const name = createElement("span");
    append(
      name,
      createElement("span", { className: "codicon codicon-repo" }),
      document.createTextNode(workspace.name),
    );
    const connection = createElement("span", {
      className: `connection-state ${this.options.connection}`,
    });
    append(
      connection,
      createElement("span", { className: "codicon codicon-circle-filled" }),
      document.createTextNode(this.options.connection),
    );
    const actions = createElement("span", {
      className: "workspace-build-actions",
    });
    append(
      actions,
      ...Array.from(stateButton.childNodes),
      ...Array.from(rebuildButton.childNodes),
    );
    append(
      summary,
      name,
      createElement("span", {
        textContent: `Git ${this.options.changeCount} changes`,
      }),
      createElement("span", { textContent: cpu(workspace) }),
      createElement("span", { textContent: memory(workspace) }),
      connection,
      actions,
    );
    this.root.replaceChildren(summary);
  }
}

function cpu(workspace: Workspace) {
  return workspace.agentHostTelemetry
    ? `CPU ${workspace.agentHostTelemetry.cpuPercent.toFixed(1)}%`
    : "CPU —";
}

function memory(workspace: Workspace) {
  return workspace.agentHostTelemetry
    ? `Mem ${(workspace.agentHostTelemetry.memoryBytes / 1024 / 1024).toFixed(
        1,
      )} MiB`
    : "Mem —";
}
