import { DisposableStore, createElement, type IDisposable } from "@zaw/ui";
import { BottomPanelPart } from "../../parts/bottom-panel/bottom-panel-part";
import { LeftSidebarPart } from "../../parts/left-sidebar/left-sidebar-part";
import { PrimaryAreaPart } from "../../parts/primary-area/primary-area-part";
import { SecondarySidebarPart } from "../../parts/secondary-sidebar/secondary-sidebar-part";
import { TitlebarPart } from "../../parts/titlebar/titlebar-part";
import type { WorkbenchViewContext } from "../../services/workbench-view-context";
import type {
  IWorkbenchViewContainersRegistry,
  IWorkbenchViewsRegistry,
  WorkbenchViewContainer,
  WorkbenchViewDescriptor,
} from "../../services/workbench-view-registry";
import {
  FloatingWindowWidget,
  OverlayLayerWidget,
} from "../../widgets/floating-window";
import { MobileDrawerBackdropWidget } from "../../widgets/mobile-drawer";
import { ToastWidget } from "../../widgets/toast";
import { WorkspaceSummaryWidget } from "../../widgets/workspace-summary";
import { ManagementSheetView } from "../management-sheet/management-sheet-view";
import { ManagementSurfaceWidget } from "../management/management-surface";
import { ChatComposerWidget } from "../session/chat-composer";
import { SessionEmptyStateView } from "../session/session-empty-state";
import { SessionEventView } from "../session/session-event-view";
import { SessionCatalogView } from "../session-catalog/session-catalog-view";

export const builtinWorkbenchViewContainers = {
  auxiliary: container(
    "workbench.container.auxiliary",
    "auxiliarybar",
    "Details",
  ),
  overlay: container("workbench.container.overlay", "overlay", "Overlays"),
  panel: container("workbench.container.panel", "panel", "Panel"),
  primary: container("workbench.container.primary", "primary", "Primary"),
  sidebar: container("workbench.container.sidebar", "sidebar", "Sessions"),
  titlebar: container("workbench.container.titlebar", "titlebar", "Title Bar"),
} as const;

export const builtinWorkbenchViewIDs = {
  details: "workbench.view.details",
  drawer: "workbench.view.mobileDrawer",
  management: "workbench.view.management",
  session: "workbench.view.session",
  sessions: "workbench.view.sessions",
  sheet: "workbench.view.managementSheet",
  terminal: "workbench.view.terminal",
  titlebar: "workbench.view.titlebar",
  toast: "workbench.view.toast",
} as const;

export function registerBuiltinWorkbenchViews(
  containers: IWorkbenchViewContainersRegistry,
  views: IWorkbenchViewsRegistry<WorkbenchViewContext>,
): IDisposable {
  const registrations = new DisposableStore();
  for (const viewContainer of Object.values(builtinWorkbenchViewContainers)) {
    registrations.add(containers.registerViewContainer(viewContainer));
  }
  register(views, registrations, builtinWorkbenchViewContainers.titlebar, [
    descriptor(builtinWorkbenchViewIDs.titlebar, "Title Bar", renderTitlebar),
  ]);
  register(views, registrations, builtinWorkbenchViewContainers.sidebar, [
    descriptor(builtinWorkbenchViewIDs.sessions, "Sessions", renderSessions),
  ]);
  register(views, registrations, builtinWorkbenchViewContainers.primary, [
    descriptor(builtinWorkbenchViewIDs.session, "Session", renderSession),
  ]);
  register(views, registrations, builtinWorkbenchViewContainers.auxiliary, [
    descriptor(builtinWorkbenchViewIDs.details, "Details", renderDetails),
  ]);
  register(views, registrations, builtinWorkbenchViewContainers.panel, [
    descriptor(
      builtinWorkbenchViewIDs.terminal,
      "Terminal",
      renderTerminal,
      (context) => context.terminalOpen,
    ),
  ]);
  register(views, registrations, builtinWorkbenchViewContainers.overlay, [
    descriptor(
      builtinWorkbenchViewIDs.drawer,
      "Mobile Drawer",
      renderDrawer,
      (context) => context.mobilePanel !== null,
      10,
    ),
    descriptor(
      builtinWorkbenchViewIDs.management,
      "Management",
      renderManagement,
      (context) => context.floatingWindow?.id === "management",
      20,
    ),
    descriptor(
      builtinWorkbenchViewIDs.sheet,
      "Management Sheet",
      renderSheet,
      (context) => context.sheet !== null,
      30,
    ),
    descriptor(
      builtinWorkbenchViewIDs.toast,
      "Notification",
      renderToast,
      (context) => Boolean(context.toast),
      40,
    ),
  ]);
  return registrations;
}

function renderTitlebar(root: HTMLElement, context: WorkbenchViewContext) {
  const widget = new TitlebarPart(root, {
    leftSidebarVisible: context.leftPanelVisible,
    secondarySidebarVisible: context.rightPanelVisible,
  });
  widget.onDidOpenSettings(() => context.emitAction({ kind: "openSettings" }));
  widget.onDidToggleLeftPanel(() =>
    context.emitAction({ kind: "toggleLeftPanel" }),
  );
  widget.onDidToggleRightPanel(() =>
    context.emitAction({ kind: "toggleRightPanel" }),
  );
  return widget;
}

function renderSessions(root: HTMLElement, context: WorkbenchViewContext) {
  const disposables = new DisposableStore();
  const catalog = child(disposables, (catalogRoot) => {
    const widget = new SessionCatalogView(catalogRoot, {
      filter: context.workspaceFilter,
      selectedSession: context.selectedSession,
      selectedWorkspaceID: context.selectedWorkspaceID,
      sessionTitles: context.sessionTitles,
      sessions: context.sessions,
      workspaces: context.workspaces,
    });
    widget.onDidSelectSession((value) =>
      context.emitAction({ kind: "selectSession", value }),
    );
    return widget;
  });
  const widget = new LeftSidebarPart(root, {
    content: catalog,
    mobileOpen: context.mobilePanel === "workspaces",
  });
  widget.onDidClosePanel(() =>
    context.emitAction({ kind: "closeMobilePanel" }),
  );
  widget.onDidOpenSettings(() => context.emitAction({ kind: "openSettings" }));
  widget.onDidStartNewSession(() =>
    context.emitAction({ kind: "startNewSession" }),
  );
  disposables.add(widget);
  return disposables;
}

function renderSession(root: HTMLElement, context: WorkbenchViewContext) {
  const disposables = new DisposableStore();
  const summary = child(disposables, (childRoot) => {
    const widget = new WorkspaceSummaryWidget(childRoot, {
      changeCount: context.changes.length,
      connection: context.connection,
      workspace: context.workspace,
    });
    widget.onDidRebuildWorkspace(() =>
      context.emitAction({ kind: "rebuildWorkspace" }),
    );
    widget.onDidToggleWorkspaceState(() =>
      context.emitAction({ kind: "toggleWorkspaceState" }),
    );
    return widget;
  });
  const messageNodes = context.messages.map((message) =>
    child(disposables, (childRoot) => {
      const widget = new SessionEventView(
        childRoot,
        message,
        context.sessionEventRendererRegistry,
      );
      widget.onDidConfirmToolCall(({ value, approved }) =>
        context.emitAction({ kind: "confirmToolCall", value, approved }),
      );
      return widget;
    }),
  );
  const emptyState = messageNodes.length
    ? document.createTextNode("")
    : child(disposables, (childRoot) => {
        const widget = new SessionEmptyStateView(
          childRoot,
          context.selectedSession && context.workspace
            ? { workspaceName: context.workspace.name }
            : {
                draft: context.newSessionDraft,
                models: context.models,
                selectedModelID: context.newSessionModelID,
                selectedWorkspaceID: context.newSessionWorkspaceID,
                workspaces: context.workspaces,
              },
        );
        widget.onDidChangeDraft((value) =>
          context.emitAction({ kind: "updateNewSessionDraft", value }),
        );
        widget.onDidChangeModel((value) =>
          context.emitAction({ kind: "chooseNewSessionModel", value }),
        );
        widget.onDidChooseWorkspace((value) =>
          context.emitAction({ kind: "chooseNewSessionWorkspace", value }),
        );
        widget.onDidCreateSession(() =>
          context.emitAction({ kind: "createSession" }),
        );
        widget.onDidOpenWorkspaceCreate(() =>
          context.emitAction({ kind: "openWorkspaceCreate" }),
        );
        return widget;
      });
  const composer = child(disposables, (childRoot) => {
    const widget = new ChatComposerWidget(childRoot, {
      activeTurn: context.activeTurn,
      composition: context.chatComposition,
      enabled: context.workspaceOnline && context.selectedSession !== null,
      models: context.models,
    });
    widget.onDidCancelTurn(() => context.emitAction({ kind: "cancelTurn" }));
    widget.onDidChangeAgent((value) =>
      context.emitAction({ kind: "changeAgent", value }),
    );
    widget.onDidChangeApprovalMode((value) =>
      context.emitAction({ kind: "changeApprovalMode", value }),
    );
    widget.onDidChangeDraft((value) =>
      context.emitAction({ kind: "changeDraft", value }),
    );
    widget.onDidChangeModel((value) =>
      context.emitAction({ kind: "changeModel", value }),
    );
    widget.onDidChooseAttachments((files) =>
      context.emitAction({ kind: "addChatAttachments", files }),
    );
    widget.onDidRemoveAttachment((index) =>
      context.emitAction({ kind: "removeChatAttachment", index }),
    );
    widget.onDidSendMessage(() => context.emitAction({ kind: "sendMessage" }));
    return widget;
  });
  const widget = new PrimaryAreaPart(root, {
    composer,
    emptyState,
    messages: messageNodes,
    sessionSelected: context.selectedSession !== null,
    selectedSessionTitle: context.selectedSessionTitle,
    summary,
    terminalOpen: context.terminalOpen,
    terminalPart: null,
    workspaceID: context.selectedWorkspaceID ?? "",
    workspaceOnline: context.workspaceOnline,
  });
  widget.onDidCreateNewSession(() =>
    context.emitAction({ kind: "startNewSession" }),
  );
  widget.onDidToggleTerminal(() =>
    context.emitAction({ kind: "toggleTerminal" }),
  );
  disposables.add(widget);
  return disposables;
}

function renderDetails(root: HTMLElement, context: WorkbenchViewContext) {
  const widget = new SecondarySidebarPart(
    root,
    {
      activeTab: context.activeDetailTab,
      activeTabID: context.activeDetailTabID,
      changes: context.changes,
      files: context.files,
      mobileOpen: context.mobilePanel === "details",
      tabs: context.detailTabs,
      workspace: context.workspace,
    },
    context.detailTabRendererRegistry,
  );
  widget.onDidClosePanel(() =>
    context.emitAction({ kind: "closeMobilePanel" }),
  );
  widget.onDidCloseTab((value) =>
    context.emitAction({ kind: "closeDetailTab", value }),
  );
  widget.onDidOpenChange((value) =>
    context.emitAction({ kind: "openChange", value }),
  );
  widget.onDidOpenDirectory((value) =>
    context.emitAction({ kind: "openDirectory", value }),
  );
  widget.onDidOpenFile((value) =>
    context.emitAction({ kind: "openFile", value }),
  );
  widget.onDidOpenFilesTab(() => context.emitAction({ kind: "openFilesTab" }));
  widget.onDidRefresh(() => context.emitAction({ kind: "refreshWorkspace" }));
  widget.onDidRequestRevertChange((value) =>
    context.emitAction({ kind: "requestRevertChange", value }),
  );
  widget.onDidReviewChange((value) =>
    context.emitAction({ kind: "reviewChange", value }),
  );
  widget.onDidSelectTab((value) =>
    context.emitAction({ kind: "selectDetailTab", value }),
  );
  widget.onDidStageChange((value) =>
    context.emitAction({ kind: "stageChange", value }),
  );
  return widget;
}

function renderTerminal(root: HTMLElement, context: WorkbenchViewContext) {
  const widget = new BottomPanelPart(root, {
    activeTerminal: context.activeTerminal,
    collapsed: context.terminalCollapsed,
    height: context.terminalPanelHeight,
    terminal: context.terminal,
    terminals: context.terminals,
  });
  widget.onDidClose(() => context.emitAction({ kind: "toggleTerminal" }));
  widget.onDidCreateTerminal(() =>
    context.emitAction({ kind: "createTerminal" }),
  );
  widget.onDidDisposeTerminal((value) =>
    context.emitAction({ kind: "disposeTerminal", value }),
  );
  widget.onDidInput((value) =>
    context.emitAction({ kind: "terminalInput", value }),
  );
  widget.onDidSelectTerminal((value) =>
    context.emitAction({ kind: "selectTerminal", value }),
  );
  widget.onDidToggleCollapse(() =>
    context.emitAction({ kind: "toggleTerminalCollapse" }),
  );
  return widget;
}

function renderDrawer(root: HTMLElement, context: WorkbenchViewContext) {
  const widget = new MobileDrawerBackdropWidget(root, true);
  widget.onDidClose(() => context.emitAction({ kind: "closeMobilePanel" }));
  return widget;
}

function renderManagement(root: HTMLElement, context: WorkbenchViewContext) {
  const disposables = new DisposableStore();
  const descriptor = context.managementViewRegistry.get(
    context.managementViewID,
  );
  const view = createElement("div");
  if (descriptor) {
    const contribution = descriptor.factory(
      view,
      {
        builds: context.builds,
        credentials: context.credentials,
        emitAction: (action) =>
          context.emitAction({ kind: "managementAction", action }),
        jobs: context.jobs,
        provisioners: context.provisioners,
        templates: context.templates,
        theme: context.theme,
        workspaces: context.workspaces,
      },
      descriptor,
    );
    if (contribution) disposables.add(contribution);
  }
  const content = child(disposables, (childRoot) => {
    const widget = new ManagementSurfaceWidget(childRoot, {
      activeViewID: context.managementViewID,
      canGoBack: context.managementHistoryLength > 0,
      content: view,
      query: context.managementQuery,
      registry: context.managementViewRegistry,
      scope: context.managementScope,
    });
    widget.onDidGoBack(() => context.emitAction({ kind: "floatingGoBack" }));
    widget.onDidSearch((value) =>
      context.emitAction({ kind: "searchManagement", value }),
    );
    widget.onDidSelectScope((value) =>
      context.emitAction({ kind: "selectManagementScope", value }),
    );
    widget.onDidSelectView((value) =>
      context.emitAction({ kind: "selectManagementView", value }),
    );
    return widget;
  });
  const floating = child(disposables, (childRoot) => {
    const widget = new FloatingWindowWidget(childRoot, {
      content,
      state: context.floatingWindow!,
    });
    widget.onDidClose(() =>
      context.emitAction({ kind: "closeFloatingWindow" }),
    );
    widget.onDidMaximize(() =>
      context.emitAction({ kind: "floatingMaximize" }),
    );
    widget.onDidRestore(() => context.emitAction({ kind: "floatingRestore" }));
    return widget;
  });
  disposables.add(new OverlayLayerWidget(root, floating));
  return disposables;
}

function renderSheet(root: HTMLElement, context: WorkbenchViewContext) {
  const widget = new ManagementSheetView(
    root,
    {
      credentialKind: context.credentialKind,
      credentials: context.credentials,
      editingCredential: context.editingCredential,
      editingTemplate: context.editingTemplate,
      pendingRevertPath: context.pendingRevertPath,
      pendingCredentialDeleteID: context.pendingCredentialDeleteID,
      pendingTemplateDeleteID: context.pendingTemplateDeleteID,
      pendingWorkspaceID: context.pendingWorkspaceID,
      sheet: context.sheet,
      templateKind: context.templateKind,
      templates: context.templates,
      workspaces: context.workspaces,
    },
    context.managementSheetContributionRegistry,
  );
  widget.onDidChooseTemplateSource((value) =>
    context.emitAction({ kind: "chooseTemplateSource", value }),
  );
  widget.onDidClose(() => context.emitAction({ kind: "closeManagementSheet" }));
  widget.onDidContinueEditing(() =>
    context.emitAction({ kind: "continueEditing" }),
  );
  widget.onDidDeleteCredential(() =>
    context.emitAction({ kind: "deleteCredential" }),
  );
  widget.onDidDeleteTemplate(() =>
    context.emitAction({ kind: "deleteTemplate" }),
  );
  widget.onDidDiscardChanges(() =>
    context.emitAction({ kind: "discardManagementChanges" }),
  );
  widget.onDidPickWorkspace((value) =>
    context.emitAction({ kind: "pickWorkspace", value }),
  );
  widget.onDidRevertChange(() => context.emitAction({ kind: "revertChange" }));
  widget.onDidSaveCredential(() =>
    context.emitAction({ kind: "saveCredential" }),
  );
  widget.onDidSaveTemplate(() => context.emitAction({ kind: "saveTemplate" }));
  widget.onDidSaveWorkspace(() =>
    context.emitAction({ kind: "saveWorkspace" }),
  );
  widget.onDidSetCredentialKind((value) =>
    context.emitAction({ kind: "setCredentialKind", value }),
  );
  widget.onDidStartWorkspaceCreate(() =>
    context.emitAction({ kind: "openWorkspaceCreate" }),
  );
  widget.onDidStopWorkspace(() =>
    context.emitAction({ kind: "stopWorkspace" }),
  );
  return widget;
}

function renderToast(root: HTMLElement, context: WorkbenchViewContext) {
  const widget = new ToastWidget(root, context.toast);
  widget.onDidDismiss(() => context.emitAction({ kind: "dismissToast" }));
  return widget;
}

function child(
  store: DisposableStore,
  factory: (root: HTMLElement) => IDisposable,
) {
  const root = createElement("div");
  store.add(factory(root));
  return root;
}

function container(
  id: string,
  location: WorkbenchViewContainer["location"],
  title: string,
): WorkbenchViewContainer {
  return { id, location, title };
}

function descriptor(
  id: string,
  name: string,
  factory: WorkbenchViewDescriptor<WorkbenchViewContext>["factory"],
  when?: WorkbenchViewDescriptor<WorkbenchViewContext>["when"],
  order?: number,
): WorkbenchViewDescriptor<WorkbenchViewContext> {
  return { factory, id, name, order, when };
}

function register(
  views: IWorkbenchViewsRegistry<WorkbenchViewContext>,
  registrations: DisposableStore,
  viewContainer: WorkbenchViewContainer,
  descriptors: WorkbenchViewDescriptor<WorkbenchViewContext>[],
) {
  registrations.add(views.registerViews(descriptors, viewContainer));
}
