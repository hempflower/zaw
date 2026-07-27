import { ButtonWidget, Emitter, Widget, append, createElement } from "@zaw/ui";

export type TitlebarPartOptions = {
  leftSidebarVisible: boolean;
  secondarySidebarVisible: boolean;
};

export class TitlebarPart extends Widget {
  private readonly _onDidOpenSettings = this._register(new Emitter<void>());
  private readonly _onDidToggleLeftPanel = this._register(new Emitter<void>());
  private readonly _onDidToggleRightPanel = this._register(new Emitter<void>());
  readonly onDidOpenSettings = this._onDidOpenSettings.event;
  readonly onDidToggleLeftPanel = this._onDidToggleLeftPanel.event;
  readonly onDidToggleRightPanel = this._onDidToggleRightPanel.event;

  constructor(
    root: HTMLElement,
    private readonly options: TitlebarPartOptions,
  ) {
    super(root);
    const left = this.options.leftSidebarVisible;
    const right = this.options.secondarySidebarVisible;
    const header = createElement("header", { className: "app-titlebar" });
    const brand = createElement("div", { className: "titlebar-brand" });
    append(
      brand,
      createElement("span", { className: "codicon codicon-remote" }),
      createElement("span", { textContent: "Zaw" }),
    );
    const actions = createElement("div", { className: "titlebar-actions" });
    const addButton = (
      options: ConstructorParameters<typeof ButtonWidget>[1],
      handler: () => void,
    ) => {
      const root = createElement("span");
      const widget = new ButtonWidget(root, options);
      widget.onDidClick(handler, undefined, this.disposables);
      actions.append(...Array.from(root.childNodes));
    };
    addButton(
      {
        className: `titlebar-panel-toggle ${left ? "active" : ""}`,
        icon: "layout-sidebar-left",
        label: left ? "Hide Sessions panel" : "Show Sessions panel",
      },
      () => this._onDidToggleLeftPanel.fire(),
    );
    addButton(
      {
        className: `titlebar-panel-toggle ${right ? "active" : ""}`,
        icon: "layout-sidebar-right",
        label: right ? "Hide Changes panel" : "Show Changes panel",
      },
      () => this._onDidToggleRightPanel.fire(),
    );
    addButton(
      {
        icon: "settings-gear",
        label: "Settings",
      },
      () => this._onDidOpenSettings.fire(),
    );
    append(
      header,
      brand,
      createElement("div", { className: "titlebar-spacer" }),
      actions,
    );
    this.root.replaceChildren(header);
  }
}
