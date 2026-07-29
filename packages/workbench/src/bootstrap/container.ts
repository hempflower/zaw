import { Container } from "inversify";
import { CoreViewsContribution } from "../contrib/core/core-views.contribution";
import { CoreContextKeysContribution } from "../contrib/core/context-keys.contribution";
import { KeybindingsContribution } from "../contrib/core/keybindings.contribution";
import { LayoutActionsContribution } from "../contrib/core/layout-actions.contribution";
import { ResponsiveSidebarContribution } from "../contrib/core/responsive-sidebar.contribution";
import {
  IManagementService,
  ManagementService,
} from "../contrib/management/management-service";
import { ManagementContribution } from "../contrib/management/management.contribution";
import {
  ISessionCatalogService,
  SessionCatalogService,
} from "../contrib/sessions/session-catalog-service";
import { SessionCatalogContribution } from "../contrib/sessions/session-catalog.contribution";
import {
  ISessionService,
  SessionService,
} from "../contrib/sessions/session-service";
import {
  IAHPProjectionService,
  AHPProjectionService,
} from "../contrib/sessions/ahp-projection-service";
import { AHPProjectionContribution } from "../contrib/sessions/ahp-projection.contribution";
import {
  ITerminalService,
  TerminalService,
} from "../contrib/terminal/terminal-service";
import {
  ITerminalGroupService,
  TerminalGroupService,
} from "../contrib/terminal/terminal-group-service";
import { TerminalContribution } from "../contrib/terminal/terminal.contribution";
import {
  IWorkspaceResourceService,
  WorkspaceResourceService,
} from "../contrib/workspace/workspace-resource-service";
import {
  DetailViewService,
  IDetailViewService,
} from "../contrib/workspace/detail-view-service";
import {
  IWorkspaceService,
  WorkspaceService,
} from "../contrib/workspace/workspace-service";
import { WorkspaceContribution } from "../contrib/workspace/workspace.contribution";
import { CommandRegistry } from "../platform/commands/command-service";
import {
  ICommandRegistry,
  ICommandService,
} from "../platform/commands/commands";
import { ActionRegistry, IActionRegistry } from "../platform/actions/actions";
import { ContextKeyService } from "../platform/context-key/context-key-service";
import { IContextKeyService } from "../platform/context-key/context-key";
import { IThemeService, ThemeService } from "../platform/theme/theme-service";
import {
  INotificationService,
  NotificationService,
} from "../platform/notifications/notifications";
import { ThemeContribution } from "../contrib/core/theme.contribution";
import {
  IOverlayService,
  OverlayService,
} from "../platform/overlay/overlay-service";
import {
  ILifecycleService,
  LifecyclePhase,
} from "../platform/lifecycle/lifecycle";
import { LifecycleService } from "../platform/lifecycle/lifecycle-service";
import {
  IKeybindingRegistry,
  KeybindingRegistry,
} from "../platform/keybinding/keybindings";
import { AHPAgentHostProvider } from "../providers/ahp-agent-host-provider";
import { HTTPApiBase, HTTPClient } from "../providers/http-client";
import { HTTPManagementProvider } from "../providers/http-management-provider";
import { HTTPSessionCatalogProvider } from "../providers/http-session-catalog-provider";
import { HTTPWorkspaceProvider } from "../providers/http-workspace-provider";
import {
  ActiveSessionService,
  IActiveSessionService,
} from "../services/active-session";
import {
  IWorkbenchNavigationService,
  WorkbenchNavigationService,
} from "../services/navigation";
import { IAgentHostProvider } from "../services/agent-host";
import {
  AgentHostProviderRegistry,
  IAgentHostProviderRegistry,
} from "../services/agent-host-provider-registry";
import {
  ChatSessionService,
  IChatSessionService,
} from "../services/chat-session";
import {
  ISessionTodoService,
  SessionTodoService,
} from "../services/session-todos";
import { IManagementProvider } from "../services/management";
import { ISessionCatalogProvider } from "../services/session-catalog";
import {
  ISessionStatusRegistry,
  SessionStatusRegistry,
} from "../services/session-status";
import {
  IWorkbenchViewHost,
  WorkbenchViewHost,
} from "../services/workbench-view-host";
import {
  IWorkbenchViewContainersRegistry,
  IWorkbenchViewsRegistry,
  WorkbenchViewContainersRegistry,
  WorkbenchViewsRegistry,
} from "../services/workbench-view-registry";
import {
  IWorkspaceAttachmentService,
  WorkspaceAttachmentService,
} from "../services/workspace-attachment";
import {
  IWorkbenchStorage,
  IWorkspaceUIStateService,
  WorkspaceUIStateService,
} from "../services/workspace-ui-state";
import { IWorkspaceProvider } from "../services/workspace";
import {
  IWorkbenchContributionsRegistry,
  WorkbenchContributionsRegistry,
  type WorkbenchContributionDescriptor,
} from "../workbench/contributions/workbench-contributions";
import { IWorkbenchLayoutService } from "../workbench/layout/layout";
import { WorkbenchLayoutService } from "../workbench/layout/layout-service";
import { Workbench, WorkbenchRoot } from "./workbench";

function registerContribution(
  container: Container,
  descriptor: WorkbenchContributionDescriptor,
): void {
  container.bind(descriptor.ctor).toSelf().inSingletonScope();
  container
    .get<IWorkbenchContributionsRegistry>(IWorkbenchContributionsRegistry)
    .register(descriptor);
}

export function createWorkbenchContainer(
  root: HTMLElement,
  apiBase: string,
): Container {
  const container = new Container();
  const storage =
    typeof window === "undefined" ? undefined : window.localStorage;
  container.bind<HTMLElement>(WorkbenchRoot).toConstantValue(root);
  container.bind<string>(HTTPApiBase).toConstantValue(apiBase);
  container
    .bind<Storage | undefined>(IWorkbenchStorage)
    .toConstantValue(storage);
  container
    .bind<ILifecycleService>(ILifecycleService)
    .to(LifecycleService)
    .inSingletonScope();
  container
    .bind<IWorkbenchContributionsRegistry>(IWorkbenchContributionsRegistry)
    .to(WorkbenchContributionsRegistry)
    .inSingletonScope();
  container
    .bind<IContextKeyService>(IContextKeyService)
    .to(ContextKeyService)
    .inSingletonScope();
  container
    .bind<IThemeService>(IThemeService)
    .to(ThemeService)
    .inSingletonScope();
  container
    .bind<INotificationService>(INotificationService)
    .to(NotificationService)
    .inSingletonScope();
  container
    .bind<IOverlayService>(IOverlayService)
    .to(OverlayService)
    .inSingletonScope();
  container
    .bind<IWorkbenchLayoutService>(IWorkbenchLayoutService)
    .to(WorkbenchLayoutService)
    .inSingletonScope();
  const commands = new CommandRegistry();
  container.bind<ICommandRegistry>(ICommandRegistry).toConstantValue(commands);
  container.bind<ICommandService>(ICommandService).toConstantValue(commands);
  container
    .bind<IActionRegistry>(IActionRegistry)
    .toConstantValue(new ActionRegistry(commands));
  container
    .bind<IKeybindingRegistry>(IKeybindingRegistry)
    .toConstantValue(new KeybindingRegistry(commands));
  container
    .bind<IWorkbenchViewContainersRegistry>(IWorkbenchViewContainersRegistry)
    .toConstantValue(new WorkbenchViewContainersRegistry());
  container
    .bind<IWorkbenchViewsRegistry>(IWorkbenchViewsRegistry)
    .toConstantValue(new WorkbenchViewsRegistry());
  container
    .bind<IWorkbenchViewHost>(IWorkbenchViewHost)
    .to(WorkbenchViewHost)
    .inSingletonScope();

  container.bind(HTTPClient).toSelf().inSingletonScope();
  container
    .bind<IWorkspaceProvider>(IWorkspaceProvider)
    .to(HTTPWorkspaceProvider)
    .inSingletonScope();
  container
    .bind<IManagementProvider>(IManagementProvider)
    .to(HTTPManagementProvider)
    .inSingletonScope();
  container
    .bind<ISessionCatalogProvider>(ISessionCatalogProvider)
    .to(HTTPSessionCatalogProvider)
    .inSingletonScope();
  const agentHostProviders = new AgentHostProviderRegistry();
  container
    .bind<AgentHostProviderRegistry>(IAgentHostProviderRegistry)
    .toConstantValue(agentHostProviders);
  container
    .bind<IAgentHostProvider>(IAgentHostProvider)
    .toConstantValue(agentHostProviders);
  container.bind(AHPAgentHostProvider).toSelf().inSingletonScope();
  agentHostProviders.register({
    id: "ahp",
    order: 100,
    provider: container.get(AHPAgentHostProvider),
  });
  container
    .bind<ISessionStatusRegistry>(ISessionStatusRegistry)
    .toConstantValue(new SessionStatusRegistry());
  container
    .bind<IActiveSessionService>(IActiveSessionService)
    .to(ActiveSessionService)
    .inSingletonScope();
  container
    .bind<IWorkbenchNavigationService>(IWorkbenchNavigationService)
    .to(WorkbenchNavigationService)
    .inSingletonScope();
  container
    .bind<IWorkspaceAttachmentService>(IWorkspaceAttachmentService)
    .to(WorkspaceAttachmentService)
    .inSingletonScope();
  container
    .bind<IWorkspaceUIStateService>(IWorkspaceUIStateService)
    .to(WorkspaceUIStateService)
    .inSingletonScope();
  container
    .bind<IChatSessionService>(IChatSessionService)
    .to(ChatSessionService)
    .inSingletonScope();
  container
    .bind<ISessionTodoService>(ISessionTodoService)
    .to(SessionTodoService)
    .inSingletonScope();
  container
    .bind<IManagementService>(IManagementService)
    .to(ManagementService)
    .inSingletonScope();
  container
    .bind<ISessionCatalogService>(ISessionCatalogService)
    .to(SessionCatalogService)
    .inSingletonScope();
  container
    .bind<ISessionService>(ISessionService)
    .to(SessionService)
    .inSingletonScope();
  container
    .bind<IAHPProjectionService>(IAHPProjectionService)
    .to(AHPProjectionService)
    .inSingletonScope();
  container
    .bind<ITerminalService>(ITerminalService)
    .to(TerminalService)
    .inSingletonScope();
  container
    .bind<ITerminalGroupService>(ITerminalGroupService)
    .to(TerminalGroupService)
    .inSingletonScope();
  container
    .bind<IWorkspaceResourceService>(IWorkspaceResourceService)
    .to(WorkspaceResourceService)
    .inSingletonScope();
  container
    .bind<IDetailViewService>(IDetailViewService)
    .to(DetailViewService)
    .inSingletonScope();
  container
    .bind<IWorkspaceService>(IWorkspaceService)
    .to(WorkspaceService)
    .inSingletonScope();

  registerContribution(container, {
    id: "zaw.layoutActions",
    ctor: LayoutActionsContribution,
    phase: LifecyclePhase.Starting,
  });
  registerContribution(container, {
    id: "zaw.coreViews",
    ctor: CoreViewsContribution,
    phase: LifecyclePhase.Starting,
  });
  registerContribution(container, {
    id: "zaw.coreContextKeys",
    ctor: CoreContextKeysContribution,
    phase: LifecyclePhase.Starting,
  });
  registerContribution(container, {
    id: "zaw.keybindings",
    ctor: KeybindingsContribution,
    phase: LifecyclePhase.Starting,
  });
  registerContribution(container, {
    id: "zaw.theme",
    ctor: ThemeContribution,
    phase: LifecyclePhase.Starting,
  });
  registerContribution(container, {
    id: "zaw.sessionCatalog",
    ctor: SessionCatalogContribution,
    phase: LifecyclePhase.Ready,
  });
  registerContribution(container, {
    id: "zaw.ahpProjection",
    ctor: AHPProjectionContribution,
    phase: LifecyclePhase.Ready,
  });
  registerContribution(container, {
    id: "zaw.workspace",
    ctor: WorkspaceContribution,
    phase: LifecyclePhase.Ready,
  });
  registerContribution(container, {
    id: "zaw.terminal",
    ctor: TerminalContribution,
    phase: LifecyclePhase.Ready,
  });
  registerContribution(container, {
    id: "zaw.management",
    ctor: ManagementContribution,
    phase: LifecyclePhase.Restored,
  });
  registerContribution(container, {
    id: "zaw.responsiveSidebar",
    ctor: ResponsiveSidebarContribution,
    phase: LifecyclePhase.Restored,
  });
  container.bind(Workbench).toSelf().inSingletonScope();
  commands.setServicesAccessor(container);
  // View child containers must consume root-owned singleton instances. Eagerly
  // materialize view-facing domain services before any descriptor is mounted;
  // otherwise Inversify can create one parent binding instance per child
  // resolution context and duplicate context-key ownership.
  for (const service of [
    IActiveSessionService,
    IWorkbenchNavigationService,
    IChatSessionService,
    IManagementService,
    ISessionCatalogService,
    IDetailViewService,
    IWorkspaceResourceService,
    IWorkspaceService,
    ITerminalGroupService,
    ITerminalService,
  ]) {
    container.get(service);
  }
  container.get<WorkbenchViewHost>(IWorkbenchViewHost).setContainer(container);
  container
    .get<IWorkbenchContributionsRegistry>(IWorkbenchContributionsRegistry)
    .start(container.get(ILifecycleService), container);
  return container;
}
