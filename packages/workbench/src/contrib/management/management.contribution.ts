import { DisposableStore } from "@zaw/ui";
import { inject, injectable } from "inversify";
import { IActionRegistry } from "../../platform/actions/actions";
import { ICommandRegistry } from "../../platform/commands/commands";
import { IKeybindingRegistry } from "../../platform/keybinding/keybindings";
import { ManagementContext } from "../../workbench/context-keys";
import { ContextKeyExpr } from "../../platform/context-key/context-key";
import {
  IWorkbenchViewContainersRegistry,
  IWorkbenchViewsRegistry,
  type IWorkbenchViewContainersRegistry as ContainersRegistry,
  type IWorkbenchViewsRegistry as ViewsRegistry,
} from "../../services/workbench-view-registry";
import type { IWorkbenchContribution } from "../../workbench/contributions/workbench-contributions";
import { ManagementPane } from "./management-view";
import { registerManagementCommands } from "./management.commands";
import { IManagementService } from "./management-service";
import { INotificationService } from "../../platform/notifications/notifications";

@injectable()
export class ManagementContribution implements IWorkbenchContribution {
  private readonly registrations = new DisposableStore();
  constructor(
    @inject(IWorkbenchViewContainersRegistry) containers: ContainersRegistry,
    @inject(IWorkbenchViewsRegistry) views: ViewsRegistry,
    @inject(ICommandRegistry) commands: ICommandRegistry,
    @inject(IActionRegistry) actions: IActionRegistry,
    @inject(IKeybindingRegistry) keybindings: IKeybindingRegistry,
    @inject(IManagementService) management: IManagementService,
    @inject(INotificationService) notifications: INotificationService,
  ) {
    void management.reload().catch((error) => notifications.error(error));
    for (const registration of registerManagementCommands(commands))
      this.registrations.add(registration);
    this.registrations.add(
      actions.registerAction({
        id: "zaw.action.openSettings",
        command: "zaw.openSettings",
        group: "right",
        icon: "settings-gear",
        menu: "titlebar",
        order: 10,
        title: "Settings",
      }),
    );
    this.registrations.add(
      keybindings.registerKeybinding({
        key: "Ctrl+,",
        command: "zaw.openSettings",
      }),
    );
    const overlay = containers.get("core.overlay");
    if (overlay)
      this.registrations.add(
        views.registerViews(
          [
            {
              id: "zaw.management",
              name: "Management",
              ctor: ManagementPane,
              when: ContextKeyExpr.has(ManagementContext.open.key),
            },
          ],
          overlay,
        ),
      );
  }
  dispose(): void {
    this.registrations.dispose();
  }
}
