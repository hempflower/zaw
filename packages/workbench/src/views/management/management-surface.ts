import {
  ButtonWidget,
  Emitter,
  InputWidget,
  TabsWidget,
  TreeWidget,
  Widget,
  append,
  createElement,
} from "@zaw/ui";
import type {
  ManagementViewDescriptor,
  IManagementViewRegistry,
} from "../../services/management-view-registry";

export type ManagementScope = "remote" | "user" | "workspace";

export type ManagementSurfaceOptions = {
  activeViewID: string;
  canGoBack: boolean;
  content: Node;
  query: string;
  registry: IManagementViewRegistry;
  scope: ManagementScope;
};

export class ManagementSurfaceWidget extends Widget {
  private readonly _onDidGoBack = this._register(new Emitter<void>());
  private readonly _onDidSearch = this._register(new Emitter<string>());
  private readonly _onDidSelectScope = this._register(
    new Emitter<ManagementScope>(),
  );
  private readonly _onDidSelectView = this._register(new Emitter<string>());
  readonly onDidGoBack = this._onDidGoBack.event;
  readonly onDidSearch = this._onDidSearch.event;
  readonly onDidSelectScope = this._onDidSelectScope.event;
  readonly onDidSelectView = this._onDidSelectView.event;

  constructor(
    root: HTMLElement,
    private readonly options: ManagementSurfaceOptions,
  ) {
    super(root);
    const search = createElement("div");
    const searchInput = new InputWidget(search, {
      ariaLabel: "Search settings",
      placeholder: "Search settings",
      value: this.options.query,
    });
    searchInput.onDidInput(
      ({ value }) => this._onDidSearch.fire(value),
      undefined,
      this.disposables,
    );
    const scopes = createElement("div");
    const scopeTabs = new TabsWidget(scopes, {
      activeID: this.options.scope,
      className: "management-scope-tabs",
      selectAction: "select-management-scope",
      tabs: [
        { id: "user", label: "User" },
        { id: "remote", label: "Remote" },
        { id: "workspace", label: "Workspace" },
      ],
    });
    scopeTabs.onDidSelect(
      ({ id }) => this._onDidSelectScope.fire(id as ManagementScope),
      undefined,
      this.disposables,
    );
    const views = this.filteredViews();
    const tree = createElement("div");
    const viewTree = new TreeWidget(
      tree,
      categories(views).map(([category, items]) => ({
        children: items.map((view) => ({ id: view.id, label: view.title })),
        expanded: true,
        id: `category:${category}`,
        label: category,
      })),
    );
    viewTree.onDidSelect(
      ({ id }) => {
        if (!id.startsWith("category:")) this._onDidSelectView.fire(id);
      },
      undefined,
      this.disposables,
    );
    const back = createElement("span");
    const backButton = new ButtonWidget(back, {
      disabled: !this.options.canGoBack,
      icon: "arrow-left",
      label: "Back",
    });
    backButton.onDidClick(
      () => this._onDidGoBack.fire(),
      undefined,
      this.disposables,
    );
    const title =
      this.options.registry.get(this.options.activeViewID)?.title ??
      "Management";
    const surface = createElement("div", { className: "management-surface" });
    const toolbar = createElement("div", { className: "management-toolbar" });
    append(
      toolbar,
      ...Array.from(back.childNodes),
      ...Array.from(search.childNodes),
    );
    const scopeRow = createElement("div", { className: "management-scopes" });
    scopeRow.append(...Array.from(scopes.childNodes));
    const nav = createElement("aside", {
      ariaLabel: "Management views",
      className: "management-navigation",
    });
    nav.append(...Array.from(tree.childNodes));
    const content = createElement("section", {
      ariaLabel: title,
      className: "management-content",
    });
    content.append(this.options.content);
    append(surface, toolbar, scopeRow, nav, content);
    this.root.replaceChildren(surface);
  }

  private filteredViews() {
    const query = this.options.query.trim().toLocaleLowerCase();
    return this.options.registry.all().filter((view) => {
      if (view.scope !== this.options.scope) return false;
      return (
        !query ||
        view.keywords.some((keyword) =>
          keyword.toLocaleLowerCase().includes(query),
        )
      );
    });
  }
}

function categories(views: ManagementViewDescriptor[]) {
  const result = new Map<string, ManagementViewDescriptor[]>();
  for (const view of views) {
    result.set(view.category, [...(result.get(view.category) ?? []), view]);
  }
  return [...result.entries()];
}
