import { ButtonWidget } from "./button";
import { Emitter } from "./event";
import { getFocusableElements } from "./keyboard-navigation";
import { Widget, append, createElement } from "./widget";

export type DialogOptions = {
  body: Node;
  title: string;
};

export class DialogWidget extends Widget {
  private readonly _onDidClose = this._register(new Emitter<Event>());
  readonly onDidClose = this._onDidClose.event;
  private readonly previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;

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
    this.listen(dialog, "keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this._onDidClose.fire(event);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        dialog.tabIndex = -1;
        dialog.focus();
        event.preventDefault();
        return;
      }
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) {
        focusable.at(-1)?.focus();
        event.preventDefault();
      } else if (!event.shiftKey && index === focusable.length - 1) {
        focusable[0].focus();
        event.preventDefault();
      }
    });
    queueMicrotask(() => getFocusableElements(dialog)[0]?.focus());
    this._register({
      dispose: () => {
        if (this.previousFocus?.isConnected) this.previousFocus.focus();
      },
    });
  }
}
