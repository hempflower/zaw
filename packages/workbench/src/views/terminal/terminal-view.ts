import {
  ButtonWidget,
  Emitter,
  InputWidget,
  TabsWidget,
  Widget,
  append,
  createElement,
} from "@zaw/ui";
import type { TerminalViewModel } from "../models";

export type TerminalViewOptions = {
  activeTerminal: string | null;
  collapsed: boolean;
  height: number;
  terminal?: TerminalViewModel;
  terminals: TerminalViewModel[];
};

export class TerminalView extends Widget {
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
    const tabs = createElement("div");
    const tabbar = new TabsWidget(tabs, {
      activeID: this.options.activeTerminal ?? "",
      className: "terminal-tabs",
      selectAction: "select-terminal",
      tabs: this.options.terminals.map((terminal) => ({
        id: terminal.resource,
        label: terminal.title,
        icon: "terminal",
        closeable: true,
      })),
    });
    tabbar.onDidClose(
      ({ id }) => this._onDidDisposeTerminal.fire(id),
      undefined,
      this.disposables,
    );
    tabbar.onDidSelect(
      ({ id }) => this._onDidSelectTerminal.fire(id),
      undefined,
      this.disposables,
    );
    const section = createElement("section", {
      ariaLabel: "Terminal",
      className: `terminal-panel ${this.options.collapsed ? "collapsed" : ""}`,
    });
    section.style.setProperty(
      "--zaw-terminal-panel-height",
      `${Math.round(this.options.height)}px`,
    );
    const resize = createElement("div", {
      className: "terminal-resize-handle",
    });
    resize.dataset.resizePanel = "bottom";
    resize.setAttribute("aria-hidden", "true");
    const header = createElement("header");
    append(header, createElement("h2", { textContent: "Terminal" }));
    const addHeaderButton = (
      options: ConstructorParameters<typeof ButtonWidget>[1],
      handler: () => void,
    ) => {
      const root = createElement("span");
      const button = new ButtonWidget(root, options);
      button.onDidClick(handler, undefined, this.disposables);
      header.append(...Array.from(root.childNodes));
    };
    addHeaderButton({ icon: "add", label: "New terminal" }, () =>
      this._onDidCreateTerminal.fire(),
    );
    addHeaderButton(
      {
        icon: this.options.collapsed ? "chevron-up" : "chevron-down",
        label: this.options.collapsed ? "Expand terminal" : "Collapse terminal",
      },
      () => this._onDidToggleCollapse.fire(),
    );
    addHeaderButton({ icon: "close", label: "Close terminal panel" }, () =>
      this._onDidClose.fire(),
    );
    const content = createElement("div", { className: "terminal-content" });
    const terminalBody = createElement("div");
    const output = createElement("pre", {
      textContent: this.options.terminal?.output ?? "Choose a terminal",
    });
    output.dataset.terminalOutput = "true";
    const label = createElement("label");
    const input = createElement("div");
    new InputWidget(input, {
      ariaLabel: "Terminal command",
    });
    const commandInput = input.querySelector<HTMLInputElement>("input");
    if (commandInput) {
      this.listen(commandInput, "keydown", (event) => {
        if (event.key !== "Enter" || commandInput.value === "") return;
        this._onDidInput.fire(commandInput.value);
        commandInput.value = "";
      });
    }
    append(
      label,
      document.createTextNode("Command"),
      ...Array.from(input.childNodes),
    );
    append(terminalBody, output, label);
    const aside = createElement("aside", { ariaLabel: "Workspace terminals" });
    aside.append(...Array.from(tabs.childNodes));
    append(content, terminalBody, aside);
    append(section, resize, header, content);
    this.root.replaceChildren(section);
  }
}
