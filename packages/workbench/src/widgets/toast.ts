import { ButtonWidget, Emitter, Widget, append, createElement } from "@zaw/ui";

export class ToastWidget extends Widget {
  private readonly _onDidDismiss = this._register(new Emitter<void>());
  readonly onDidDismiss = this._onDidDismiss.event;

  constructor(
    root: HTMLElement,
    private readonly message: string,
  ) {
    super(root);
    if (!this.message) {
      this.root.replaceChildren();
      return;
    }
    const toast = createElement("div", {
      className: "workbench-toast",
      role: "status",
    });
    const dismiss = createElement("span");
    const dismissButton = new ButtonWidget(dismiss, {
      icon: "close",
      label: "Dismiss",
    });
    dismissButton.onDidClick(
      () => this._onDidDismiss.fire(),
      undefined,
      this.disposables,
    );
    append(
      toast,
      createElement("span", { textContent: this.message }),
      ...Array.from(dismiss.childNodes),
    );
    this.root.replaceChildren(toast);
  }
}
