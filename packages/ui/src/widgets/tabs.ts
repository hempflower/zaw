import { ButtonWidget } from "./button";
import { Emitter } from "./event";
import { Widget, append, createElement } from "./widget";

export type Tab = {
  id: string;
  label: string;
  icon?: string;
  closeable?: boolean;
};

export type TabsOptions = {
  activeID: string;
  addLabel?: string;
  className?: string;
  selectAction: string;
  tabs: Tab[];
};

export class TabsWidget extends Widget {
  private readonly _onDidAdd = this._register(new Emitter<MouseEvent>());
  private readonly _onDidClose = this._register(
    new Emitter<{ id: string; event: MouseEvent }>(),
  );
  private readonly _onDidSelect = this._register(
    new Emitter<{ id: string; event: MouseEvent }>(),
  );
  readonly onDidAdd = this._onDidAdd.event;
  readonly onDidClose = this._onDidClose.event;
  readonly onDidSelect = this._onDidSelect.event;

  constructor(
    root: HTMLElement,
    private readonly options: TabsOptions,
  ) {
    super(root);
    const tabs = createElement("div", {
      className: `zaw-tabs ${this.options.className ?? ""}`,
      role: "tablist",
    });
    this.options.tabs.forEach((tab) => tabs.append(this.renderTab(tab)));
    if (this.options.addLabel) {
      const addRoot = createElement("span");
      const addButton = new ButtonWidget(addRoot, {
        className: "zaw-tab-add",
        icon: "add",
        label: this.options.addLabel ?? "Add tab",
      });
      addButton.onDidClick(
        (event) => this._onDidAdd.fire(event),
        undefined,
        this.disposables,
      );
      append(tabs, ...Array.from(addRoot.childNodes));
    }
    this.root.replaceChildren(tabs);
  }

  private renderTab(tab: Tab) {
    const active = tab.id === this.options.activeID;
    const tabElement = createElement("div", {
      className: `zaw-tab ${active ? "active" : ""}`,
      role: "tab",
    });
    tabElement.setAttribute("aria-selected", String(active));
    const label = createElement("button", { className: "zaw-tab-label" });
    label.type = "button";
    append(
      label,
      tab.icon
        ? createElement("span", { className: `codicon codicon-${tab.icon}` })
        : null,
      document.createTextNode(tab.label),
    );
    this.listen(label, "click", (event) =>
      this._onDidSelect.fire({ id: tab.id, event }),
    );
    tabElement.append(label);
    if (tab.closeable) {
      const closeRoot = createElement("span");
      const closeButton = new ButtonWidget(closeRoot, {
        className: "zaw-tab-close",
        icon: "close",
        label: `Close ${tab.label}`,
        value: tab.id,
      });
      closeButton.onDidClick(
        (event) => this._onDidClose.fire({ id: tab.id, event }),
        undefined,
        this.disposables,
      );
      append(tabElement, ...Array.from(closeRoot.childNodes));
    }
    return tabElement;
  }
}
