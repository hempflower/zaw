// @vitest-environment happy-dom

import { Emitter } from "@zaw/ui";
import { describe, expect, it } from "vitest";
import type { ICommandService } from "../../platform/commands/commands";
import type { ITerminalService, TerminalState } from "./terminal-service";
import type { ITerminalGroupService } from "./terminal-group-service";
import { TerminalPane } from "./terminal-view";

describe("TerminalPane", () => {
  it("shows a localized empty state when no terminal is open", () => {
    const root = document.createElement("div");
    new TerminalPane(
      root,
      {
        activeTerminal: null,
        onDidChange: new Emitter<void>().event,
        terminals: [],
      } as unknown as ITerminalService,
      {
        collapsed: false,
        onDidChange: new Emitter<void>().event,
        open: true,
      } as ITerminalGroupService,
      { executeCommand: async () => undefined } as ICommandService,
    );
    expect(root.querySelector(".agent-terminal-empty")?.textContent).toBe(
      "没有打开的终端",
    );
  });

  it("updates output without replacing its root or a session view sibling", () => {
    const terminalChanges = new Emitter<void>();
    const groupChanges = new Emitter<void>();
    const state: TerminalState[] = [
      { resource: "terminal:/one", title: "One", output: "first" },
    ];
    const terminals = {
      activeTerminal: "terminal:/one",
      onDidChange: terminalChanges.event,
      terminals: state,
    } as unknown as ITerminalService;
    const group = {
      collapsed: false,
      onDidChange: groupChanges.event,
      open: true,
    } as ITerminalGroupService;
    const commands = {
      executeCommand: async () => undefined,
    } as ICommandService;
    const root = document.createElement("div");
    const sibling = document.createElement("section");
    document.body.append(root, sibling);
    new TerminalPane(root, terminals, group, commands);
    const pane = root.firstElementChild;
    state[0].output = "second";
    terminalChanges.fire();
    expect(root.firstElementChild).toBe(pane);
    expect(sibling.isConnected).toBe(true);
    expect(root.querySelector(".xterm")).not.toBeNull();
  });
});
