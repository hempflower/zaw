import { Toolbar, Widget, createElement } from "@zaw/ui";
import { inject, injectable, optional } from "inversify";
import type { IWorkbenchView } from "../../services/workbench-view-registry";
import { ViewRoot } from "../../services/workbench-view-registry";
import {
  IActionRegistry,
  type ActionDescriptor,
} from "../../platform/actions/actions";
import { ICommandService } from "../../platform/commands/commands";
import { IContextKeyService } from "../../platform/context-key/context-key";
import {
  IActiveSessionService,
  sessionIdentityKey,
} from "../../services/active-session";
import { ISessionCatalogService } from "../../contrib/sessions/session-catalog-service";
import { IWorkspaceService } from "../../contrib/workspace/workspace-service";

@injectable()
export class TitlebarView extends Widget implements IWorkbenchView {
  readonly id = "workbench.view.titlebar";
  private readonly left = createElement("div", {
    className: "agent-titlebar-left",
  });
  private readonly centerNavigation = createElement("div", {
    className: "agent-titlebar-center-navigation",
  });
  private readonly centerActions = createElement("div", {
    className: "agent-titlebar-center-actions",
  });
  private readonly right = createElement("div", {
    className: "agent-titlebar-right",
  });
  private readonly title = createElement("div", {
    className: "agent-window-session",
  });
  private toolbarWidgets: Toolbar[] = [];

  constructor(
    @inject(ViewRoot) root: HTMLElement,
    @inject(IActionRegistry) private readonly actions: IActionRegistry,
    @inject(ICommandService) private readonly commands: ICommandService,
    @inject(IContextKeyService) private readonly context: IContextKeyService,
    @optional()
    @inject(IActiveSessionService)
    private readonly active?: IActiveSessionService,
    @optional()
    @inject(ISessionCatalogService)
    private readonly catalog?: ISessionCatalogService,
    @optional()
    @inject(IWorkspaceService)
    private readonly workspaces?: IWorkspaceService,
  ) {
    super(root);
    const titlebar = createElement("header", { className: "zaw-titlebar" });
    const center = createElement("div", {
      className: "agent-titlebar-center",
    });
    center.append(this.centerNavigation, this.title, this.centerActions);
    titlebar.append(this.left, center, this.right);
    root.replaceChildren(titlebar);
    this._register(this.actions.onDidChange(() => this.renderActions()));
    this._register(
      this.context.onDidChangeContext(() => this.syncActionState()),
    );
    if (this.active)
      this._register(this.active.onDidChange(() => this.updateTitle()));
    if (this.catalog)
      this._register(this.catalog.onDidChange(() => this.updateTitle()));
    if (this.workspaces)
      this._register(this.workspaces.onDidChange(() => this.updateTitle()));
    this.renderActions();
    this.updateTitle();
  }

  override dispose(): void {
    this.disposeToolbars();
    super.dispose();
  }

  private renderActions(): void {
    this.disposeToolbars();
    this.left.replaceChildren();
    this.centerNavigation.replaceChildren();
    this.centerActions.replaceChildren();
    this.right.replaceChildren();
    const descriptors = this.actions.actions("titlebar");
    for (const [group, host, label] of [
      ["left", this.left, "Window navigation"],
      ["navigation", this.centerNavigation, "History navigation"],
      ["center", this.centerActions, "Session actions"],
      ["right", this.right, "Window actions"],
    ] as const) {
      const groupActions = descriptors.filter(
        (action) => (action.group ?? "right") === group,
      );
      if (!groupActions.length) continue;
      const toolbar = new Toolbar(host, {
        actions: groupActions.map((action) => this.toToolbarAction(action)),
        ariaLabel: label,
        className: `agent-titlebar-${group}-toolbar`,
      });
      toolbar.onDidRun(({ id }) => {
        const action = groupActions.find((candidate) => candidate.id === id);
        if (action) void this.commands.executeCommand(action.command);
      });
      this.toolbarWidgets.push(toolbar);
    }
  }

  private syncActionState(): void {
    const descriptors = new Map(
      this.actions.actions("titlebar").map((action) => [action.id, action]),
    );
    for (const toolbar of this.toolbarWidgets) {
      for (const [id, descriptor] of descriptors) {
        const action = toolbar.action(id);
        if (!action) continue;
        action.setChecked(
          descriptor.checkedWhen
            ? this.context.evaluate(descriptor.checkedWhen)
            : false,
        );
        action.setDisabled(
          descriptor.precondition
            ? !this.context.evaluate(descriptor.precondition)
            : false,
        );
      }
    }
  }

  private toToolbarAction(action: ActionDescriptor) {
    return {
      ariaLabel: action.title,
      checked: action.checkedWhen
        ? this.context.evaluate(action.checkedWhen)
        : false,
      disabled: action.precondition
        ? !this.context.evaluate(action.precondition)
        : false,
      icon: action.icon,
      id: action.id,
      kind: "icon" as const,
      title: action.title,
    };
  }

  private updateTitle(): void {
    const active = this.active?.current();
    const workspaceID =
      active?.workspaceID ?? this.workspaces?.selectedWorkspaceID;
    const workspace = this.workspaces?.workspaces.find(
      (candidate) => candidate.id === workspaceID,
    );
    const sessionTitle = active
      ? (this.catalog?.sessionTitles[sessionIdentityKey(active)] ?? "Session")
      : "New Session";
    this.title.replaceChildren(
      createElement("span", {
        className: "codicon codicon-comment-discussion",
      }),
      createElement("span", {
        className: "agent-window-session-label",
        textContent: workspace?.name
          ? `${sessionTitle} · ${workspace.name}`
          : sessionTitle,
      }),
    );
  }

  private disposeToolbars(): void {
    for (const toolbar of this.toolbarWidgets) toolbar.dispose();
    this.toolbarWidgets = [];
  }
}
