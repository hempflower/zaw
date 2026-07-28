import { Emitter, type Event, type IDisposable } from "@zaw/ui";
import type { ContextKeyExpression } from "../context-key/context-key";

export const IActionRegistry = Symbol.for("IActionRegistry");

export type MenuID = "chat-input" | "context" | "titlebar" | "view-title";

/** Declarative presentation for an existing command; handlers never live here. */
export type ActionDescriptor = Readonly<{
  checkedWhen?: ContextKeyExpression;
  command: string;
  group?: "center" | "left" | "navigation" | "right";
  icon?: string;
  id: string;
  menu: MenuID;
  order?: number;
  precondition?: ContextKeyExpression;
  title: string;
}>;

export interface IActionRegistry {
  readonly onDidChange: Event<void>;
  actions(menu: MenuID): readonly ActionDescriptor[];
  registerAction(descriptor: ActionDescriptor): IDisposable;
}

export class ActionRegistry implements IActionRegistry {
  private readonly entries = new Map<string, ActionDescriptor>();
  private readonly emitter = new Emitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly commands: { hasCommand(id: string): boolean }) {}

  actions(menu: MenuID): readonly ActionDescriptor[] {
    return [...this.entries.values()]
      .filter((action) => action.menu === menu)
      .sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
      );
  }

  registerAction(descriptor: ActionDescriptor): IDisposable {
    if (this.entries.has(descriptor.id)) {
      throw new Error(`Action "${descriptor.id}" is already registered`);
    }
    if (!this.commands.hasCommand(descriptor.command)) {
      throw new Error(
        `Action "${descriptor.id}" references unknown command "${descriptor.command}"`,
      );
    }
    this.entries.set(descriptor.id, descriptor);
    this.emitter.fire();
    return {
      dispose: () => {
        if (this.entries.get(descriptor.id) !== descriptor) return;
        this.entries.delete(descriptor.id);
        this.emitter.fire();
      },
    };
  }
}
