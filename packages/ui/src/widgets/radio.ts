import { Emitter } from "./event";
import { Widget, append, createElement } from "./widget";

export type RadioOptions = {
  checked?: boolean;
  disabled?: boolean;
  label: string;
  name: string;
  value?: string;
};

export class RadioWidget extends Widget {
  private readonly _onDidChange = this._register(
    new Emitter<{ value: string; event: Event }>(),
  );
  readonly onDidChange = this._onDidChange.event;

  constructor(
    root: HTMLElement,
    private readonly options: RadioOptions,
  ) {
    super(root);
    const widgetOptions = this.options;
    const label = createElement("label", { className: "zaw-radio-option" });
    const input = createElement("input", { className: "zaw-radio" });
    input.type = "radio";
    input.name = widgetOptions.name;
    input.value = widgetOptions.value ?? "true";
    input.checked = Boolean(widgetOptions.checked);
    input.disabled = Boolean(widgetOptions.disabled);
    this.listen(input, "change", (event) =>
      this._onDidChange.fire({ value: input.value, event }),
    );
    append(
      label,
      input,
      createElement("span", { textContent: widgetOptions.label }),
    );
    this.root.replaceChildren(label);
  }
}
