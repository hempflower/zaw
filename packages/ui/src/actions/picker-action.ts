import { DropdownPanelWidget } from "../widgets/dropdown-panel";
import type { DropdownPanelItem } from "../widgets/dropdown-panel";
import { DropdownWidget } from "../widgets/dropdown";
import { Emitter } from "../widgets/event";
import { Widget, createElement } from "../widgets/widget";

export interface PickerActionItem {
  readonly description?: string;
  readonly disabled?: boolean;
  readonly icon?: string;
  readonly label: string;
  readonly value: string;
}

export interface PickerActionOptions {
  readonly ariaLabel: string;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly icon?: string;
  readonly items: readonly PickerActionItem[];
  readonly value?: string;
}

export class PickerAction extends Widget {
  private readonly _onDidSelect = this._register(
    new Emitter<{ item: PickerActionItem; event: MouseEvent }>(),
  );
  readonly onDidSelect = this._onDidSelect.event;

  private readonly label: Text;
  private readonly panel: DropdownPanelWidget;
  private readonly details: HTMLDetailsElement | undefined;
  private value: string | undefined;

  constructor(
    root: HTMLElement,
    private readonly options: PickerActionOptions,
  ) {
    super(root);
    this.value = options.value;
    const selected = options.items.find((item) => item.value === options.value);
    const trigger = createElement("span", {
      className: "zaw-picker-action-trigger",
    });
    if (options.icon) {
      const icon = createElement("span", {
        className: `codicon codicon-${options.icon}`,
      });
      icon.setAttribute("aria-hidden", "true");
      trigger.append(icon);
    }
    this.label = document.createTextNode(selected?.label ?? options.ariaLabel);
    trigger.append(
      createElement("span", { className: "zaw-picker-action-label" }),
    );
    trigger.lastElementChild?.append(this.label);

    const panelRoot = createElement("div");
    this.panel = this._register(
      new DropdownPanelWidget(panelRoot, {
        ariaRole: "listbox",
        className: "zaw-picker-action-menu",
        sections: [{ items: this.toPanelItems(options.items) }],
      }),
    );
    const dropdownRoot = createElement("div");
    this._register(
      new DropdownWidget(dropdownRoot, {
        ariaLabel: options.ariaLabel,
        className: `zaw-picker-action ${options.className ?? ""}`.trim(),
        disabled: options.disabled,
        panel: panelRoot.firstElementChild ?? panelRoot,
        trigger,
        variant: "borderless",
      }),
    );
    this.details = dropdownRoot.querySelector("details") ?? undefined;
    this.panel.onDidSelect(
      ({ item, event }) => {
        const selectedItem = options.items.find(
          (candidate) => candidate.value === item.value,
        );
        if (!selectedItem) return;
        this.setValue(selectedItem.value);
        this.details?.removeAttribute("open");
        this.details?.querySelector<HTMLElement>("summary")?.focus();
        this._onDidSelect.fire({ item: selectedItem, event });
      },
      undefined,
      this.disposables,
    );
    this.root.replaceChildren(...Array.from(dropdownRoot.childNodes));
    this.updateSelection();
  }

  setValue(value: string): void {
    this.value = value;
    const item = this.options.items.find(
      (candidate) => candidate.value === value,
    );
    if (item) this.label.data = item.label;
    this.updateSelection();
  }

  private updateSelection(): void {
    this.root
      .querySelectorAll<HTMLButtonElement>(".zaw-dropdown-item")
      .forEach((element) => {
        const selected = element.value === this.value;
        element.classList.toggle("selected", selected);
        element.setAttribute("aria-selected", String(selected));
      });
  }

  private toPanelItems(
    items: readonly PickerActionItem[],
  ): DropdownPanelItem[] {
    return items.map((item) => ({
      description: item.description,
      disabled: item.disabled,
      icon: item.icon,
      label: item.label,
      role: "option",
      selected: item.value === this.value,
      value: item.value,
    }));
  }
}
