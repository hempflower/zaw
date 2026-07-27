import { Emitter, SelectWidget, Widget, append, createElement } from "@zaw/ui";

export type ColorTheme = "dark" | "hc" | "light" | "system";

export type SettingsViewOptions = {
  theme: ColorTheme;
};

export class SettingsView extends Widget {
  private readonly _onDidChangeTheme = this._register(
    new Emitter<ColorTheme>(),
  );
  readonly onDidChangeTheme = this._onDidChangeTheme.event;

  constructor(
    root: HTMLElement,
    private readonly options: SettingsViewOptions,
  ) {
    super(root);
    const theme = createElement("div");
    const themeSelect = new SelectWidget(theme, {
      ariaLabel: "Color theme",
      options: [
        { label: "System", value: "system" },
        { label: "Dark", value: "dark" },
        { label: "Light", value: "light" },
        { label: "High contrast", value: "hc" },
      ],
      value: this.options.theme,
    });
    themeSelect.onDidSelect(
      ({ value }) => this._onDidChangeTheme.fire(value as ColorTheme),
      undefined,
      this.disposables,
    );
    const section = createElement("section", {
      ariaLabel: "Settings",
      className: "settings",
    });
    const label = createElement("label", { className: "theme-select" });
    append(
      label,
      document.createTextNode("Color theme "),
      ...Array.from(theme.childNodes),
    );
    append(section, createElement("h2", { textContent: "Appearance" }), label);
    this.root.replaceChildren(section);
  }
}
