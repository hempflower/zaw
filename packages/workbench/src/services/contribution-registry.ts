import { Disposable, Emitter, type Event, type IDisposable } from "@zaw/ui";

export type ContributionDescriptor<TID extends string> = {
  factory: unknown;
  id: TID;
  order?: number;
  when?: () => boolean;
};

export class ContributionRegistry<
  TID extends string,
  TDescriptor extends ContributionDescriptor<TID>,
> extends Disposable {
  private readonly descriptors = new Map<TID, TDescriptor>();
  private readonly _onDidRegister = this._register(new Emitter<TDescriptor>());
  readonly onDidRegister: Event<TDescriptor> = this._onDidRegister.event;

  all() {
    return [...this.descriptors.values()].sort(
      (left, right) => (left.order ?? 0) - (right.order ?? 0),
    );
  }

  get(id: TID) {
    return this.descriptors.get(id);
  }

  register(descriptor: TDescriptor): IDisposable {
    if (this.descriptors.has(descriptor.id)) {
      throw new Error(`Contribution ${descriptor.id} is already registered`);
    }
    this.descriptors.set(descriptor.id, descriptor);
    this._onDidRegister.fire(descriptor);
    return {
      dispose: () => {
        if (this.descriptors.get(descriptor.id) === descriptor) {
          this.descriptors.delete(descriptor.id);
        }
      },
    };
  }
}
