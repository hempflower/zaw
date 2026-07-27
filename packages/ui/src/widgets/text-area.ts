import type { ControlOptions } from "./control-options";
import { applyControlOptions } from "./control-options";
import { Emitter } from "./event";
import { Widget, createElement } from "./widget";

export type TextAreaOptions = ControlOptions & { rows?: number };

export class TextAreaWidget extends Widget {
  private readonly _onDidChange = this._register(
    new Emitter<{ value: string; event: Event }>(),
  );
  private readonly _onDidInput = this._register(
    new Emitter<{ value: string; event: Event }>(),
  );
  readonly onDidChange = this._onDidChange.event;
  readonly onDidInput = this._onDidInput.event;

  private readonly textarea: HTMLTextAreaElement;

  constructor(
    root: HTMLElement,
    private readonly options: TextAreaOptions,
  ) {
    super(root);
    const className = `zaw-control ${this.options.className ?? ""}`.trim();
    const textarea = createElement("textarea", { className });
    applyControlOptions(textarea, this.options);
    textarea.value = this.options.value ?? "";
    if (this.options.rows) textarea.rows = this.options.rows;
    this.listen(textarea, "input", (event) =>
      this._onDidInput.fire({ value: textarea.value, event }),
    );
    this.listen(textarea, "change", (event) =>
      this._onDidChange.fire({ value: textarea.value, event }),
    );
    this.textarea = textarea;
    this.root.replaceChildren(textarea);
  }

  setValue(value: string): void {
    this.textarea.value = value;
  }
}
