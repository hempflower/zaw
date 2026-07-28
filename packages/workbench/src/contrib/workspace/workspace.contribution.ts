import { inject, injectable } from "inversify";
import type { IWorkbenchContribution } from "../../workbench/contributions/workbench-contributions";
import { IWorkspaceService } from "./workspace-service";
import { DisposableStore } from "@zaw/ui";
import {
  IWorkbenchViewContainersRegistry,
  IWorkbenchViewsRegistry,
  type IWorkbenchViewContainersRegistry as ContainersRegistry,
  type IWorkbenchViewsRegistry as ViewsRegistry,
} from "../../services/workbench-view-registry";
import { WorkspaceDetailsPane } from "./workspace-view";
import { ChangesPane, FilesPane } from "./workspace-explorer-view";
import { ICommandRegistry } from "../../platform/commands/commands";
import { IActionRegistry } from "../../platform/actions/actions";
import { IWorkspaceResourceService } from "./workspace-resource-service";
import { IDetailViewService } from "./detail-view-service";
import { INotificationService } from "../../platform/notifications/notifications";
import { registerChangesCommands } from "./changes.commands";
import { registerFilesCommands } from "./files.commands";
import { ContextKeyExpr } from "../../platform/context-key/context-key";
import { WorkspaceContext } from "../../workbench/context-keys";

@injectable()
export class WorkspaceContribution implements IWorkbenchContribution {
  private readonly registrations = new DisposableStore();
  constructor(
    @inject(IWorkspaceService) service: IWorkspaceService,
    @inject(IWorkbenchViewContainersRegistry) containers: ContainersRegistry,
    @inject(IWorkbenchViewsRegistry) views: ViewsRegistry,
    @inject(ICommandRegistry) commands: ICommandRegistry,
    @inject(IActionRegistry) actions: IActionRegistry,
    @inject(INotificationService) notifications: INotificationService,
  ) {
    for (const registration of [
      ...registerChangesCommands(commands),
      ...registerFilesCommands(commands),
    ])
      this.registrations.add(registration);
    this.registrations.add(
      actions.registerAction({
        id: "zaw.action.workspace.refresh",
        command: "zaw.workspace.refresh",
        icon: "refresh",
        menu: "view-title",
        title: "Refresh",
      }),
    );
    this.registrations.add(
      actions.registerAction({
        id: "zaw.action.workspace.closeActiveView",
        command: "zaw.workspace.closeActiveView",
        icon: "close",
        menu: "view-title",
        order: 100,
        title: "Close View",
      }),
    );
    this.registrations.add(
      actions.registerAction({
        id: "zaw.action.workspace.showChanges",
        command: "zaw.workspace.showChanges",
        icon: "diff",
        menu: "view-title",
        title: "Changes",
      }),
    );
    this.registrations.add(
      actions.registerAction({
        id: "zaw.action.workspace.showFiles",
        command: "zaw.workspace.showFiles",
        icon: "files",
        menu: "view-title",
        title: "Files",
      }),
    );
    void service.reload().catch((error) => notifications.error(error));
    const auxiliary = containers.get("core.auxiliary");
    if (auxiliary)
      this.registrations.add(
        views.registerViews(
          [
            {
              id: "zaw.workspace.changes",
              name: "Changes",
              ctor: ChangesPane,
              retainWhenHidden: true,
              when: ContextKeyExpr.and(
                ContextKeyExpr.has(WorkspaceContext.active.key),
                ContextKeyExpr.has(WorkspaceContext.changesVisible.key),
              ),
            },
            {
              id: "zaw.workspace.files",
              name: "Files",
              ctor: FilesPane,
              retainWhenHidden: true,
              when: ContextKeyExpr.and(
                ContextKeyExpr.has(WorkspaceContext.active.key),
                ContextKeyExpr.has(WorkspaceContext.filesVisible.key),
              ),
            },
            {
              id: "zaw.workspace.preview",
              name: "Preview",
              ctor: WorkspaceDetailsPane,
              retainWhenHidden: true,
              when: ContextKeyExpr.and(
                ContextKeyExpr.has(WorkspaceContext.active.key),
                ContextKeyExpr.has(WorkspaceContext.previewVisible.key),
              ),
            },
          ],
          auxiliary,
        ),
      );
  }
  dispose(): void {
    this.registrations.dispose();
  }
}
