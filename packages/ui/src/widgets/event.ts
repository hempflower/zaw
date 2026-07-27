export interface IDisposable {
  dispose(): void;
}

export type Event<T> = (
  listener: (event: T) => void,
  thisArgs?: unknown,
  disposables?: IDisposable[] | DisposableStore,
) => IDisposable;

type Listener<T> = {
  callback: (event: T) => void;
  thisArgs?: unknown;
};

export class DisposableStore implements IDisposable {
  private readonly disposables: IDisposable[] = [];
  private isDisposed = false;

  add<T extends IDisposable>(disposable: T): T {
    if (this.isDisposed) {
      disposable.dispose();
    } else {
      this.disposables.push(disposable);
    }
    return disposable;
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}

export class Disposable implements IDisposable {
  protected readonly disposables = new DisposableStore();

  protected _register<T extends IDisposable>(disposable: T): T {
    return this.disposables.add(disposable);
  }

  dispose(): void {
    this.disposables.dispose();
  }
}

export class Emitter<T> implements IDisposable {
  private listeners: Listener<T>[] = [];
  private deliveryQueue: Listener<T>[] | undefined;

  readonly event: Event<T> = (listener, thisArgs, disposables) => {
    const entry: Listener<T> = { callback: listener, thisArgs };
    this.listeners.push(entry);

    const result = {
      dispose: () => {
        const index = this.listeners.indexOf(entry);
        if (index >= 0) this.listeners.splice(index, 1);
      },
    };

    if (Array.isArray(disposables)) {
      disposables.push(result);
    } else {
      disposables?.add(result);
    }

    return result;
  };

  fire(event: T): void {
    if (this.listeners.length === 0) return;
    this.deliveryQueue = this.listeners.slice(0);
    try {
      for (const listener of this.deliveryQueue) {
        if (this.listeners.includes(listener)) {
          listener.callback.call(listener.thisArgs, event);
        }
      }
    } finally {
      this.deliveryQueue = undefined;
    }
  }

  dispose(): void {
    this.listeners = [];
    this.deliveryQueue = undefined;
  }
}
