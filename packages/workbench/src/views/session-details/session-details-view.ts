import type { Workspace } from "@zaw/protocol";
import {
  ButtonWidget,
  DisposableStore,
  Emitter,
  TabsWidget,
  Widget,
  append,
  createElement,
} from "@zaw/ui";
import type {
  DetailTabViewModel,
  FileViewModel,
  WorkspaceChangeViewModel,
} from "../models";
import type {
  DetailTabRenderAction,
  IDetailTabRendererRegistry,
} from "./detail-tab-renderer-registry";

export type SessionDetailsViewOptions = {
  activeTab: DetailTabViewModel;
  activeTabID: string;
  changes: WorkspaceChangeViewModel[];
  files: FileViewModel[];
  mobileOpen: boolean;
  tabs: DetailTabViewModel[];
  workspace?: Workspace;
};

export class SessionDetailsView extends Widget {
  private readonly rendererDisposables = this._register(new DisposableStore());
  private readonly detailActionHandlers: {
    [K in DetailTabRenderAction["kind"]]: (
      action: Extract<DetailTabRenderAction, { kind: K }>,
    ) => void;
  } = {
    openChange: (action) => this._onDidOpenChange.fire(action.path),
    openDirectory: (action) => this._onDidOpenDirectory.fire(action.uri),
    openFile: (action) => this._onDidOpenFile.fire(action.uri),
    requestRevertChange: (action) =>
      this._onDidRequestRevertChange.fire(action.path),
    reviewChange: (action) => this._onDidReviewChange.fire(action.path),
    stageChange: (action) => this._onDidStageChange.fire(action.path),
  };
  private readonly _onDidClosePanel = this._register(new Emitter<void>());
  private readonly _onDidCloseTab = this._register(new Emitter<string>());
  private readonly _onDidOpenChange = this._register(new Emitter<string>());
  private readonly _onDidOpenDirectory = this._register(new Emitter<string>());
  private readonly _onDidOpenFile = this._register(new Emitter<string>());
  private readonly _onDidOpenFilesTab = this._register(new Emitter<void>());
  private readonly _onDidRefresh = this._register(new Emitter<void>());
  private readonly _onDidRequestRevertChange = this._register(
    new Emitter<string>(),
  );
  private readonly _onDidReviewChange = this._register(new Emitter<string>());
  private readonly _onDidSelectTab = this._register(new Emitter<string>());
  private readonly _onDidStageChange = this._register(new Emitter<string>());
  readonly onDidClosePanel = this._onDidClosePanel.event;
  readonly onDidCloseTab = this._onDidCloseTab.event;
  readonly onDidOpenChange = this._onDidOpenChange.event;
  readonly onDidOpenDirectory = this._onDidOpenDirectory.event;
  readonly onDidOpenFile = this._onDidOpenFile.event;
  readonly onDidOpenFilesTab = this._onDidOpenFilesTab.event;
  readonly onDidRefresh = this._onDidRefresh.event;
  readonly onDidRequestRevertChange = this._onDidRequestRevertChange.event;
  readonly onDidReviewChange = this._onDidReviewChange.event;
  readonly onDidSelectTab = this._onDidSelectTab.event;
  readonly onDidStageChange = this._onDidStageChange.event;

  constructor(
    root: HTMLElement,
    private readonly options: SessionDetailsViewOptions,
    private readonly registry: IDetailTabRendererRegistry,
  ) {
    super(root);
    const viewOptions = this.options;
    const active = viewOptions.activeTab;
    const activeRenderer = this.registry.rendererFor(active.kind);
    const aside = createElement("aside", {
      ariaLabel: "Session details",
      className: `session-sidebar ${viewOptions.mobileOpen ? "mobile-open" : ""}`,
    });
    const header = createElement("header", { className: "changes-header" });
    const tabsRoot = createElement("div");
    const tabs = new TabsWidget(tabsRoot, {
      activeID: viewOptions.activeTabID,
      className: "detail-pane-tabbar",
      selectAction: "select-detail-tab",
      tabs: viewOptions.tabs.map((tab) => ({
        id: tab.id,
        label: tab.title,
        icon: this.registry.rendererFor(tab.kind)?.icon,
        closeable: viewOptions.tabs.length > 1,
      })),
    });
    tabs.onDidClose(
      ({ id }) => this._onDidCloseTab.fire(id),
      undefined,
      this.disposables,
    );
    tabs.onDidSelect(
      ({ id }) => this._onDidSelectTab.fire(id),
      undefined,
      this.disposables,
    );
    const tabRow = createElement("div", { className: "detail-pane-tab-row" });
    append(
      tabRow,
      ...Array.from(tabsRoot.childNodes),
      this.button(
        "Open Files tab",
        "add",
        () => this._onDidOpenFilesTab.fire(),
        undefined,
        "detail-pane-tab-add",
      ),
    );
    const title = createElement("div", { className: "changes-title" });
    const strong = createElement("strong");
    append(
      strong,
      createElement("span", { className: "codicon codicon-source-control" }),
      document.createTextNode(active.title),
    );
    const titleActions = createElement("span");
    append(
      titleActions,
      this.button("Refresh changes", "refresh", () =>
        this._onDidRefresh.fire(),
      ),
      this.button("More change actions", "ellipsis"),
      this.button(
        "Close changes panel",
        "close",
        () => this._onDidClosePanel.fire(),
        undefined,
        "mobile-panel-close",
      ),
    );
    append(title, strong, titleActions);
    append(header, tabRow, title);
    activeRenderer?.renderHeader?.(header, active, this.rendererContext());
    aside.append(header);
    if (activeRenderer?.showWorkspaceScope && viewOptions.workspace) {
      const workspaceState = createElement("div", {
        className: "changes-workspace",
      });
      const name = createElement("span");
      append(
        name,
        createElement("span", { className: "codicon codicon-chevron-down" }),
        document.createTextNode(
          `Workspace Changes · ${viewOptions.workspace.name}`,
        ),
      );
      append(
        workspaceState,
        name,
        createElement("span", { textContent: "workspace scope" }),
      );
      aside.append(workspaceState);
    }
    const content = createElement("div");
    const renderer = activeRenderer?.factory(
      content,
      active,
      this.rendererContext(),
    );
    if (renderer) this.rendererDisposables.add(renderer);
    aside.append(...Array.from(content.childNodes));
    this.root.replaceChildren(aside);
  }

  private rendererContext() {
    return {
      changes: this.options.changes,
      emitAction: (action: DetailTabRenderAction) =>
        this.detailActionHandlers[action.kind](action as never),
      files: this.options.files,
      workspace: this.options.workspace,
    };
  }

  private button(
    label: string,
    icon?: string,
    onDidClick?: () => void,
    className?: string,
    text?: string,
  ) {
    const root = createElement("span");
    const widget = new ButtonWidget(root, {
      className,
      icon,
      label,
      text: text ?? (icon ? undefined : label),
    });
    if (onDidClick) widget.onDidClick(onDidClick, undefined, this.disposables);
    return root.firstElementChild ?? root;
  }
}
