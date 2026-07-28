import { Emitter, type Event, type IDisposable } from "@zaw/ui";
import type { ContextKeyExpression } from "../context-key/context-key";

export const IKeybindingRegistry = Symbol.for("IKeybindingRegistry");

export type KeybindingDescriptor = Readonly<{
  command: string;
  key: string;
  precondition?: ContextKeyExpression;
}>;

export interface IKeybindingRegistry {
  readonly onDidChange: Event<void>;
  all(): readonly KeybindingDescriptor[];
  registerKeybinding(descriptor: KeybindingDescriptor): IDisposable;
}

export class KeybindingRegistry implements IKeybindingRegistry {
  private readonly entries = new Map<string, KeybindingDescriptor>();
  private readonly emitter = new Emitter<void>();
  readonly onDidChange = this.emitter.event;
  constructor(private readonly commands: { hasCommand(id: string): boolean }) {}
  all(): readonly KeybindingDescriptor[] {
    return [...this.entries.values()];
  }
  registerKeybinding(descriptor: KeybindingDescriptor): IDisposable {
    const id = `${descriptor.key}:${descriptor.command}`;
    if (this.entries.has(id))
      throw new Error(`Keybinding "${id}" is already registered`);
    if (!this.commands.hasCommand(descriptor.command))
      throw new Error(
        `Keybinding "${id}" references unknown command "${descriptor.command}"`,
      );
    this.entries.set(id, descriptor);
    this.emitter.fire();
    return {
      dispose: () => {
        if (this.entries.get(id) !== descriptor) return;
        this.entries.delete(id);
        this.emitter.fire();
      },
    };
  }
}
