import { Widget, append, createElement } from "./widget";

export type DropdownOptions = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  panel: Node;
  trigger: Node | string;
  variant?: "borderless" | "default";
};

export class DropdownWidget extends Widget {
  constructor(
    root: HTMLElement,
    private readonly options: DropdownOptions,
  ) {
    super(root);
    const widgetOptions = this.options;
    const className = `zaw-dropdown ${
      widgetOptions.variant === "borderless" ? "zaw-dropdown-borderless" : ""
    } ${widgetOptions.className ?? ""}`.trim();
    const dropdown = createElement("div", { className });
    const details = createElement("details");
    if (widgetOptions.disabled) details.dataset.disabled = "true";
    const summary = createElement("summary", {
      ariaLabel: widgetOptions.ariaLabel,
    });
    if (widgetOptions.disabled) summary.setAttribute("aria-disabled", "true");
    const trigger = createElement("span", {
      className: "zaw-dropdown-trigger-content",
    });
    if (typeof widgetOptions.trigger === "string") {
      trigger.textContent = widgetOptions.trigger;
    } else {
      trigger.append(widgetOptions.trigger);
    }
    append(
      summary,
      trigger,
      createElement("span", { className: "codicon codicon-chevron-down" }),
    );
    append(details, summary, widgetOptions.panel);
    dropdown.append(details);
    this.root.replaceChildren(dropdown);
  }
}
