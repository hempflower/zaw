import type { IDisposable } from "@zaw/ui";
import type { ICommandRegistry } from "../../platform/commands/commands";
import { ITerminalGroupService } from "./terminal-group-service";
import { ITerminalService } from "./terminal-service";

/** Feature-owned command registrations; views, menus and keybindings share these IDs. */
export function registerTerminalCommands(
  commands: ICommandRegistry,
): IDisposable[] {
  return [
    commands.registerCommand(
      "zaw.terminal.create",
      (accessor) => accessor.get<ITerminalService>(ITerminalService).create(),
      { category: "Terminal" },
    ),
    commands.registerCommand(
      "zaw.terminal.select",
      (accessor, resource) =>
        accessor
          .get<ITerminalService>(ITerminalService)
          .select(resource as string),
      {
        category: "Terminal",
        validate: (resource) => typeof resource === "string",
      },
    ),
    commands.registerCommand(
      "zaw.terminal.dispose",
      (accessor, resource) =>
        accessor
          .get<ITerminalService>(ITerminalService)
          .disposeTerminal(resource as string),
      {
        category: "Terminal",
        validate: (resource) => typeof resource === "string",
      },
    ),
    commands.registerCommand(
      "zaw.terminal.input",
      (accessor, resource, data) =>
        accessor
          .get<ITerminalService>(ITerminalService)
          .input(resource as string, data as string),
      {
        category: "Terminal",
        validate: (resource, data) =>
          typeof resource === "string" && typeof data === "string",
      },
    ),
    commands.registerCommand(
      "zaw.terminal.resize",
      (accessor, resource, cols, rows) =>
        accessor
          .get<ITerminalService>(ITerminalService)
          .resize(resource as string, cols as number, rows as number),
      {
        category: "Terminal",
        validate: (resource, cols, rows) =>
          typeof resource === "string" &&
          typeof cols === "number" &&
          typeof rows === "number",
      },
    ),
    commands.registerCommand(
      "zaw.terminal.toggle",
      (accessor) =>
        accessor.get<ITerminalGroupService>(ITerminalGroupService).toggleOpen(),
      { category: "Terminal" },
    ),
  ];
}
