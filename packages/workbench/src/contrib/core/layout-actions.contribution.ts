import { DisposableStore } from "@zaw/ui";
import { inject, injectable } from "inversify";
import { IActionRegistry } from "../../platform/actions/actions";
import { ICommandRegistry } from "../../platform/commands/commands";
import { ContextKeyExpr } from "../../platform/context-key/context-key";
import type { IWorkbenchContribution } from "../../workbench/contributions/workbench-contributions";
import { IWorkbenchLayoutService, Part } from "../../workbench/layout/layout";
import { PanelContext } from "../../workbench/context-keys";
import { NavigationContext } from "../../workbench/context-keys";
import { IWorkbenchNavigationService } from "../../services/navigation";

@injectable()
export class LayoutActionsContribution implements IWorkbenchContribution {
  private readonly registrations = new DisposableStore();

  constructor(
    @inject(ICommandRegistry) commands: ICommandRegistry,
    @inject(IActionRegistry) actions: IActionRegistry,
  ) {
    for (const [id, part] of [
      ["zaw.layout.toggleSidebar", Part.Sidebar],
      ["zaw.layout.toggleAuxiliaryBar", Part.AuxiliaryBar],
      ["zaw.layout.togglePanel", Part.Panel],
    ] as const) {
      this.registrations.add(
        commands.registerCommand(id, (accessor) => {
          const layout = accessor.get<IWorkbenchLayoutService>(
            IWorkbenchLayoutService,
          );
          layout.setVisible(part, !layout.isVisible(part));
        }),
      );
    }

    this.registrations.add(
      commands.registerCommand("zaw.navigation.back", (accessor) =>
        accessor
          .get<IWorkbenchNavigationService>(IWorkbenchNavigationService)
          .back(),
      ),
    );
    this.registrations.add(
      commands.registerCommand("zaw.navigation.forward", (accessor) =>
        accessor
          .get<IWorkbenchNavigationService>(IWorkbenchNavigationService)
          .forward(),
      ),
    );

    this.registrations.add(
      actions.registerAction({
        command: "zaw.navigation.back",
        group: "navigation",
        icon: "arrow-left",
        id: "zaw.action.navigation.back",
        menu: "titlebar",
        order: 0,
        precondition: ContextKeyExpr.has(NavigationContext.canGoBack.key),
        title: "Go Back",
      }),
    );
    this.registrations.add(
      actions.registerAction({
        command: "zaw.navigation.forward",
        group: "navigation",
        icon: "arrow-right",
        id: "zaw.action.navigation.forward",
        menu: "titlebar",
        order: 1,
        precondition: ContextKeyExpr.has(NavigationContext.canGoForward.key),
        title: "Go Forward",
      }),
    );
    this.registrations.add(
      actions.registerAction({
        checkedWhen: ContextKeyExpr.has(PanelContext.leftSidebarVisible.key),
        command: "zaw.layout.toggleSidebar",
        group: "left",
        icon: "layout-sidebar-left",
        id: "zaw.action.layout.toggleSidebar",
        menu: "titlebar",
        order: 10,
        title: "Toggle Agent Sessions",
      }),
    );
    this.registrations.add(
      actions.registerAction({
        checkedWhen: ContextKeyExpr.has(PanelContext.rightSidebarVisible.key),
        command: "zaw.layout.toggleAuxiliaryBar",
        group: "right",
        icon: "layout-sidebar-right",
        id: "zaw.action.layout.toggleAuxiliaryBar",
        menu: "titlebar",
        order: 0,
        title: "Toggle Details",
      }),
    );
  }

  dispose(): void {
    this.registrations.dispose();
  }
}
