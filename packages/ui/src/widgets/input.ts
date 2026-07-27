import type { ControlOptions } from "./control-options";
import { applyControlOptions } from "./control-options";
import { Emitter } from "./event";
import { Widget, createElement } from "./widget";

export type InputOptions = ControlOptions & {
  autocomplete?: "off" | "on";
  multiple?: boolean;
  type?: "file" | "number" | "password" | "text" | "url";
};

export class InputWidget extends Widget {
  private readonly _onDidChange = this._register(
    new Emitter<{ value: string; event: Event }>(),
  );
  private readonly _onDidInput = this._register(
    new Emitter<{ value: string; event: Event }>(),
  );
  readonly onDidChange = this._onDidChange.event;
  readonly onDidInput = this._onDidInput.event;

  private readonly input: HTMLInputElement;

  constructor(
    root: HTMLElement,
    private readonly options: InputOptions,
  ) {
    super(root);
    const widgetOptions = this.options;
    const className = `zaw-control ${widgetOptions.className ?? ""}`.trim();
    const input = createElement("input", { className });
    input.type = widgetOptions.type ?? "text";
    applyControlOptions(input, widgetOptions);
    if (widgetOptions.type !== "file") input.value = widgetOptions.value ?? "";
    input.multiple = Boolean(widgetOptions.multiple);
    if (widgetOptions.autocomplete)
      input.autocomplete = widgetOptions.autocomplete;
    this.listen(input, "input", (event) =>
      this._onDidInput.fire({ value: input.value, event }),
    );
    this.listen(input, "change", (event) =>
      this._onDidChange.fire({ value: input.value, event }),
    );
    this.input = input;
    this.root.replaceChildren(input);
  }

  setValue(value: string): void {
    this.input.value = value;
  }
}
