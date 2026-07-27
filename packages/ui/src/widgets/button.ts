import { Emitter } from "./event";
import { Widget, append, createElement } from "./widget";

export type ButtonOptions = {
  className?: string;
  disabled?: boolean;
  icon?: string;
  label: string;
  text?: string;
  value?: string;
  variant?: "primary" | "secondary";
};

export class ButtonWidget extends Widget {
  private readonly _onDidClick = this._register(new Emitter<MouseEvent>());
  readonly onDidClick = this._onDidClick.event;

  private readonly button: HTMLButtonElement;

  constructor(
    root: HTMLElement,
    private readonly options: ButtonOptions,
  ) {
    super(root);
    const widgetOptions = this.options;
    const className = [
      "zaw-button",
      widgetOptions.variant === "primary" ? "zaw-button-primary" : "",
      widgetOptions.className,
    ]
      .filter(Boolean)
      .join(" ");
    const button = createElement("button", {
      ariaLabel: widgetOptions.label,
      className,
    });
    button.type = "button";
    button.disabled = Boolean(widgetOptions.disabled);
    if (widgetOptions.value) button.value = widgetOptions.value;
    if (widgetOptions.icon) {
      button.append(
        createElement("span", {
          className: `codicon codicon-${widgetOptions.icon}`,
        }),
      );
    }
    if (widgetOptions.text) {
      button.append(createElement("span", { textContent: widgetOptions.text }));
    }
    this.listen(button, "click", (event) => this._onDidClick.fire(event));
    this.button = button;
    this.root.replaceChildren(button);
  }

  setDisabled(disabled: boolean): void {
    this.button.disabled = disabled;
  }
}

export class PrimaryButtonWidget extends ButtonWidget {
  constructor(root: HTMLElement, options: Omit<ButtonOptions, "variant">) {
    super(root, { ...options, variant: "primary" });
  }
}
