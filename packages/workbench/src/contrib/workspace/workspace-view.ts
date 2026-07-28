import { Disposable, createElement } from "@zaw/ui";
import { inject, injectable } from "inversify";
import { ICommandService } from "../../platform/commands/commands";
import { IActionRegistry } from "../../platform/actions/actions";
import { IContextKeyService } from "../../platform/context-key/context-key";
import {
  ViewRoot,
  type IWorkbenchView,
} from "../../services/workbench-view-registry";
import { IDetailViewService, type DetailTab } from "./detail-view-service";
import { WorkspaceTitleToolbar } from "./workspace-title-toolbar";

/** Preview View hosted by the independent Auxiliary Bar View Container. */
@injectable()
export class WorkspaceDetailsPane extends Disposable implements IWorkbenchView {
  readonly id = "zaw.workspace.preview";
  private readonly tab = createElement("div", {
    className: "agent-auxiliary-tab",
  });
  private readonly title = createElement("span", {
    className: "agent-preview-tab-label",
  });
  private readonly body = createElement("div", {
    className: "agent-preview-body",
  });
  private readonly content = createElement("pre", {
    className: "agent-preview-content",
  });

  constructor(
    @inject(ViewRoot) root: HTMLElement,
    @inject(IDetailViewService) private readonly details: IDetailViewService,
    @inject(ICommandService) private readonly commands: ICommandService,
    @inject(IActionRegistry) actions: IActionRegistry,
    @inject(IContextKeyService) context: IContextKeyService,
  ) {
    super();
    const pane = createElement("section", {
      ariaLabel: "Workspace preview",
      className: "agent-auxiliary-pane agent-preview-pane",
    });
    const header = createElement("header", {
      className: "agent-auxiliary-header",
    });
    this.tab.append(
      createElement("span", { className: "codicon codicon-file" }),
      this.title,
    );
    const tabClose = this._register(
      new WorkspaceTitleToolbar(undefined, actions, commands, context, "close"),
    );
    this.tab.append(tabClose.element);
    const titleActions = this._register(
      new WorkspaceTitleToolbar(undefined, actions, commands, context),
    );
    header.append(this.tab, titleActions.element);
    this.body.append(this.content);
    pane.append(header, this.body);
    root.replaceChildren(pane);
    this._register(this.details.onDidChange(() => this.update()));
    this.update();
  }

  private update(): void {
    const active = this.activePreview();
    this.title.textContent = active?.title ?? "Preview";
    this.content.textContent = active?.content ?? "";
  }

  private activePreview(): DetailTab | undefined {
    return this.details.tabs.find(
      (tab) => tab.id === this.details.activeTabID && tab.kind === "preview",
    );
  }
}
