import { Emitter, Widget } from "@zaw/ui";
import {
  SessionView,
  type SessionViewOptions,
} from "../../views/session/session-view";

export class PrimaryAreaPart extends Widget {
  private readonly _onDidCreateNewSession = this._register(new Emitter<void>());
  private readonly _onDidToggleTerminal = this._register(new Emitter<void>());
  readonly onDidCreateNewSession = this._onDidCreateNewSession.event;
  readonly onDidToggleTerminal = this._onDidToggleTerminal.event;

  constructor(
    root: HTMLElement,
    private readonly options: SessionViewOptions,
  ) {
    super(root);
    const view = new SessionView(this.root, this.options);
    view.onDidCreateNewSession(
      () => this._onDidCreateNewSession.fire(),
      undefined,
      this.disposables,
    );
    view.onDidToggleTerminal(
      () => this._onDidToggleTerminal.fire(),
      undefined,
      this.disposables,
    );
  }
}
