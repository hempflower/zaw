import type { ControlOptions } from "./control-options";
import { DropdownPanelWidget } from "./dropdown-panel";
import { DropdownWidget } from "./dropdown";
import { Emitter } from "./event";
import { Widget, createElement } from "./widget";

export type SelectOption = {
  description?: string;
  disabled?: boolean;
  label: string;
  value: string;
};

export type SelectOptions = ControlOptions & {
  options: SelectOption[];
  variant?: "borderless" | "default";
};

export class SelectWidget extends Widget {
  private readonly _onDidSelect = this._register(
    new Emitter<{ value: string; option: SelectOption; event: MouseEvent }>(),
  );
  readonly onDidSelect = this._onDidSelect.event;

  private readonly input: HTMLInputElement;
  private readonly trigger: Text;
  private readonly footer: HTMLParagraphElement | undefined;
  private selectedValue: string | undefined;

  constructor(
    root: HTMLElement,
    private readonly options: SelectOptions,
  ) {
    super(root);
    const widgetOptions = this.options;
    this.selectedValue = widgetOptions.value;
    const selected = widgetOptions.options.find(
      (option) => option.value === widgetOptions.value,
    );
    const field = createElement("div", { className: "zaw-select-field" });
    const input = createElement("input");
    input.type = "hidden";
    if (widgetOptions.name) input.name = widgetOptions.name;
    input.value = widgetOptions.value ?? "";
    const panelRoot = createElement("div");
    const panel = new DropdownPanelWidget(panelRoot, {
      ariaRole: "listbox",
      className: "zaw-select-menu",
      footer: selected?.description,
      sections: [
        {
          items: widgetOptions.options.map((option) => ({
            className: "zaw-select-option",
            description: option.description,
            disabled: option.disabled,
            label: option.label,
            role: "option",
            selected: option.value === options.value,
            value: option.value,
          })),
        },
      ],
    });
    const dropdownRoot = createElement("div");
    const trigger = document.createTextNode(
      selected?.label ?? widgetOptions.placeholder ?? "Select",
    );
    new DropdownWidget(dropdownRoot, {
      ariaLabel: widgetOptions.ariaLabel ?? selected?.label ?? "Select",
      className: `zaw-select ${widgetOptions.className ?? ""}`,
      disabled: widgetOptions.disabled,
      panel: panelRoot.firstElementChild ?? panelRoot,
      trigger,
      variant: widgetOptions.variant,
    });
    const renderedDetails = dropdownRoot.querySelector("details");
    const footer =
      panelRoot.querySelector<HTMLParagraphElement>(".zaw-dropdown-footer") ??
      undefined;
    panel.onDidSelect(
      ({ item, event }) => {
        const option = widgetOptions.options.find(
          (candidate) => candidate.value === item.value,
        );
        if (!option) return;
        this.setValue(option.value);
        renderedDetails?.removeAttribute("open");
        renderedDetails?.querySelector<HTMLElement>("summary")?.focus();
        this._onDidSelect.fire({ value: option.value, option, event });
      },
      undefined,
      this.disposables,
    );
    this.input = input;
    this.trigger = trigger;
    this.footer = footer;
    field.replaceChildren(input, ...Array.from(dropdownRoot.childNodes));
    this.root.replaceChildren(field);
  }

  setValue(value: string): void {
    this.selectedValue = value;
    this.input.value = value;
    const selected = this.options.options.find(
      (option) => option.value === value,
    );
    this.trigger.data = selected?.label ?? this.options.placeholder ?? "Select";
    if (this.footer) this.footer.textContent = selected?.description ?? "";
    this.root
      .querySelectorAll<HTMLButtonElement>(".zaw-select-option")
      .forEach((button) => {
        const active = button.value === this.selectedValue;
        button.classList.toggle("selected", active);
        button.setAttribute("aria-selected", String(active));
      });
  }
}
