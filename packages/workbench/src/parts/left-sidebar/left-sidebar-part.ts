import { ButtonWidget, Emitter, Widget, append, createElement } from "@zaw/ui";

export type LeftSidebarPartOptions = {
  content: Node;
  mobileOpen: boolean;
};

export class LeftSidebarPart extends Widget {
  private readonly _onDidClosePanel = this._register(new Emitter<void>());
  private readonly _onDidOpenSettings = this._register(new Emitter<void>());
  private readonly _onDidStartNewSession = this._register(new Emitter<void>());
  readonly onDidClosePanel = this._onDidClosePanel.event;
  readonly onDidOpenSettings = this._onDidOpenSettings.event;
  readonly onDidStartNewSession = this._onDidStartNewSession.event;

  constructor(
    root: HTMLElement,
    private readonly options: LeftSidebarPartOptions,
  ) {
    super(root);
    const button = (
      label: string,
      icon?: string,
      onDidClick?: () => void,
      className?: string,
      text?: string,
    ) => {
      const root = createElement("span");
      const widget = new ButtonWidget(root, { className, icon, label, text });
      if (onDidClick)
        widget.onDidClick(onDidClick, undefined, this.disposables);
      return Array.from(root.childNodes);
    };
    const aside = createElement("aside", {
      ariaLabel: "Workspaces",
      className: `workspace-sidebar ${this.options.mobileOpen ? "mobile-open" : ""}`,
    });
    const heading = createElement("div", { className: "sidebar-heading" });
    const actions = createElement("div");
    append(
      actions,
      ...button(
        "New session (Ctrl+L)",
        undefined,
        () => this._onDidStartNewSession.fire(),
        "new-session",
        "New",
      ),
      ...button("Filter workspaces", "filter"),
      ...button("Find workspace", "search"),
      ...button(
        "Close workspaces",
        "close",
        () => this._onDidClosePanel.fire(),
        "mobile-panel-close",
      ),
    );
    append(heading, createElement("h1", { textContent: "Sessions" }), actions);
    const footer = createElement("nav", {
      ariaLabel: "Workbench navigation",
      className: "sidebar-footer",
    });
    append(
      footer,
      ...button("Overview", "home", undefined, undefined, "Overview"),
      ...button(
        "Settings",
        "settings-gear",
        () => this._onDidOpenSettings.fire(),
        undefined,
        "Settings",
      ),
    );
    append(
      aside,
      heading,
      createElement("p", {
        className: "sidebar-section-label",
        textContent: "WORKSPACES",
      }),
      this.options.content,
      footer,
    );
    this.root.replaceChildren(aside);
  }
}
