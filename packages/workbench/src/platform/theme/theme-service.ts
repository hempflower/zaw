import { Emitter, type Event } from "@zaw/ui";
import { inject, injectable, optional } from "inversify";
import { IWorkbenchStorage } from "../../services/workspace-ui-state";

export const IThemeService = Symbol.for("IThemeService");
export type ColorTheme = "dark" | "light" | "hc" | "system";

export interface IThemeService {
  readonly current: ColorTheme;
  readonly onDidChange: Event<ColorTheme>;
  initialize(): void;
  set(theme: ColorTheme): void;
}

@injectable()
export class ThemeService implements IThemeService {
  /** Agents workbench follows VS Code's dark-first desktop presentation by default. */
  private _current: ColorTheme = "dark";
  private readonly emitter = new Emitter<ColorTheme>();
  readonly onDidChange = this.emitter.event;
  get current(): ColorTheme {
    return this._current;
  }

  constructor(
    @optional() @inject(IWorkbenchStorage) private readonly storage?: Storage,
  ) {}

  initialize(): void {
    const saved = this.storage?.getItem("zaw.theme");
    this.set(isColorTheme(saved) ? saved : "dark");
  }

  set(theme: ColorTheme): void {
    if (!isColorTheme(theme)) return;
    const changed = this._current !== theme;
    this._current = theme;
    if (typeof document !== "undefined")
      document.documentElement.dataset.zawTheme = theme;
    this.storage?.setItem("zaw.theme", theme);
    if (changed) this.emitter.fire(theme);
  }
}

function isColorTheme(value: unknown): value is ColorTheme {
  return (
    value === "dark" ||
    value === "light" ||
    value === "hc" ||
    value === "system"
  );
}
