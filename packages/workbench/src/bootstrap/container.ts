import { Container } from "inversify";
import { AHPAgentHostProvider } from "../providers/ahp-agent-host-provider";
import { HTTPApiBase, HTTPClient } from "../providers/http-client";
import { HTTPManagementProvider } from "../providers/http-management-provider";
import { HTTPSessionCatalogProvider } from "../providers/http-session-catalog-provider";
import { HTTPWorkspaceProvider } from "../providers/http-workspace-provider";
import {
  ActiveSessionService,
  IActiveSessionService,
} from "../services/active-session";
import { IAgentHostProvider } from "../services/agent-host";
import {
  AHPActionContributionRegistry,
  IAHPActionContributionRegistry,
} from "../services/ahp-action-contribution-registry";
import { registerBuiltinAHPActionContributions } from "../services/ahp-action.contribution";
import {
  ChatSessionService,
  IChatSessionService,
} from "../services/chat-session";
import {
  FloatingWindowService,
  IFloatingWindowService,
} from "../services/floating-window";
import { IManagementProvider } from "../services/management";
import {
  IManagementViewRegistry,
  ManagementViewRegistry,
} from "../services/management-view-registry";
import { ISessionCatalogProvider } from "../services/session-catalog";
import {
  IWorkbenchViewHost,
  WorkbenchViewHost,
} from "../services/workbench-view-host";
import type { WorkbenchViewContext } from "../services/workbench-view-context";
import {
  IWorkbenchViewContainersRegistry,
  IWorkbenchViewsRegistry,
  WorkbenchViewContainersRegistry,
  WorkbenchViewsRegistry,
} from "../services/workbench-view-registry";
import { IWorkspaceProvider } from "../services/workspace";
import {
  IWorkspaceAttachmentService,
  WorkspaceAttachmentService,
} from "../services/workspace-attachment";
import {
  IWorkbenchStorage,
  IWorkspaceUIStateService,
  WorkspaceUIStateService,
} from "../services/workspace-ui-state";
import {
  DetailTabRendererRegistry,
  IDetailTabRendererRegistry,
} from "../views/session-details/detail-tab-renderer-registry";
import { registerBuiltinDetailTabRenderers } from "../views/session-details/detail-tab.contribution";
import {
  IManagementSheetContributionRegistry,
  ManagementSheetContributionRegistry,
} from "../views/management-sheet/management-sheet-contribution-registry";
import { registerBuiltinManagementSheetContributions } from "../views/management-sheet/management-sheet.contribution";
import { registerBuiltinManagementViews } from "../views/management/management.contribution";
import {
  ISessionEventRendererRegistry,
  SessionEventRendererRegistry,
} from "../views/session/session-event-renderer-registry";
import { registerBuiltinSessionEventRenderers } from "../views/session/session-event.contribution";
import { registerBuiltinWorkbenchViews } from "../views/workbench/workbench.contribution";
import { Workbench, WorkbenchRoot } from "./workbench";

export function createWorkbenchContainer(root: HTMLElement, apiBase: string) {
  const container = new Container();
  const storage =
    typeof window === "undefined" ? undefined : window.localStorage;
  const workbenchViewContainers = new WorkbenchViewContainersRegistry();
  const workbenchViews = new WorkbenchViewsRegistry<WorkbenchViewContext>();
  registerBuiltinWorkbenchViews(workbenchViewContainers, workbenchViews);

  container.bind<HTMLElement>(WorkbenchRoot).toConstantValue(root);
  container.bind<string>(HTTPApiBase).toConstantValue(apiBase);
  container
    .bind<Storage | undefined>(IWorkbenchStorage)
    .toConstantValue(storage);
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
    .bind<IAgentHostProvider>(IAgentHostProvider)
    .to(AHPAgentHostProvider)
    .inSingletonScope();
  container
    .bind<IActiveSessionService>(IActiveSessionService)
    .to(ActiveSessionService)
    .inSingletonScope();
  container
    .bind<IWorkspaceAttachmentService>(IWorkspaceAttachmentService)
    .to(WorkspaceAttachmentService)
    .inSingletonScope();
  container
    .bind<ISessionCatalogProvider>(ISessionCatalogProvider)
    .to(HTTPSessionCatalogProvider)
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
    .bind<IFloatingWindowService>(IFloatingWindowService)
    .to(FloatingWindowService)
    .inSingletonScope();
  container
    .bind<IManagementViewRegistry>(IManagementViewRegistry)
    .toDynamicValue(() => {
      const registry = new ManagementViewRegistry();
      registerBuiltinManagementViews(registry);
      return registry;
    })
    .inSingletonScope();
  container
    .bind<IManagementSheetContributionRegistry>(
      IManagementSheetContributionRegistry,
    )
    .toDynamicValue(() => {
      const registry = new ManagementSheetContributionRegistry();
      registerBuiltinManagementSheetContributions(registry);
      return registry;
    })
    .inSingletonScope();
  container
    .bind<IAHPActionContributionRegistry>(IAHPActionContributionRegistry)
    .toDynamicValue(() => {
      const registry = new AHPActionContributionRegistry();
      registerBuiltinAHPActionContributions(registry);
      return registry;
    })
    .inSingletonScope();
  container
    .bind<ISessionEventRendererRegistry>(ISessionEventRendererRegistry)
    .toDynamicValue(() => {
      const registry = new SessionEventRendererRegistry();
      registerBuiltinSessionEventRenderers(registry);
      return registry;
    })
    .inSingletonScope();
  container
    .bind<IDetailTabRendererRegistry>(IDetailTabRendererRegistry)
    .toDynamicValue(() => {
      const registry = new DetailTabRendererRegistry();
      registerBuiltinDetailTabRenderers(registry);
      return registry;
    })
    .inSingletonScope();
  container
    .bind<IWorkbenchViewContainersRegistry>(IWorkbenchViewContainersRegistry)
    .toConstantValue(workbenchViewContainers);
  container
    .bind<
      IWorkbenchViewsRegistry<WorkbenchViewContext>
    >(IWorkbenchViewsRegistry)
    .toConstantValue(workbenchViews);
  container
    .bind<WorkbenchViewHost<WorkbenchViewContext>>(IWorkbenchViewHost)
    .to(WorkbenchViewHost<WorkbenchViewContext>)
    .inSingletonScope();
  container.bind(Workbench).toSelf().inSingletonScope();

  return container;
}
