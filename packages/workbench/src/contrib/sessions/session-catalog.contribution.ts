import { DisposableStore } from "@zaw/ui";
import { inject, injectable } from "inversify";
import type { IWorkbenchContribution } from "../../workbench/contributions/workbench-contributions";
import {
  IWorkbenchViewContainersRegistry,
  IWorkbenchViewsRegistry,
  type IWorkbenchViewContainersRegistry as ContainersRegistry,
  type IWorkbenchViewsRegistry as ViewsRegistry,
} from "../../services/workbench-view-registry";
import { ISessionCatalogService } from "./session-catalog-service";
import { SessionPane } from "./session-pane";
import { SessionCatalogPane } from "./session-catalog-view";
import { ICommandRegistry } from "../../platform/commands/commands";
import { IActionRegistry } from "../../platform/actions/actions";
import { registerSessionCommands } from "./session.commands";
import { ISessionStatusRegistry } from "../../services/session-status";

/**
 * Starts the session catalog polling when the workbench reaches Ready phase.
 * The catalog service owns its own timer and state; this contribution only
 * calls start/stop.
 */
@injectable()
export class SessionCatalogContribution implements IWorkbenchContribution {
  private readonly registrations = new DisposableStore();
  constructor(
    @inject(ISessionCatalogService)
    private readonly catalogService: ISessionCatalogService,
    @inject(IWorkbenchViewContainersRegistry) containers: ContainersRegistry,
    @inject(IWorkbenchViewsRegistry) views: ViewsRegistry,
    @inject(ICommandRegistry) commands: ICommandRegistry,
    @inject(IActionRegistry) actions: IActionRegistry,
    @inject(ISessionStatusRegistry) statuses: ISessionStatusRegistry,
  ) {
    this.catalogService.start();
    for (const descriptor of [
      {
        icon: "bell-dot",
        id: "session.needsInput",
        label: "Needs input",
        matches: (item: { status?: number } | undefined) =>
          item?.status !== undefined && (item.status & 24) === 24,
        order: 10,
        state: "input-needed",
      },
      {
        icon: "loading",
        id: "session.inProgress",
        label: "In progress",
        matches: (item: { status?: number } | undefined) =>
          item?.status !== undefined && (item.status & 8) === 8,
        order: 20,
        state: "in-progress",
      },
      {
        icon: "error",
        id: "session.error",
        label: "Failed",
        matches: (item: { status?: number } | undefined) =>
          item?.status !== undefined && (item.status & 2) === 2,
        order: 30,
        state: "error",
      },
      {
        icon: "circle-outline",
        id: "session.idle",
        label: "Idle",
        matches: () => true,
        order: 1000,
        state: "idle",
      },
    ])
      this.registrations.add(statuses.register(descriptor));
    for (const registration of registerSessionCommands(commands))
      this.registrations.add(registration);
    this.registrations.add(
      actions.registerAction({
        id: "zaw.action.session.create",
        command: "zaw.session.new",
        icon: "add",
        menu: "view-title",
        title: "New session",
      }),
    );
    for (const descriptor of [
      {
        command: "zaw.session.filter",
        icon: "search",
        id: "zaw.action.session.filter",
        menu: "view-title" as const,
        order: 10,
        title: "Filter Chats",
      },
      {
        command: "zaw.session.togglePinned",
        icon: "pin",
        id: "zaw.action.session.togglePinned",
        menu: "context" as const,
        order: 10,
        title: "Toggle Pin",
      },
      {
        command: "zaw.session.markRead",
        icon: "circle-outline",
        id: "zaw.action.session.markRead",
        menu: "context" as const,
        order: 20,
        title: "Toggle Read",
      },
      {
        command: "zaw.session.toggleArchived",
        icon: "archive",
        id: "zaw.action.session.toggleArchived",
        menu: "context" as const,
        order: 30,
        title: "Toggle Archive",
      },
    ])
      this.registrations.add(actions.registerAction(descriptor));
    for (const descriptor of [
      {
        command: "zaw.composer.attach",
        icon: "add",
        id: "zaw.action.composer.attach",
        menu: "chat-input" as const,
        order: 10,
        title: "Attach files",
      },
      {
        command: "zaw.composer.selectMode",
        icon: "tools",
        id: "zaw.action.composer.mode",
        menu: "chat-input" as const,
        order: 15,
        title: "Agent mode",
      },
      {
        command: "zaw.composer.selectModel",
        icon: "sparkle",
        id: "zaw.action.composer.model",
        menu: "chat-input" as const,
        order: 20,
        title: "Language model",
      },
      {
        command: "zaw.composer.selectReasoningEffort",
        icon: "settings",
        id: "zaw.action.composer.reasoningEffort",
        menu: "chat-input" as const,
        order: 30,
        title: "Reasoning effort",
      },
      {
        command: "zaw.composer.submit",
        icon: "arrow-up",
        id: "zaw.action.composer.submit",
        menu: "chat-input" as const,
        order: 100,
        title: "Send",
      },
    ])
      this.registrations.add(actions.registerAction(descriptor));
    const sidebar = containers.get("core.sidebar");
    const primary = containers.get("core.primary");
    if (sidebar)
      this.registrations.add(
        views.registerViews(
          [
            {
              id: "zaw.sessions.catalog",
              name: "Sessions",
              ctor: SessionCatalogPane,
            },
          ],
          sidebar,
        ),
      );
    if (primary)
      this.registrations.add(
        views.registerViews(
          [{ id: "zaw.sessions.primary", name: "Session", ctor: SessionPane }],
          primary,
        ),
      );
  }

  dispose(): void {
    this.catalogService.stop();
    this.registrations.dispose();
  }
}
