import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  Disposable,
  DisposableStore,
  IconActionButton,
  createElement,
} from "@zaw/ui";
import { inject, injectable } from "inversify";
import { ICommandService } from "../../platform/commands/commands";
import {
  ViewRoot,
  type IWorkbenchView,
} from "../../services/workbench-view-registry";
import { ITerminalGroupService } from "./terminal-group-service";
import { ITerminalService, type TerminalState } from "./terminal-service";

interface XtermInstance {
  readonly host: HTMLElement;
  readonly terminal: Terminal;
  readonly fit: FitAddon;
  readonly store: DisposableStore;
  output: string;
}

/**
 * Panel view following VS Code's TerminalTabbedView split: the Panel owns the
 * title/toggle actions, while xterm instances and the optional side tabs live
 * in the view body.
 */
@injectable()
export class TerminalPane extends Disposable implements IWorkbenchView {
  readonly id = "zaw.terminal.panel";

  private readonly instances = new Map<string, XtermInstance>();
  private readonly instanceList = createElement("div", {
    ariaLabel: "Terminal instances",
    className: "agent-terminal-instance-list",
    role: "tablist",
  });
  private readonly terminalStage = createElement("div", {
    className: "agent-terminal-stage",
  });
  private readonly emptyState = createElement("div", {
    className: "agent-terminal-empty",
    textContent: "没有打开的终端",
  });
  private readonly body = createElement("div", {
    className: "agent-terminal-tabbed-view",
  });
  private readonly activeLabel = createElement("span", {
    className: "agent-terminal-active-label",
  });
  private readonly pane = createElement("section", {
    ariaLabel: "Terminal panel",
    className: "agent-terminal-panel",
  });
  private readonly killActionHost = createElement("span");

  constructor(
    @inject(ViewRoot) root: HTMLElement,
    @inject(ITerminalService) private readonly terminals: ITerminalService,
    @inject(ITerminalGroupService)
    private readonly group: ITerminalGroupService,
    @inject(ICommandService) private readonly commands: ICommandService,
  ) {
    super();
    const header = createElement("header", {
      className: "agent-terminal-header",
    });
    const panelTabs = createElement("div", {
      ariaLabel: "Panel views",
      className: "agent-terminal-panel-tabs",
      role: "tablist",
    });
    const terminalTab = createElement("button", {
      className: "agent-terminal-panel-tab",
      textContent: "Terminal",
    });
    terminalTab.type = "button";
    terminalTab.setAttribute("aria-selected", "true");
    terminalTab.setAttribute("role", "tab");
    panelTabs.append(terminalTab);

    const actions = createElement("div", {
      className: "agent-terminal-actions",
    });
    actions.append(
      this.activeLabel,
      this.action(
        "add",
        "New Terminal",
        () => void this.commands.executeCommand("zaw.terminal.create"),
      ),
      this.action(
        "trash",
        "Kill the Active Terminal",
        () => {
          const resource = this.terminals.activeTerminal;
          if (resource)
            void this.commands.executeCommand("zaw.terminal.dispose", resource);
        },
        this.killActionHost,
      ),
      this.action(
        "close",
        "Hide Panel",
        () => void this.commands.executeCommand("zaw.terminal.toggle"),
      ),
    );
    header.append(panelTabs, actions);
    this.terminalStage.append(this.emptyState);
    this.body.append(this.terminalStage, this.instanceList);
    this.pane.append(header, this.body);
    root.replaceChildren(this.pane);

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => this.fitActiveTerminal());
      observer.observe(this.terminalStage);
      this._register({ dispose: () => observer.disconnect() });
    }
    this._register(this.terminals.onDidChange(() => this.update()));
    this._register(this.group.onDidChange(() => this.update()));
    this.update();
  }

  private update(): void {
    this.pane.hidden = !this.group.open;
    this.pane.dataset.collapsed = String(this.group.collapsed);
    const resources = new Set(
      this.terminals.terminals.map((terminal) => terminal.resource),
    );
    for (const [resource, instance] of this.instances) {
      if (resources.has(resource)) continue;
      instance.store.dispose();
      instance.host.remove();
      this.instances.delete(resource);
    }
    for (const terminal of this.terminals.terminals) {
      const instance = this.instances.get(terminal.resource);
      if (instance) this.writeOutput(instance, terminal.output);
      else this.createInstance(terminal);
    }
    this.renderInstanceList();
    this.selectActiveInstance();
    const empty = this.terminals.terminals.length === 0;
    this.emptyState.hidden = !empty;
    this.killActionHost.hidden = empty;
  }

  private createInstance(state: TerminalState): void {
    const host = createElement("div", {
      ariaLabel: state.title,
      className: "agent-xterm-instance",
    });
    host.dataset.resource = state.resource;
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        "var(--zaw-monospace-font, 'SFMono-Regular', Consolas, monospace)",
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 1000,
      theme: this.xtermTheme(),
    });
    const fit = new FitAddon();
    const store = new DisposableStore();
    terminal.loadAddon(fit);
    terminal.open(host);
    store.add(
      terminal.onData((data) => {
        void this.commands.executeCommand(
          "zaw.terminal.input",
          state.resource,
          data,
        );
      }),
    );
    store.add(terminal);
    const instance = { fit, host, output: "", store, terminal };
    this.instances.set(state.resource, instance);
    this.terminalStage.append(host);
    this.writeOutput(instance, state.output);
  }

  private writeOutput(instance: XtermInstance, output: string): void {
    if (output === instance.output) return;
    if (output.startsWith(instance.output)) {
      instance.terminal.write(output.slice(instance.output.length));
    } else {
      instance.terminal.reset();
      instance.terminal.write(output);
    }
    instance.output = output;
  }

  private renderInstanceList(): void {
    const existing = new Map(
      Array.from(this.instanceList.children).map((element) => [
        (element as HTMLElement).dataset.resource,
        element as HTMLButtonElement,
      ]),
    );
    const tabs: HTMLButtonElement[] = [];
    for (const terminal of this.terminals.terminals) {
      const tab =
        existing.get(terminal.resource) ??
        createElement("button", { className: "agent-terminal-instance" });
      tab.type = "button";
      tab.dataset.resource = terminal.resource;
      tab.textContent = terminal.title;
      tab.title = terminal.title;
      tab.setAttribute("role", "tab");
      tab.setAttribute(
        "aria-selected",
        String(terminal.resource === this.terminals.activeTerminal),
      );
      tab.dataset.active = String(
        terminal.resource === this.terminals.activeTerminal,
      );
      if (!existing.has(terminal.resource)) {
        tab.addEventListener(
          "click",
          () =>
            void this.commands.executeCommand(
              "zaw.terminal.select",
              tab.dataset.resource,
            ),
        );
      }
      existing.delete(terminal.resource);
      tabs.push(tab);
    }
    for (const stale of existing.values()) stale.remove();
    this.instanceList.replaceChildren(...tabs);
    this.body.classList.toggle(
      "show-instance-list",
      this.terminals.terminals.length > 1,
    );
  }

  private selectActiveInstance(): void {
    const activeResource = this.terminals.activeTerminal;
    for (const [resource, instance] of this.instances) {
      const active = resource === activeResource;
      instance.host.hidden = !active;
      instance.host.setAttribute("aria-hidden", String(!active));
    }
    const active = this.terminals.terminals.find(
      (terminal) => terminal.resource === activeResource,
    );
    this.activeLabel.textContent = active?.title ?? "";
    this.activeLabel.hidden = !active;
    queueMicrotask(() => this.fitActiveTerminal());
  }

  private fitActiveTerminal(): void {
    if (!this.group.open || this.pane.hidden) return;
    const active = this.terminals.activeTerminal;
    const instance = active ? this.instances.get(active) : undefined;
    if (!instance || instance.host.clientWidth === 0) return;
    try {
      instance.fit.fit();
      void this.commands.executeCommand(
        "zaw.terminal.resize",
        active,
        instance.terminal.cols,
        instance.terminal.rows,
      );
    } catch {
      // The panel can be measured between grid visibility transitions.
    }
  }

  private xtermTheme(): { background: string; foreground: string } {
    const style = getComputedStyle(this.pane);
    return {
      background:
        style.getPropertyValue("--zaw-terminal-background").trim() || "#000000",
      foreground:
        style.getPropertyValue("--zaw-terminal-foreground").trim() || "#cccccc",
    };
  }

  private action(
    icon: string,
    label: string,
    run: () => void,
    host = createElement("span"),
  ): HTMLElement {
    const action = this._register(
      new IconActionButton(host, { ariaLabel: label, icon }),
    );
    this._register(action.onDidClick(run));
    return host;
  }
}
