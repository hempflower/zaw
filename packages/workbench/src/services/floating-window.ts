import { inject, injectable } from "inversify";
import { IWorkbenchStorage } from "./workspace-ui-state";

export const IFloatingWindowService = Symbol.for("IFloatingWindowService");

export type FloatingWindowBounds = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export type FloatingWindowState = {
  bounds: FloatingWindowBounds;
  id: string;
  maximized: boolean;
  restoreBounds?: FloatingWindowBounds;
  title: string;
};

export interface IFloatingWindowService {
  close(): void;
  current(): FloatingWindowState | null;
  maximize(viewportWidth: number, viewportHeight: number): void;
  open(id: string, title: string, bounds: FloatingWindowBounds): void;
  restore(): void;
  updateBounds(bounds: FloatingWindowBounds): void;
}

@injectable()
export class FloatingWindowService implements IFloatingWindowService {
  private state: FloatingWindowState | null = null;

  constructor(@inject(IWorkbenchStorage) private readonly storage?: Storage) {}

  close() {
    this.state = null;
  }

  current() {
    return this.state
      ? { ...this.state, bounds: { ...this.state.bounds } }
      : null;
  }

  open(id: string, title: string, bounds: FloatingWindowBounds) {
    const restored = this.load(id) ?? bounds;
    this.state = { bounds: restored, id, maximized: false, title };
  }

  maximize(viewportWidth: number, viewportHeight: number) {
    if (!this.state || this.state.maximized) return;
    this.state.restoreBounds = { ...this.state.bounds };
    this.state.bounds = {
      height: viewportHeight,
      left: 0,
      top: 0,
      width: viewportWidth,
    };
    this.state.maximized = true;
  }

  restore() {
    if (!this.state?.restoreBounds) return;
    this.state.bounds = this.state.restoreBounds;
    this.state.restoreBounds = undefined;
    this.state.maximized = false;
    this.save();
  }

  updateBounds(bounds: FloatingWindowBounds) {
    if (!this.state || this.state.maximized) return;
    this.state.bounds = bounds;
    this.save();
  }

  private load(id: string) {
    try {
      const value = this.storage?.getItem(`zaw.floating-window.${id}`);
      if (!value) return undefined;
      const bounds = JSON.parse(value) as Partial<FloatingWindowBounds>;
      if (
        !Number.isFinite(bounds.height) ||
        !Number.isFinite(bounds.left) ||
        !Number.isFinite(bounds.top) ||
        !Number.isFinite(bounds.width)
      ) {
        return undefined;
      }
      return bounds as FloatingWindowBounds;
    } catch {
      return undefined;
    }
  }

  private save() {
    if (!this.state) return;
    this.storage?.setItem(
      `zaw.floating-window.${this.state.id}`,
      JSON.stringify(this.state.bounds),
    );
  }
}
