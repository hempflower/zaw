import { Disposable, Emitter, type Event, type IDisposable } from "@zaw/ui";
import { injectable } from "inversify";
import {
  ILifecycleService,
  LifecyclePhase,
} from "../../platform/lifecycle/lifecycle";

@injectable()
export class LifecycleService extends Disposable implements ILifecycleService {
  private _phase = LifecyclePhase.Starting;
  private readonly phaseEmitter = this._register(new Emitter<LifecyclePhase>());
  private readonly shutdownEmitter = this._register(new Emitter<void>());

  readonly onDidChangePhase = this.phaseEmitter.event;
  readonly onWillShutdown = this.shutdownEmitter.event;

  get phase(): LifecyclePhase {
    return this._phase;
  }

  async when(target: LifecyclePhase): Promise<void> {
    if (this._phase >= target) return;
    return new Promise<void>((resolve) => {
      const listener = this.onDidChangePhase((phase) => {
        if (phase >= target) {
          listener.dispose();
          resolve();
        }
      });
    });
  }

  setPhase(phase: LifecyclePhase): void {
    if (phase <= this._phase) {
      throw new Error(
        `Cannot move from phase ${this._phase} to ${phase}; phases must advance monotonically`,
      );
    }
    this._phase = phase;
    this.phaseEmitter.fire(phase);
  }

  shutdown(): void {
    this.shutdownEmitter.fire();
  }
}
