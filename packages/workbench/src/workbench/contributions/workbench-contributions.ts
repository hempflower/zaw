import { Disposable, Emitter, type Event, type IDisposable } from "@zaw/ui";
import { Container, injectable } from "inversify";
import {
  ILifecycleService,
  LifecyclePhase,
} from "../../platform/lifecycle/lifecycle";

/**
 * A contribution that participates in the Workbench lifecycle.
 * Contributions are instantiated by the DI container at their declared phase.
 */
export const IWorkbenchContribution = Symbol.for("IWorkbenchContribution");
export interface IWorkbenchContribution {
  dispose?(): void;
}

export interface WorkbenchContributionDescriptor {
  readonly id: string;
  readonly ctor: new (...args: any[]) => IWorkbenchContribution;
  readonly phase: LifecyclePhase;
}

export type ContributionTiming = Readonly<{
  durationMs: number;
  id: string;
  phase: LifecyclePhase;
}>;

export const IWorkbenchContributionsRegistry = Symbol.for(
  "IWorkbenchContributionsRegistry",
);

export interface IWorkbenchContributionsRegistry {
  readonly onDidInstantiate: Event<ContributionTiming>;
  /** Register a contribution descriptor. Returns a disposable to unregister. */
  register(descriptor: WorkbenchContributionDescriptor): IDisposable;

  /**
   * Start the contribution system. Must be called once after all contributions
   * are registered. The container is used to resolve contribution constructors.
   */
  start(lifecycle: ILifecycleService, container: Container): void;
}

@injectable()
export class WorkbenchContributionsRegistry
  extends Disposable
  implements IWorkbenchContributionsRegistry
{
  private readonly descriptors = new Map<
    string,
    WorkbenchContributionDescriptor
  >();
  private readonly instances = new Map<string, IWorkbenchContribution>();
  private readonly timingEmitter = this._register(
    new Emitter<ContributionTiming>(),
  );
  readonly onDidInstantiate = this.timingEmitter.event;
  private started = false;
  private currentPhase = LifecyclePhase.Starting;
  private container: Container | null = null;

  register(descriptor: WorkbenchContributionDescriptor): IDisposable {
    if (this.descriptors.has(descriptor.id)) {
      throw new Error(
        `Workbench contribution "${descriptor.id}" is already registered`,
      );
    }
    this.descriptors.set(descriptor.id, descriptor);

    // If we already passed this phase, start immediately
    if (this.started && this.currentPhase >= descriptor.phase) {
      this.instantiateContribution(descriptor);
    }

    return {
      dispose: () => {
        this.descriptors.delete(descriptor.id);
        const instance = this.instances.get(descriptor.id);
        if (instance) {
          try {
            instance.dispose?.();
          } catch (error) {
            console.error(
              `Error disposing contribution "${descriptor.id}":`,
              error,
            );
          }
          this.instances.delete(descriptor.id);
        }
      },
    };
  }

  /**
   * Called by Workbench startup to begin creating contributions.
   * Contributions are instantiated via the Inversify container, so their
   * @inject() dependencies are resolved automatically.
   */
  start(lifecycle: ILifecycleService, container: Container): void {
    this.started = true;
    this.container = container;
    this.currentPhase = lifecycle.phase;

    // Instantiate contributions for the current phase
    this.instantiatePhase(lifecycle.phase);

    // Listen for phase advances
    this._register(
      lifecycle.onDidChangePhase((phase) => {
        this.currentPhase = phase;
        this.instantiatePhase(phase);
      }),
    );

    // Dispose all contributions on shutdown, in reverse registration order
    this._register(
      lifecycle.onWillShutdown(() => {
        for (const [id, instance] of [...this.instances.entries()].reverse()) {
          try {
            instance.dispose?.();
          } catch (error) {
            console.error(`Error disposing contribution "${id}":`, error);
          }
          this.instances.delete(id);
        }
      }),
    );
  }

  private instantiatePhase(phase: LifecyclePhase): void {
    for (const descriptor of this.descriptors.values()) {
      if (descriptor.phase !== phase) continue;
      if (this.instances.has(descriptor.id)) continue;
      this.instantiateContribution(descriptor);
    }
  }

  private instantiateContribution(
    descriptor: WorkbenchContributionDescriptor,
  ): void {
    const started = performance.now();
    try {
      const instance = this.container
        ? this.container.get<IWorkbenchContribution>(descriptor.ctor)
        : new descriptor.ctor();
      this.instances.set(descriptor.id, instance);
      this.timingEmitter.fire({
        id: descriptor.id,
        phase: descriptor.phase,
        durationMs: performance.now() - started,
      });
    } catch (error) {
      console.error(
        `Failed to instantiate contribution "${descriptor.id}":`,
        error,
      );
    }
  }
}
