import { Disposable } from "@zaw/ui";
import { inject, injectable, optional } from "inversify";
import { ICommandService } from "../../platform/commands/commands";
import { IActionRegistry } from "../../platform/actions/actions";
import { IActiveSessionService } from "../../services/active-session";
import { IChatSessionService } from "../../services/chat-session";
import { ISessionTodoService } from "../../services/session-todos";
import {
  ViewRoot,
  type IWorkbenchView,
} from "../../services/workbench-view-registry";
import { sessionIdentityKey } from "../../services/active-session";
import { IWorkbenchStorage } from "../../services/workspace-ui-state";
import { IWorkspaceAttachmentService } from "../../services/workspace-attachment";
import { IManagementService } from "../management/management-service";
import { IWorkspaceService } from "../workspace/workspace-service";
import { ActiveSessionView } from "./active-session-view";
import { NewSessionInputModel, NewSessionView } from "./new-session-view";
import { ISessionCatalogService } from "./session-catalog-service";

@injectable()
export class SessionPane extends Disposable implements IWorkbenchView {
  readonly id = "zaw.sessions.primary";
  private readonly input: NewSessionInputModel;
  private readonly activeViews = new Map<string, ActiveSessionView>();
  private newView: NewSessionView | undefined;

  constructor(
    @inject(ViewRoot) private readonly root: HTMLElement,
    @inject(IActiveSessionService)
    private readonly active: IActiveSessionService,
    @inject(ISessionCatalogService)
    private readonly catalog: ISessionCatalogService,
    @inject(IChatSessionService) private readonly chat: IChatSessionService,
    @inject(ICommandService) private readonly commands: ICommandService,
    @optional()
    @inject(IWorkspaceService)
    private readonly workspaces?: IWorkspaceService,
    @optional()
    @inject(IManagementService)
    private readonly management?: IManagementService,
    @optional() @inject(IWorkbenchStorage) storage?: Storage,
    @optional()
    @inject(IActionRegistry)
    private readonly actions?: IActionRegistry,
    @optional()
    @inject(IWorkspaceAttachmentService)
    private readonly attachments?: IWorkspaceAttachmentService,
    @optional()
    @inject(ISessionTodoService)
    private readonly todos?: ISessionTodoService,
  ) {
    super();
    this.input = new NewSessionInputModel(storage);
    this._register(this.active.onDidChange(() => this.showCurrent()));
    if (this.attachments)
      this._register({
        dispose: this.attachments.onAction((_workspaceID, envelope) => {
          if (envelope.action.type !== "root/agentsChanged") return;
          this.newView?.refreshAgents();
          for (const view of this.activeViews.values()) view.refreshAgents();
        }),
      });
    this.showCurrent();
  }

  override dispose(): void {
    this.newView?.dispose();
    for (const view of this.activeViews.values()) view.dispose();
    this.activeViews.clear();
    super.dispose();
  }

  private showCurrent(): void {
    const selected = this.active.current();
    for (const view of this.activeViews.values()) view.setVisible(false);
    if (this.newView) this.newView.element.hidden = true;
    if (selected) {
      const key = sessionIdentityKey(selected);
      let view = this.activeViews.get(key);
      if (!view) {
        view = new ActiveSessionView(
          selected,
          this.catalog,
          this.chat,
          this.commands,
          this.actions,
          this.workspaces,
          this.management,
          () =>
            this.attachments?.attached(selected.workspaceID)?.listAgents() ??
            [],
          this.todos,
        );
        this.activeViews.set(key, view);
        this.root.append(view.element);
      }
      view.setVisible(true);
    } else {
      if (!this.newView) {
        this.newView = new NewSessionView(
          this.workspaces,
          this.management,
          this.commands,
          this.input,
          this.actions,
          () => this.attachments?.attached()?.listAgents() ?? [],
        );
        this.root.append(this.newView.element);
      }
      this.newView.element.hidden = false;
    }
  }
}
