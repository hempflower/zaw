import { describe, expect, it } from "vitest";
import { AHPAgentHostProvider } from "../providers/ahp-agent-host-provider";
import { HTTPManagementProvider } from "../providers/http-management-provider";
import { HTTPWorkspaceProvider } from "../providers/http-workspace-provider";
import { IActiveSessionService } from "../services/active-session";
import { IAgentHostProvider } from "../services/agent-host";
import { IAHPActionContributionRegistry } from "../services/ahp-action-contribution-registry";
import { IFloatingWindowService } from "../services/floating-window";
import { IManagementProvider } from "../services/management";
import { IManagementViewRegistry } from "../services/management-view-registry";
import { ISessionCatalogProvider } from "../services/session-catalog";
import {
  IWorkbenchViewHost,
  WorkbenchViewHost,
} from "../services/workbench-view-host";
import type { WorkbenchViewContext } from "../services/workbench-view-context";
import {
  IWorkbenchViewContainersRegistry,
  IWorkbenchViewsRegistry,
} from "../services/workbench-view-registry";
import { IWorkspaceProvider } from "../services/workspace";
import { IWorkspaceAttachmentService } from "../services/workspace-attachment";
import { IWorkspaceUIStateService } from "../services/workspace-ui-state";
import { IDetailTabRendererRegistry } from "../views/session-details/detail-tab-renderer-registry";
import { IManagementSheetContributionRegistry } from "../views/management-sheet/management-sheet-contribution-registry";
import { ISessionEventRendererRegistry } from "../views/session/session-event-renderer-registry";
import { builtinWorkbenchViewIDs } from "../views/workbench/workbench.contribution";
import { createWorkbenchContainer } from "./container";
import { Workbench, WorkbenchRoot } from "./workbench";

describe("Workbench dependency injection", () => {
  it("resolves the workbench and singleton capabilities", () => {
    const root = {} as HTMLElement;
    const container = createWorkbenchContainer(root, "/api/v1");
    expect(container.get(WorkbenchRoot)).toBe(root);
    expect(container.get(IWorkspaceProvider)).toBeInstanceOf(
      HTTPWorkspaceProvider,
    );
    expect(container.get(IManagementProvider)).toBeInstanceOf(
      HTTPManagementProvider,
    );
    expect(container.get(IAgentHostProvider)).toBeInstanceOf(
      AHPAgentHostProvider,
    );
    expect(container.get(IActiveSessionService)).toBe(
      container.get(IActiveSessionService),
    );
    expect(container.get(IWorkspaceAttachmentService)).toBeDefined();
    expect(container.get(ISessionCatalogProvider)).toBeDefined();
    expect(container.get(IFloatingWindowService)).toBeDefined();
    expect(container.get(IWorkspaceUIStateService)).toBeDefined();

    const managementViews = container.get<IManagementViewRegistry>(
      IManagementViewRegistry,
    );
    const managementSheets =
      container.get<IManagementSheetContributionRegistry>(
        IManagementSheetContributionRegistry,
      );
    const ahpActions = container.get<IAHPActionContributionRegistry>(
      IAHPActionContributionRegistry,
    );
    const sessionEventRenderers = container.get<ISessionEventRendererRegistry>(
      ISessionEventRendererRegistry,
    );
    const detailTabRenderers = container.get<IDetailTabRendererRegistry>(
      IDetailTabRendererRegistry,
    );
    expect(managementViews.all().length).toBeGreaterThan(0);
    expect(managementSheets.all().length).toBeGreaterThan(0);
    expect(ahpActions.all().length).toBeGreaterThan(0);
    expect(sessionEventRenderers.all().length).toBeGreaterThan(0);
    expect(detailTabRenderers.all().length).toBeGreaterThan(0);

    const viewContainers = container.get<IWorkbenchViewContainersRegistry>(
      IWorkbenchViewContainersRegistry,
    );
    const views = container.get<IWorkbenchViewsRegistry<WorkbenchViewContext>>(
      IWorkbenchViewsRegistry,
    );
    expect(viewContainers.all.length).toBeGreaterThan(0);
    expect(views.getView(builtinWorkbenchViewIDs.session)).toBeDefined();
    expect(container.get(IWorkbenchViewHost)).toBeInstanceOf(WorkbenchViewHost);
    expect(container.get(Workbench)).toBeInstanceOf(Workbench);
    expect(container.get(Workbench)).toBe(container.get(Workbench));
  });
});
