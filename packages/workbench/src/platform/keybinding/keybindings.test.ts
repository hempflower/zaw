import { describe, expect, it } from "vitest";
import { CommandRegistry } from "../commands/command-service";
import { KeybindingRegistry } from "./keybindings";

describe("KeybindingRegistry", () => {
  it("rejects bindings for commands that do not exist", () => {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry(commands);
    expect(() =>
      keybindings.registerKeybinding({ key: "Ctrl+K", command: "missing" }),
    ).toThrow("unknown command");
    commands.registerCommand("zaw.test", () => undefined);
    expect(keybindings.all()).toHaveLength(0);
    keybindings.registerKeybinding({ key: "Ctrl+K", command: "zaw.test" });
    expect(keybindings.all()).toHaveLength(1);
  });
});
