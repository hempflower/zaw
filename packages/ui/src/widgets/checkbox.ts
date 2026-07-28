import { Emitter } from "./event";
import { Widget, append, createElement } from "./widget";

export type CheckboxOptions = {
  checked?: boolean;
  disabled?: boolean;
  label: string;
  name: string;
  value?: string;
};

export class CheckboxWidget extends Widget {
  private readonly _onDidChange = this._register(
    new Emitter<{ checked: boolean; value: string; event: Event }>(),
  );
  readonly onDidChange = this._onDidChange.event;

  private readonly input: HTMLInputElement;

  constructor(
    root: HTMLElement,
    private readonly options: CheckboxOptions,
  ) {
    super(root);
    const widgetOptions = this.options;
    const label = createElement("label", { className: "zaw-checkbox-option" });
    const input = createElement("input", { className: "zaw-checkbox" });
    input.type = "checkbox";
    input.name = widgetOptions.name;
    input.value = widgetOptions.value ?? "true";
    input.checked = Boolean(widgetOptions.checked);
    input.disabled = Boolean(widgetOptions.disabled);
    this.listen(input, "change", (event) =>
      this._onDidChange.fire({
        checked: input.checked,
        value: input.value,
        event,
      }),
    );
    this.input = input;
    append(
      label,
      input,
      createElement("span", {
        className: "zaw-checkbox-box codicon codicon-check",
      }),
      createElement("span", {
        className: "zaw-checkbox-label",
        textContent: widgetOptions.label,
      }),
    );
    this.root.replaceChildren(label);
  }

  setChecked(checked: boolean): void {
    this.input.checked = checked;
  }
}
