import { Disposable, Emitter, type IDisposable } from "@zaw/ui";
import { injectable } from "inversify";
import {
  IContextKeyService,
  type IContextKeyService as ContextKeyService,
} from "../context-key/context-key";
import type {
  CommandDescriptor,
  CommandHandler,
  ICommandRegistry,
  ICommandService,
  ServicesAccessor,
} from "./commands";

interface RegisteredCommand {
  descriptor: CommandDescriptor;
  handler: CommandHandler;
}

@injectable()
export class CommandRegistry
  extends Disposable
  implements ICommandRegistry, ICommandService
{
  private readonly commands = new Map<string, RegisteredCommand>();
  private readonly _onDidRegister = this._register(new Emitter<string>());
  private readonly _onDidUnregister = this._register(new Emitter<string>());

  readonly onDidRegister = this._onDidRegister.event;
  readonly onDidUnregister = this._onDidUnregister.event;

  constructor() {
    super();
  }

  // ── ICommandRegistry ──

  registerCommand<TArgs extends unknown[]>(
    id: string,
    handler: CommandHandler<TArgs>,
    descriptor?: Omit<CommandDescriptor, "id">,
  ): IDisposable {
    if (this.commands.has(id)) {
      throw new Error(`Command "${id}" is already registered`);
    }
    this.commands.set(id, {
      descriptor: { id, ...descriptor },
      handler: handler as CommandHandler,
    });
    this._onDidRegister.fire(id);
    return {
      dispose: () => {
        if (this.commands.get(id)?.descriptor.id === id) {
          this.commands.delete(id);
          this._onDidUnregister.fire(id);
        }
      },
    };
  }

  hasCommand(id: string): boolean {
    return this.commands.has(id);
  }

  getCommand(id: string): CommandDescriptor | undefined {
    return this.commands.get(id)?.descriptor;
  }

  // ── ICommandService ──

  async executeCommand<TResult = void>(
    id: string,
    ...args: unknown[]
  ): Promise<TResult> {
    const registered = this.commands.get(id);
    if (!registered) {
      throw new Error(`Command "${id}" is not registered`);
    }

    // Validate parameters if a validator is provided
    if (
      registered.descriptor.validate &&
      !registered.descriptor.validate(...args)
    ) {
      throw new Error(`Command "${id}" parameter validation failed`);
    }
    if (
      registered.descriptor.precondition &&
      !this.servicesAccessor
        .get<ContextKeyService>(IContextKeyService)
        .evaluate(registered.descriptor.precondition)
    ) {
      throw new Error(`Command "${id}" precondition failed`);
    }

    // Execute the handler. The ServicesAccessor is provided by the caller
    // or constructed from the Inversify container at the call site.
    const result = registered.handler(this.servicesAccessor, ...args);
    return result as TResult;
  }

  /**
   * Set the services accessor for DI resolution within command handlers.
   * Must be called after the DI container is assembled.
   */
  setServicesAccessor(accessor: ServicesAccessor): void {
    this.servicesAccessor = accessor;
  }

  private servicesAccessor: ServicesAccessor = {
    get: <T>(_id: symbol): T => {
      throw new Error(
        "ServicesAccessor not yet configured. " +
          "Call commandRegistry.setServicesAccessor() after container assembly.",
      );
    },
  };
}
