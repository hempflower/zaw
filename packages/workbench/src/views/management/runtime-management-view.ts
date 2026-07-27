import type { Workspace } from "@zaw/protocol";
import { ButtonWidget, Emitter, Widget, append, createElement } from "@zaw/ui";

export type RuntimeProvisioner = {
  capabilities: Record<string, unknown>;
  id: string;
  lastHeartbeatAt: string;
  name: string;
  status: string;
};

export type RuntimeJob = {
  attempt: number;
  buildId: string;
  claimedBy: string;
  id: string;
  status: string;
};

export type RuntimeBuild = {
  createdAt: string;
  error: string;
  id: string;
  logs: string;
  operation: string;
  provisionerId: string;
  status: string;
  workspaceId: string;
};

export type RuntimeManagementKind =
  | "agent-hosts"
  | "builds"
  | "provisioners"
  | "workspaces";

export type RuntimeManagementOptions = {
  builds: RuntimeBuild[];
  jobs: RuntimeJob[];
  kind: RuntimeManagementKind;
  provisioners: RuntimeProvisioner[];
  workspaces: Workspace[];
};

export class RuntimeManagementView extends Widget {
  private readonly _onDidRequestWorkspaceStop = this._register(
    new Emitter<string>(),
  );
  private readonly _onDidStartWorkspace = this._register(new Emitter<string>());
  readonly onDidRequestWorkspaceStop = this._onDidRequestWorkspaceStop.event;
  readonly onDidStartWorkspace = this._onDidStartWorkspace.event;

  constructor(
    root: HTMLElement,
    private readonly options: RuntimeManagementOptions,
  ) {
    super(root);
    this.root.replaceChildren(
      this.options.kind === "workspaces"
        ? this.workspaces()
        : this.options.kind === "agent-hosts"
          ? this.agentHosts()
          : this.options.kind === "provisioners"
            ? this.provisioners()
            : this.builds(),
    );
  }

  private workspaces() {
    const rows = this.options.workspaces.map((workspace) => {
      const operation = workspace.desiredState === "running" ? "stop" : "start";
      const action = createElement("span");
      const actionButton = new ButtonWidget(action, {
        label: `${operation} ${workspace.name}`,
        text: operation === "stop" ? "Stop" : "Start",
        value: workspace.id,
      });
      actionButton.onDidClick(
        () =>
          operation === "stop"
            ? this._onDidRequestWorkspaceStop.fire(workspace.id)
            : this._onDidStartWorkspace.fire(workspace.id),
        undefined,
        this.disposables,
      );
      return card(
        workspace.name,
        `${workspace.observedState} · desired ${workspace.desiredState}`,
        `Template ${workspace.templateId}\nBuild ${workspace.currentBuildId || "None"}`,
        action,
      );
    });
    return resource(
      "Workspaces",
      "Lifecycle state and pinned source ownership.",
      rows,
    );
  }

  private agentHosts() {
    const rows = this.options.workspaces.map((workspace) => {
      const telemetry = workspace.agentHostTelemetry;
      const detail = telemetry
        ? [
            `Health ${telemetry.health}`,
            `CPU ${telemetry.cpuPercent}%`,
            `Memory ${telemetry.memoryBytes}`,
          ].join("\n")
        : "No telemetry is available.";
      return card(
        workspace.name,
        workspace.agentHostState || "offline",
        detail,
      );
    });
    return resource(
      "Agent Hosts",
      "Workspace-scoped connection and telemetry.",
      rows,
    );
  }

  private provisioners() {
    const provisioners = this.options.provisioners.map((item) =>
      card(
        item.name,
        `${item.status} · ${item.lastHeartbeatAt}`,
        JSON.stringify(item.capabilities, null, 2),
      ),
    );
    const jobs = this.options.jobs.map((item) =>
      card(
        `Job ${item.id}`,
        `${item.status} · attempt ${item.attempt}`,
        `Build ${item.buildId}\nClaimed by ${item.claimedBy || "None"}`,
      ),
    );
    return resource(
      "Provisioners and Jobs",
      "Recent workers and scheduling state.",
      [...provisioners, ...jobs],
    );
  }

  private builds() {
    const rows = this.options.builds.map((build) =>
      card(
        `Build ${build.id}`,
        `${build.operation} · ${build.status}`,
        [
          `Workspace ${build.workspaceId}`,
          build.error ? `Error: ${build.error}` : "",
          build.logs || "No logs are available.",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
    return resource("Builds", "Recent build logs and failure details.", rows);
  }
}

function resource(title: string, description: string, rows: Node[]) {
  const section = createElement("section", {
    ariaLabel: title,
    className: "management-resource-view",
  });
  const header = createElement("header");
  const copy = createElement("div");
  append(
    copy,
    createElement("h2", { textContent: title }),
    createElement("p", { textContent: description }),
  );
  header.append(copy);
  const list = createElement("div", { className: "management-resource-list" });
  if (rows.length) list.append(...rows);
  else
    list.append(
      createElement("p", {
        className: "settings-empty",
        textContent: "No runtime records",
      }),
    );
  append(section, header, list);
  return section;
}

function card(title: string, status: string, detail: string, actions?: Node) {
  const article = createElement("article", {
    className: "management-resource-card",
  });
  const header = createElement("header");
  const heading = createElement("div");
  append(
    heading,
    createElement("strong", { textContent: title }),
    createElement("small", { textContent: status }),
  );
  const actionSlot = createElement("span");
  if (actions) actionSlot.append(actions);
  append(header, heading, actionSlot);
  append(article, header, createElement("pre", { textContent: detail }));
  return article;
}
