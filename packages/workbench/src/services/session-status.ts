import { Disposable, Emitter, type Event, type IDisposable } from "@zaw/ui";
import type { SessionCatalogItem } from "./session-catalog";

export const ISessionStatusRegistry = Symbol.for("ISessionStatusRegistry");

export type SessionStatusPresentation = Readonly<{
  icon: string;
  label: string;
  state: string;
}>;

export type SessionStatusDescriptor = SessionStatusPresentation &
  Readonly<{
    id: string;
    matches: (item: SessionCatalogItem | undefined) => boolean;
    order?: number;
  }>;

export interface ISessionStatusRegistry {
  readonly onDidChange: Event<void>;
  register(descriptor: SessionStatusDescriptor): IDisposable;
  resolve(item: SessionCatalogItem | undefined): SessionStatusPresentation;
}

export class SessionStatusRegistry
  extends Disposable
  implements ISessionStatusRegistry
{
  private readonly descriptors = new Map<string, SessionStatusDescriptor>();
  private readonly emitter = this._register(new Emitter<void>());
  readonly onDidChange = this.emitter.event;

  register(descriptor: SessionStatusDescriptor): IDisposable {
    if (this.descriptors.has(descriptor.id))
      throw new Error(`Session status "${descriptor.id}" is registered`);
    this.descriptors.set(descriptor.id, descriptor);
    this.emitter.fire();
    return {
      dispose: () => {
        if (this.descriptors.get(descriptor.id) !== descriptor) return;
        this.descriptors.delete(descriptor.id);
        this.emitter.fire();
      },
    };
  }

  resolve(item: SessionCatalogItem | undefined): SessionStatusPresentation {
    const descriptor = [...this.descriptors.values()]
      .sort(
        (left, right) =>
          (left.order ?? 0) - (right.order ?? 0) ||
          left.id.localeCompare(right.id),
      )
      .find((candidate) => candidate.matches(item));
    return (
      descriptor ?? { icon: "circle-outline", label: "Idle", state: "idle" }
    );
  }
}
