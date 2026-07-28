import { Disposable, Emitter, type Event, type IDisposable } from "@zaw/ui";
import { injectable } from "inversify";
import type {
  ContextKeyExpression,
  IContextKey,
  IContextKeyService,
} from "./context-key";

interface TrackedKey<T> {
  defaultValue: T;
  value: T;
}

@injectable()
export class ContextKeyService
  extends Disposable
  implements IContextKeyService
{
  private readonly keys = new Map<string, TrackedKey<unknown>>();
  private readonly changeEmitter = this._register(new Emitter<void>());
  readonly onDidChangeContext = this.changeEmitter.event;
  private parent: IContextKeyService | undefined;

  createKey<T>(key: string, defaultValue: T): IContextKey<T> {
    if (this.keys.has(key)) {
      throw new Error(`Context key "${key}" is already registered`);
    }

    const tracked: TrackedKey<T> = { defaultValue, value: defaultValue };
    this.keys.set(key, tracked as TrackedKey<unknown>);

    const self = this;
    const disposable = {
      dispose: () => {
        if (self.keys.get(key) === tracked) {
          self.keys.delete(key);
        }
      },
    };

    return {
      set(value: T): void {
        if (tracked.value === value) return;
        tracked.value = value;
        self.changeEmitter.fire();
      },
      get(): T {
        return tracked.value;
      },
      reset(): void {
        this.set(defaultValue);
      },
      dispose: disposable.dispose,
    };
  }

  getValue<T>(key: string): T | undefined {
    const local = this.keys.get(key);
    return local ? (local.value as T) : this.parent?.getValue<T>(key);
  }

  evaluate(expr: ContextKeyExpression): boolean {
    switch (expr.kind) {
      case "true":
        return true;
      case "false":
        return false;
      case "has": {
        const value = this.getValue(expr.key);
        return value !== undefined && value !== false && value !== null;
      }
      case "equals": {
        const value = this.getValue(expr.key);
        return value === expr.value;
      }
      case "not":
        return !this.evaluate(expr.expr);
      case "and":
        return expr.exprs.every((e) => this.evaluate(e));
      case "or":
        return expr.exprs.some((e) => this.evaluate(e));
    }
  }

  onDidChangeExpression(
    expr: ContextKeyExpression,
    callback: (value: boolean) => void,
  ): IDisposable {
    let lastValue = this.evaluate(expr);
    const listener = this.onDidChangeContext(() => {
      const newValue = this.evaluate(expr);
      if (newValue !== lastValue) {
        lastValue = newValue;
        callback(newValue);
      }
    });
    return listener;
  }

  createScoped(): IContextKeyService {
    const scoped = new ContextKeyService();
    scoped.parent = this;
    scoped._register(
      this.onDidChangeContext(() => scoped.changeEmitter.fire()),
    );
    return scoped;
  }
}
