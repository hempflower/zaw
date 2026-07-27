import { Emitter, Widget } from "@zaw/ui";
import {
  TerminalView,
  type TerminalViewOptions,
} from "../../views/terminal/terminal-view";

export class BottomPanelPart extends Widget {
  private readonly _onDidClose = this._register(new Emitter<void>());
  private readonly _onDidCreateTerminal = this._register(new Emitter<void>());
  private readonly _onDidDisposeTerminal = this._register(
    new Emitter<string>(),
  );
  private readonly _onDidInput = this._register(new Emitter<string>());
  private readonly _onDidSelectTerminal = this._register(new Emitter<string>());
  private readonly _onDidToggleCollapse = this._register(new Emitter<void>());
  readonly onDidClose = this._onDidClose.event;
  readonly onDidCreateTerminal = this._onDidCreateTerminal.event;
  readonly onDidDisposeTerminal = this._onDidDisposeTerminal.event;
  readonly onDidInput = this._onDidInput.event;
  readonly onDidSelectTerminal = this._onDidSelectTerminal.event;
  readonly onDidToggleCollapse = this._onDidToggleCollapse.event;

  constructor(
    root: HTMLElement,
    private readonly options: TerminalViewOptions,
  ) {
    super(root);
    const view = new TerminalView(this.root, this.options);
    view.onDidClose(() => this._onDidClose.fire(), undefined, this.disposables);
    view.onDidCreateTerminal(
      () => this._onDidCreateTerminal.fire(),
      undefined,
      this.disposables,
    );
    view.onDidDisposeTerminal(
      (value) => this._onDidDisposeTerminal.fire(value),
      undefined,
      this.disposables,
    );
    view.onDidInput(
      (value) => this._onDidInput.fire(value),
      undefined,
      this.disposables,
    );
    view.onDidSelectTerminal(
      (value) => this._onDidSelectTerminal.fire(value),
      undefined,
      this.disposables,
    );
    view.onDidToggleCollapse(
      () => this._onDidToggleCollapse.fire(),
      undefined,
      this.disposables,
    );
  }
}
