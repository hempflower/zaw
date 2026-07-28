import { type Event } from "@zaw/ui";

export const ILifecycleService = Symbol.for("ILifecycleService");

export enum LifecyclePhase {
  /** Workbench is being constructed; services are not yet ready. */
  Starting = 1,
  /** DI container is ready; contributions can start. */
  Ready = 2,
  /** Layout has been restored; contributions that depend on UI state can run. */
  Restored = 3,
  /** Low-priority work that must not block first paint. */
  Eventually = 4,
}

export interface ILifecycleService {
  readonly onDidChangePhase: Event<LifecyclePhase>;
  readonly onWillShutdown: Event<void>;
  readonly phase: LifecyclePhase;

  /** Returns a promise that resolves when the given phase is reached. */
  when(phase: LifecyclePhase): Promise<void>;

  /** Advance to the next phase. Only valid to call once per phase. */
  setPhase(phase: LifecyclePhase): void;

  /** Initiate shutdown; contributions should clean up. */
  shutdown(): void;
}
