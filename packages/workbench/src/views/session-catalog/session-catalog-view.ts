import type { Workspace } from "@zaw/protocol";
import { ButtonWidget, Emitter, Widget, append, createElement } from "@zaw/ui";
import { sessionIdentityKey } from "../../services/active-session";

export type SessionCatalogViewOptions = {
  filter: string;
  selectedSession: string | null;
  selectedWorkspaceID: string | null;
  sessionTitles: Record<string, string>;
  sessions: Record<string, string[]>;
  workspaces: Workspace[];
};

export class SessionCatalogView extends Widget {
  private readonly _onDidSelectSession = this._register(new Emitter<string>());
  readonly onDidSelectSession = this._onDidSelectSession.event;

  constructor(
    root: HTMLElement,
    private readonly options: SessionCatalogViewOptions,
  ) {
    super(root);
    const filter = this.options.filter.toLocaleLowerCase();
    const rows = this.options.workspaces
      .filter((workspace) => (this.options.sessions[workspace.id] ?? []).length)
      .filter((workspace) =>
        workspace.name.toLocaleLowerCase().includes(filter),
      )
      .map((workspace) => this.renderWorkspace(workspace));
    this.root.replaceChildren(
      ...(rows.length
        ? rows
        : [
            createElement("p", {
              className: "empty-sidebar",
              textContent: "No sessions yet",
            }),
          ]),
    );
  }

  private renderWorkspace(workspace: Workspace) {
    const online = workspace.agentHostState === "online";
    const group = createElement("div", { className: "workspace-group" });
    const row = createElement("div", {
      className: `workspace-row ${online ? "online" : "offline"}`,
    });
    const status = createElement("span", {
      className: "codicon codicon-circle-filled",
    });
    status.setAttribute("aria-hidden", "true");
    append(row, status, createElement("span", { textContent: workspace.name }));
    group.append(row);
    for (const session of this.options.sessions[workspace.id] ?? []) {
      group.append(this.renderSession(workspace.id, session));
    }
    return group;
  }

  private renderSession(workspaceID: string, session: string) {
    const identity = { workspaceID, resource: session };
    const title =
      this.options.sessionTitles[sessionIdentityKey(identity)] ??
      session.replace("ahp-session:/", "");
    const selected =
      workspaceID === this.options.selectedWorkspaceID &&
      session === this.options.selectedSession;
    const root = createElement("span");
    const button = new ButtonWidget(root, {
      className: `session-row ${selected ? "selected" : ""}`,
      icon: "comment-discussion",
      label: `Select ${title}`,
      text: title,
      value: sessionIdentityKey(identity),
    });
    button.onDidClick(
      () => this._onDidSelectSession.fire(sessionIdentityKey(identity)),
      undefined,
      this.disposables,
    );
    return root.firstElementChild ?? root;
  }
}
