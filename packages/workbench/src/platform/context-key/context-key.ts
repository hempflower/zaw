import { type IDisposable, type Event } from "@zaw/ui";

export const IContextKeyService = Symbol.for("IContextKeyService");

/**
 * A typed context key that holds a value and emits on change.
 */
export interface IContextKey<T> extends IDisposable {
  /** Set the value. Only fires change event if the value actually changed. */
  set(value: T): void;
  /** Get the current value. */
  get(): T;
  /** Reset to the default value. */
  reset(): void;
}

/**
 * Context Key expression for composing boolean conditions.
 * Used by Actions, Menus, Views, and Keybindings to express enablement/visibility.
 */
export type ContextKeyExpression =
  | { kind: "has"; key: string }
  | { kind: "equals"; key: string; value: unknown }
  | { kind: "not"; expr: ContextKeyExpression }
  | { kind: "and"; exprs: ContextKeyExpression[] }
  | { kind: "or"; exprs: ContextKeyExpression[] }
  | { kind: "true" }
  | { kind: "false" };

/** Convenience constructors for expressions. */
export const ContextKeyExpr = {
  has: (key: string): ContextKeyExpression => ({ kind: "has", key }),
  equals: (key: string, value: unknown): ContextKeyExpression => ({
    kind: "equals",
    key,
    value,
  }),
  not: (expr: ContextKeyExpression): ContextKeyExpression => ({
    kind: "not",
    expr,
  }),
  and: (...exprs: ContextKeyExpression[]): ContextKeyExpression => ({
    kind: "and",
    exprs,
  }),
  or: (...exprs: ContextKeyExpression[]): ContextKeyExpression => ({
    kind: "or",
    exprs,
  }),
  true: { kind: "true" } as ContextKeyExpression,
  false: { kind: "false" } as ContextKeyExpression,
};

/**
 * Raw context key definition. Creates typed IContextKey instances via the service.
 */
export class RawContextKey<T> {
  readonly key: string;
  readonly defaultValue: T;

  constructor(key: string, defaultValue: T) {
    this.key = key;
    this.defaultValue = defaultValue;
  }

  bindTo(service: IContextKeyService): IContextKey<T> {
    return service.createKey(this.key, this.defaultValue);
  }
}

/**
 * Service for observing and composing context keys.
 * Domain services update keys they own; UI subscribes to expressions.
 */
export interface IContextKeyService {
  /** Fires whenever any tracked context value changes. */
  readonly onDidChangeContext: Event<void>;

  /** Create a typed context key. The owner is responsible for updating it. */
  createKey<T>(key: string, defaultValue: T): IContextKey<T>;

  /** Create a disposable child scope that inherits values from this scope. */
  createScoped(): IContextKeyService;

  /** Get the current raw value of a context key. */
  getValue<T>(key: string): T | undefined;

  /** Evaluate a ContextKeyExpression against current context values. */
  evaluate(expr: ContextKeyExpression): boolean;

  /**
   * Subscribe to a specific expression. The callback fires when the expression
   * result changes. Returns a disposable.
   */
  onDidChangeExpression(
    expr: ContextKeyExpression,
    callback: (value: boolean) => void,
  ): IDisposable;

  /** Dispose the service and any parent listeners held by a child scope. */
  dispose(): void;
}
