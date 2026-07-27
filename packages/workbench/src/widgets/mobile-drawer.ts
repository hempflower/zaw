import { ButtonWidget, Emitter, Widget } from "@zaw/ui";

export class MobileDrawerBackdropWidget extends Widget {
  private readonly _onDidClose = this._register(new Emitter<void>());
  readonly onDidClose = this._onDidClose.event;

  constructor(
    root: HTMLElement,
    private readonly open: boolean,
  ) {
    super(root);
    if (!this.open) {
      this.root.replaceChildren();
      return;
    }
    const button = new ButtonWidget(this.root, {
      className: "mobile-drawer-backdrop",
      label: "Close mobile panel",
    });
    button.onDidClick(
      () => this._onDidClose.fire(),
      undefined,
      this.disposables,
    );
  }
}
