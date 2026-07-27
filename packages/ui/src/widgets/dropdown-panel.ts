import { Emitter } from "./event";
import { Widget, append, createElement } from "./widget";

export type DropdownPanelItem = {
  actionContext?: string;
  className?: string;
  description?: string;
  disabled?: boolean;
  icon?: string;
  label: string;
  role?: "menuitem" | "option";
  selected?: boolean;
  value?: string;
};

export type DropdownPanelSection = {
  items: DropdownPanelItem[];
  label?: string;
};

export type DropdownPanelOptions = {
  ariaRole?: "listbox" | "menu";
  className?: string;
  emptyText?: string;
  footer?: string;
  sections: DropdownPanelSection[];
};

export class DropdownPanelWidget extends Widget {
  private readonly _onDidSelect = this._register(
    new Emitter<{ item: DropdownPanelItem; event: MouseEvent }>(),
  );
  readonly onDidSelect = this._onDidSelect.event;

  constructor(
    root: HTMLElement,
    private readonly options: DropdownPanelOptions,
  ) {
    super(root);
    const className =
      `zaw-dropdown-panel ${this.options.className ?? ""}`.trim();
    const panel = createElement("div", {
      className,
      role: this.options.ariaRole ?? "menu",
    });
    const sections = this.options.sections.filter(
      (section) => section.items.length > 0,
    );
    if (sections.length === 0) {
      panel.append(
        createElement("p", {
          className: "zaw-dropdown-empty",
          textContent: this.options.emptyText ?? "No options",
        }),
      );
    } else {
      sections.forEach((section, index) => {
        const sectionElement = createElement("div", {
          className: `zaw-dropdown-section${index > 0 ? " separated" : ""}`,
        });
        if (section.label) {
          sectionElement.append(
            createElement("p", {
              className: "zaw-dropdown-section-label",
              textContent: section.label,
            }),
          );
        }
        section.items.forEach((item) =>
          sectionElement.append(this.renderItem(item)),
        );
        panel.append(sectionElement);
      });
    }
    if (this.options.footer) {
      panel.append(
        createElement("p", {
          className: "zaw-dropdown-footer",
          textContent: this.options.footer,
        }),
      );
    }
    this.root.replaceChildren(panel);
  }

  private renderItem(item: DropdownPanelItem) {
    const className =
      `zaw-dropdown-item ${item.className ?? ""}${item.selected ? " selected" : ""}`.trim();
    const role = item.role ?? "menuitem";
    const button = createElement("button", { className, role });
    button.type = "button";
    button.disabled = Boolean(item.disabled);
    button.setAttribute("aria-selected", String(item.selected ?? false));
    if (item.value) button.value = item.value;
    const content = createElement("span", {
      className: "zaw-dropdown-item-content",
    });
    append(
      content,
      item.icon
        ? createElement("span", { className: `codicon codicon-${item.icon}` })
        : null,
      createElement("span", { textContent: item.label }),
    );
    append(
      button,
      content,
      item.description
        ? createElement("small", { textContent: item.description })
        : null,
    );
    this.listen(button, "click", (event) =>
      this._onDidSelect.fire({ item, event }),
    );
    return button;
  }
}
