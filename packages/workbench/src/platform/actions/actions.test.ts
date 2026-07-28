import { describe, expect, it } from "vitest";
import { CommandRegistry } from "../commands/command-service";
import { ActionRegistry } from "./actions";

describe("ActionRegistry", () => {
  it("requires commands and orders menu actions", () => {
    const commands = new CommandRegistry();
    const actions = new ActionRegistry(commands);
    expect(() =>
      actions.registerAction({
        id: "missing",
        command: "none",
        menu: "titlebar",
        title: "Missing",
      }),
    ).toThrow("unknown command");
    commands.registerCommand("zaw.test", () => undefined);
    actions.registerAction({
      id: "later",
      command: "zaw.test",
      menu: "titlebar",
      order: 2,
      title: "Later",
    });
    actions.registerAction({
      id: "first",
      command: "zaw.test",
      menu: "titlebar",
      order: 1,
      title: "First",
    });
    expect(actions.actions("titlebar").map(({ id }) => id)).toEqual([
      "first",
      "later",
    ]);
  });
});
