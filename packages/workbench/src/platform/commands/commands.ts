import { type IDisposable } from "@zaw/ui";
import type { ContextKeyExpression } from "../context-key/context-key";

export const ICommandRegistry = Symbol.for("ICommandRegistry");
export const ICommandService = Symbol.for("ICommandService");

/**
 * A command handler function. Receives a services accessor for DI resolution
 * and the command arguments.
 */
export type CommandHandler<TArgs extends unknown[] = unknown[]> = (
  accessor: ServicesAccessor,
  ...args: TArgs
) => void | Promise<void>;

/**
 * Provides access to registered services by their symbol identifier.
 * In practice this is the Inversify container.
 */
export interface ServicesAccessor {
  get<T>(serviceIdentifier: symbol): T;
}

/**
 * Descriptor for a registered command.
 */
export interface CommandDescriptor {
  /** Unique command identifier, e.g. "zaw.session.create" */
  readonly id: string;
  /** Human-readable category for grouping in the command palette */
  readonly category?: string;
  /** Shared expression used by actions, keybindings and view visibility. */
  readonly precondition?: ContextKeyExpression;
  /** Optional parameter validation */
  readonly validate?: (...args: unknown[]) => boolean;
}

/**
 * Registry for command handlers. Commands are registered by ID with a handler
 * function. The handler receives a ServicesAccessor for DI resolution.
 */
export interface ICommandRegistry {
  /**
   * Register a command handler. Returns a disposable that unregisters the command.
   * Throws if a command with the same ID is already registered.
   */
  registerCommand<TArgs extends unknown[]>(
    id: string,
    handler: CommandHandler<TArgs>,
    descriptor?: Omit<CommandDescriptor, "id">,
  ): IDisposable;

  /** Check if a command is registered */
  hasCommand(id: string): boolean;

  /** Get the descriptor for a registered command */
  getCommand(id: string): CommandDescriptor | undefined;
}

/**
 * Service for executing commands. This is the single entry point for all
 * UI behavior — Views, Menus, and Keybindings all use executeCommand().
 */
export interface ICommandService {
  /**
   * Execute a command by ID. Returns a promise that resolves when the command
   * completes, or rejects if the command is not found or validation fails.
   */
  executeCommand<TResult = void>(
    id: string,
    ...args: unknown[]
  ): Promise<TResult>;
}
