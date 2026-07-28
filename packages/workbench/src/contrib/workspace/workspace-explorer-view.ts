import {
  Disposable,
  IconActionButton,
  VirtualList,
  createElement,
} from "@zaw/ui";
import { inject, injectable } from "inversify";
import { ICommandService } from "../../platform/commands/commands";
import { IActionRegistry } from "../../platform/actions/actions";
import { IContextKeyService } from "../../platform/context-key/context-key";
import {
  ViewRoot,
  type IWorkbenchView,
} from "../../services/workbench-view-registry";
import {
  IWorkspaceResourceService,
  type WorkspaceChange,
  type WorkspaceFile,
} from "./workspace-resource-service";
import { IWorkspaceService } from "./workspace-service";
import { WorkspaceTitleToolbar } from "./workspace-title-toolbar";

type FileRow = WorkspaceFile & { depth: number };

function glyphForFile(file: WorkspaceFile): string {
  if (file.type === "directory") return "folder";
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (["md", "txt"].includes(extension ?? "")) return "markdown";
  if (["json", "yaml", "yml"].includes(extension ?? "")) return "json";
  return "file";
}

@injectable()
export class FilesPane extends Disposable implements IWorkbenchView {
  readonly id = "zaw.workspace.files";
  private readonly pane = createElement("section", {
    ariaLabel: "Files",
    className: "agent-auxiliary-pane agent-files-pane",
  });
  private readonly rootRow = createElement("div", {
    className: "agent-files-root",
  });
  private readonly rootTwisty = createElement("span", {
    className: "codicon codicon-chevron-down",
  });
  private readonly rootIcon = createElement("span", {
    className: "codicon codicon-folder-opened",
  });
  private readonly rootLabel = createElement("strong");
  private readonly listHost = createElement("div", {
    className: "agent-files-tree",
  });
  private readonly empty = createElement("p", {
    className: "agent-files-empty",
  });
  private readonly expanded = new Set<string>();
  private readonly loading = new Set<string>();
  private readonly list: VirtualList<FileRow>;
  private selectedURI = "";

  constructor(
    @inject(ViewRoot) root: HTMLElement,
    @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
    @inject(IWorkspaceResourceService)
    private readonly resources: IWorkspaceResourceService,
    @inject(ICommandService) private readonly commands: ICommandService,
    @inject(IActionRegistry) actions: IActionRegistry,
    @inject(IContextKeyService) context: IContextKeyService,
  ) {
    super();
    const header = createElement("header", {
      className: "agent-auxiliary-header",
    });
    const tab = createElement("div", {
      className: "agent-auxiliary-tab",
    });
    tab.append(
      createElement("span", { className: "codicon codicon-files" }),
      document.createTextNode("Files"),
    );
    const tabClose = this._register(
      new WorkspaceTitleToolbar(undefined, actions, commands, context, "close"),
    );
    tab.append(tabClose.element);
    const titleActions = this._register(
      new WorkspaceTitleToolbar(
        "zaw.workspace.showFiles",
        actions,
        commands,
        context,
      ),
    );
    header.append(tab, titleActions.element);
    this.list = this._register(
      new VirtualList(
        this.listHost,
        {
          getHeight: () =>
            typeof navigator !== "undefined" &&
            /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
              ? 44
              : 22,
          getKey: (row) => row.uri,
          render: () => this.createFileRow(),
          update: (element, row) => this.updateFileRow(element, row),
        },
        {
          ariaLabel: "Workspace files",
          itemRole: "treeitem",
          role: "tree",
        },
      ),
    );
    this.rootRow.append(this.rootTwisty, this.rootIcon, this.rootLabel);
    this.empty.setAttribute("aria-live", "polite");
    this.empty.setAttribute("role", "status");
    this.pane.append(header, this.rootRow, this.listHost, this.empty);
    root.replaceChildren(this.pane);
    this._register(this.workspace.onDidChange(() => this.update()));
    this._register(this.resources.onDidChange(() => this.update()));
    this.update();
  }

  private update(): void {
    const workspaceID = this.workspace.selectedWorkspaceID;
    const workspaceName = this.workspace.workspaces.find(
      (entry) => entry.id === workspaceID,
    )?.name;
    this.rootLabel.textContent = workspaceName ?? "No workspace attached";
    const rows = workspaceID ? this.projectRows(workspaceID) : [];
    const state = workspaceID
      ? (this.resources.workspaceStates[workspaceID] ?? "idle")
      : "idle";
    this.list.setItems(rows);
    this.listHost.hidden = rows.length === 0;
    this.empty.hidden = rows.length !== 0;
    this.empty.textContent = !workspaceID
      ? "Select a workspace to browse its files"
      : state === "loading"
        ? "Loading workspace resources…"
        : state === "error"
          ? this.resources.workspaceErrors[workspaceID] ||
            "Unable to load workspace resources"
          : "No files loaded yet";
  }

  private projectRows(workspaceID: string): FileRow[] {
    const children = this.resources.fileChildren[workspaceID] ?? {};
    const result: FileRow[] = [];
    const visit = (entries: readonly WorkspaceFile[], depth: number) => {
      for (const file of entries) {
        result.push({ ...file, depth });
        if (file.type === "directory" && this.expanded.has(file.uri))
          visit(children[file.uri] ?? [], depth + 1);
      }
    };
    visit(children[""] ?? this.resources.files[workspaceID] ?? [], 0);
    return result;
  }

  private createFileRow(): HTMLElement {
    const button = createElement("button", { className: "agent-file-row" });
    button.type = "button";
    button.append(
      createElement("span", { className: "agent-file-twisty" }),
      createElement("span", { className: "agent-file-icon" }),
      createElement("span", { className: "agent-file-name" }),
    );
    button.addEventListener("click", () => {
      const uri = button.dataset.uri;
      const type = button.dataset.type;
      if (!uri) return;
      this.selectedURI = uri;
      if (type === "directory") {
        if (!this.expanded.delete(uri)) {
          this.expanded.add(uri);
          this.loading.add(uri);
          void this.commands
            .executeCommand("zaw.workspace.openDirectory", uri)
            .finally(() => {
              this.loading.delete(uri);
              this.update();
            });
        }
        this.update();
      } else void this.commands.executeCommand("zaw.workspace.openFile", uri);
    });
    return button;
  }

  private updateFileRow(element: HTMLElement, row: FileRow): void {
    const button = element as HTMLButtonElement;
    button.dataset.uri = row.uri;
    button.dataset.type = row.type;
    button.dataset.selected = String(row.uri === this.selectedURI);
    button.style.setProperty("--agent-file-depth", String(row.depth));
    const expanded = row.type === "directory" && this.expanded.has(row.uri);
    const loading = this.loading.has(row.uri);
    button.dataset.loading = String(loading);
    const twisty = button.querySelector<HTMLElement>(".agent-file-twisty")!;
    twisty.className = `agent-file-twisty${
      loading
        ? " codicon codicon-loading"
        : row.type === "directory"
          ? ` codicon codicon-chevron-${expanded ? "down" : "right"}`
          : ""
    }`;
    const fileIcon = button.querySelector<HTMLElement>(".agent-file-icon")!;
    fileIcon.className = `agent-file-icon codicon codicon-${
      expanded ? "folder-opened" : glyphForFile(row)
    }`;
    button.querySelector<HTMLElement>(".agent-file-name")!.textContent =
      row.name;
    button.setAttribute("aria-label", row.name);
    button.setAttribute("aria-level", String(row.depth + 1));
    if (row.type === "directory")
      button.setAttribute("aria-expanded", String(expanded));
    else button.removeAttribute("aria-expanded");
  }
}

@injectable()
export class ChangesPane extends Disposable implements IWorkbenchView {
  readonly id = "zaw.workspace.changes";
  private readonly body = createElement("div", {
    className: "agent-changes-list",
  });
  private readonly empty = createElement("p", {
    className: "agent-files-empty",
  });
  private readonly rowActions = new Map<HTMLElement, Disposable[]>();
  private selectedPath = "";

  constructor(
    @inject(ViewRoot) root: HTMLElement,
    @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
    @inject(IWorkspaceResourceService)
    private readonly resources: IWorkspaceResourceService,
    @inject(ICommandService) private readonly commands: ICommandService,
    @inject(IActionRegistry) actions: IActionRegistry,
    @inject(IContextKeyService) context: IContextKeyService,
  ) {
    super();
    const pane = createElement("section", {
      ariaLabel: "Changes",
      className: "agent-auxiliary-pane agent-changes-pane",
    });
    const header = createElement("header", {
      className: "agent-auxiliary-header",
    });
    const tab = createElement("div", { className: "agent-auxiliary-tab" });
    tab.append(
      createElement("span", { className: "codicon codicon-diff" }),
      document.createTextNode("Changes"),
    );
    const tabClose = this._register(
      new WorkspaceTitleToolbar(undefined, actions, commands, context, "close"),
    );
    tab.append(tabClose.element);
    const titleActions = this._register(
      new WorkspaceTitleToolbar(
        "zaw.workspace.showChanges",
        actions,
        commands,
        context,
      ),
    );
    header.append(tab, titleActions.element);
    this.empty.setAttribute("aria-live", "polite");
    this.empty.setAttribute("role", "status");
    pane.append(header, this.body, this.empty);
    root.replaceChildren(pane);
    this._register(this.workspace.onDidChange(() => this.update()));
    this._register(this.resources.onDidChange(() => this.update()));
    this.update();
  }

  private update(): void {
    const workspaceID = this.workspace.selectedWorkspaceID;
    const changes = workspaceID
      ? (this.resources.changes[workspaceID] ?? [])
      : [];
    const existing = new Map(
      Array.from(this.body.children).map((element) => [
        (element as HTMLElement).dataset.path,
        element as HTMLElement,
      ]),
    );
    const rows = changes.map((change) => {
      const row = existing.get(change.path) ?? this.createChangeRow();
      existing.delete(change.path);
      this.updateChangeRow(row, change);
      return row;
    });
    for (const stale of existing.values()) this.disposeRow(stale);
    let cursor = this.body.firstElementChild;
    for (const row of rows) {
      if (row !== cursor) this.body.insertBefore(row, cursor);
      cursor = row.nextElementSibling;
    }
    this.empty.hidden = rows.length !== 0;
    const state = workspaceID
      ? (this.resources.workspaceStates[workspaceID] ?? "idle")
      : "idle";
    this.empty.textContent = !workspaceID
      ? "No workspace attached"
      : state === "loading"
        ? "Loading workspace resources…"
        : state === "error"
          ? this.resources.workspaceErrors[workspaceID] ||
            "Unable to load workspace resources"
          : "No changes";
  }

  private createChangeRow(): HTMLElement {
    const row = createElement("div", { className: "agent-change-row" });
    const open = createElement("button", { className: "agent-change-open" });
    open.append(
      createElement("span", { className: "agent-change-path" }),
      createElement("span", { className: "agent-change-status" }),
      createElement("span", { className: "agent-change-diff" }),
    );
    open.addEventListener("click", () => {
      this.selectedPath = row.dataset.path ?? "";
      this.update();
      void this.commands.executeCommand(
        "zaw.workspace.openChange",
        row.dataset.path,
      );
    });
    const actions = createElement("div", { className: "agent-change-actions" });
    const disposables: Disposable[] = [];
    for (const [icon, label, command] of [
      ["add", "Stage Change", "zaw.workspace.stageChange"],
      ["check", "Toggle Reviewed", "zaw.workspace.reviewChange"],
      ["discard", "Revert Change", "zaw.workspace.requestRevert"],
    ] as const) {
      const host = createElement("span");
      const action = new IconActionButton(host, { ariaLabel: label, icon });
      action.onDidClick(
        () => void this.commands.executeCommand(command, row.dataset.path),
      );
      disposables.push(action);
      actions.append(host);
    }
    this.rowActions.set(row, disposables);
    row.append(open, actions);
    return row;
  }

  private updateChangeRow(row: HTMLElement, change: WorkspaceChange): void {
    row.dataset.path = change.path;
    row.dataset.selected = String(change.path === this.selectedPath);
    const open = row.firstElementChild as HTMLButtonElement;
    open.querySelector<HTMLElement>(".agent-change-path")!.textContent =
      change.path;
    open.querySelector<HTMLElement>(".agent-change-status")!.textContent =
      change.status;
    const { additions, deletions } = diffCounts(change.diff);
    open.querySelector<HTMLElement>(".agent-change-diff")!.textContent =
      additions || deletions ? `+${additions} −${deletions}` : "";
    const review = row.querySelector<HTMLButtonElement>(
      '.agent-change-actions [aria-label="Toggle Reviewed"]',
    );
    review?.setAttribute("aria-pressed", String(change.reviewed));
  }

  private disposeRow(row: HTMLElement): void {
    for (const action of this.rowActions.get(row) ?? []) action.dispose();
    this.rowActions.delete(row);
    row.remove();
  }

  override dispose(): void {
    for (const row of this.rowActions.keys()) this.disposeRow(row);
    super.dispose();
  }
}

function diffCounts(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}
