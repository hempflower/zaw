import { ButtonWidget, Emitter, Widget, append, createElement } from "@zaw/ui";

export type SessionViewOptions = {
  composer: Node;
  emptyState: Node;
  messages: Node[];
  sessionSelected: boolean;
  selectedSessionTitle: string;
  summary: Node;
  terminalPart: Node | null;
  terminalOpen: boolean;
  workspaceID: string;
  workspaceOnline: boolean;
};

export class SessionView extends Widget {
  private readonly _onDidCreateNewSession = this._register(new Emitter<void>());
  private readonly _onDidToggleTerminal = this._register(new Emitter<void>());
  readonly onDidCreateNewSession = this._onDidCreateNewSession.event;
  readonly onDidToggleTerminal = this._onDidToggleTerminal.event;

  constructor(
    root: HTMLElement,
    private readonly options: SessionViewOptions,
  ) {
    super(root);
    const viewOptions = this.options;
    const section = createElement("section", {
      ariaLabel: "Session canvas",
      className: "session-canvas",
    });
    if (!viewOptions.sessionSelected) {
      const messages = createElement("div", { className: "session-messages" });
      messages.setAttribute("aria-live", "polite");
      messages.append(viewOptions.emptyState);
      section.append(messages);
      this.root.replaceChildren(section);
      return;
    }
    const newSession = createElement("span");
    const newSessionButton = new ButtonWidget(newSession, {
      icon: "add",
      label: "New session tab",
    });
    newSessionButton.onDidClick(
      () => this._onDidCreateNewSession.fire(),
      undefined,
      this.disposables,
    );
    const terminal = createElement("span");
    const terminalButton = new ButtonWidget(terminal, {
      className: "session-terminal-toggle",
      disabled: !viewOptions.workspaceOnline,
      icon: "terminal",
      label: "Open terminal",
    });
    terminalButton.onDidClick(
      () => this._onDidToggleTerminal.fire(),
      undefined,
      this.disposables,
    );
    const header = createElement("header", { className: "session-header" });
    const tabbar = createElement("div", { className: "session-tabbar" });
    append(
      tabbar,
      createElement("span", {
        className: "session-tab active",
        textContent: viewOptions.selectedSessionTitle || "New session",
      }),
      ...Array.from(newSession.childNodes),
      viewOptions.workspaceID && !viewOptions.terminalOpen
        ? document.createDocumentFragment()
        : null,
    );
    if (viewOptions.workspaceID && !viewOptions.terminalOpen) {
      tabbar.append(...Array.from(terminal.childNodes));
    }
    append(header, tabbar, viewOptions.summary);
    const messages = createElement("div", { className: "session-messages" });
    messages.setAttribute("aria-live", "polite");
    append(messages, viewOptions.emptyState, ...viewOptions.messages);
    append(
      section,
      header,
      messages,
      viewOptions.composer,
      viewOptions.terminalPart,
    );
    this.root.replaceChildren(section);
  }
}
