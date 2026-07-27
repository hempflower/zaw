import { ButtonWidget } from "./button";
import { Emitter } from "./event";
import { Widget, append, createElement } from "./widget";

export type DialogOptions = {
  body: Node;
  title: string;
};

export class DialogWidget extends Widget {
  private readonly _onDidClose = this._register(new Emitter<MouseEvent>());
  readonly onDidClose = this._onDidClose.event;

  constructor(
    root: HTMLElement,
    private readonly options: DialogOptions,
  ) {
    super(root);
    const backdrop = createElement("div", { className: "zaw-dialog-backdrop" });
    const dialog = createElement("section", {
      ariaLabel: this.options.title,
      className: "zaw-dialog",
      role: "dialog",
    });
    dialog.setAttribute("aria-modal", "true");
    const header = createElement("header");
    const closeRoot = createElement("span");
    const closeButton = new ButtonWidget(closeRoot, {
      icon: "close",
      label: `Close ${this.options.title}`,
    });
    closeButton.onDidClick(
      (event) => this._onDidClose.fire(event),
      undefined,
      this.disposables,
    );
    append(
      header,
      createElement("strong", { textContent: this.options.title }),
      ...Array.from(closeRoot.childNodes),
    );
    const body = createElement("div", { className: "zaw-dialog-body" });
    body.append(this.options.body);
    append(dialog, header, body);
    backdrop.append(dialog);
    this.root.replaceChildren(backdrop);
  }
}
