import { DisposableStore } from "@zaw/ui";
import { inject, injectable } from "inversify";
import { IActionRegistry } from "../../platform/actions/actions";
import { ICommandRegistry } from "../../platform/commands/commands";
import { IKeybindingRegistry } from "../../platform/keybinding/keybindings";
import {
  IWorkbenchViewContainersRegistry,
  IWorkbenchViewsRegistry,
  type IWorkbenchViewContainersRegistry as ContainersRegistry,
  type IWorkbenchViewsRegistry as ViewsRegistry,
} from "../../services/workbench-view-registry";
import type { IWorkbenchContribution } from "../../workbench/contributions/workbench-contributions";
import { TerminalPane } from "./terminal-view";
import { registerTerminalCommands } from "./terminal.commands";
import { ContextKeyExpr } from "../../platform/context-key/context-key";
import { TerminalContext } from "../../workbench/context-keys";

@injectable()
export class TerminalContribution implements IWorkbenchContribution {
  private readonly registrations = new DisposableStore();
  constructor(
    @inject(IWorkbenchViewContainersRegistry) containers: ContainersRegistry,
    @inject(IWorkbenchViewsRegistry) views: ViewsRegistry,
    @inject(ICommandRegistry) commands: ICommandRegistry,
    @inject(IActionRegistry) actions: IActionRegistry,
    @inject(IKeybindingRegistry) keybindings: IKeybindingRegistry,
  ) {
    for (const registration of registerTerminalCommands(commands))
      this.registrations.add(registration);
    this.registrations.add(
      actions.registerAction({
        checkedWhen: ContextKeyExpr.has(TerminalContext.open.key),
        command: "zaw.terminal.toggle",
        group: "right",
        icon: "terminal",
        id: "zaw.action.terminal.toggle",
        menu: "titlebar",
        order: 0,
        title: "Toggle Terminal",
      }),
    );
    this.registrations.add(
      actions.registerAction({
        id: "zaw.action.terminal.create",
        command: "zaw.terminal.create",
        icon: "terminal",
        menu: "view-title",
        title: "New terminal",
      }),
    );
    this.registrations.add(
      keybindings.registerKeybinding({
        key: "Ctrl+`",
        command: "zaw.terminal.toggle",
      }),
    );
    const panel = containers.get("core.panel");
    if (panel)
      this.registrations.add(
        views.registerViews(
          [{ id: "zaw.terminal.panel", name: "Terminal", ctor: TerminalPane }],
          panel,
        ),
      );
  }
  dispose(): void {
    this.registrations.dispose();
  }
}
