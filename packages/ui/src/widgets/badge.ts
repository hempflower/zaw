import { Widget, createElement } from "./widget";

export interface BadgeOptions {
  readonly ariaLabel?: string;
  readonly kind?: "count" | "status";
  readonly text: string;
  readonly title?: string;
}

/** Compact status/count label with a stable root node. */
export class Badge extends Widget {
  readonly element: HTMLSpanElement;

  constructor(root: HTMLElement, options: BadgeOptions) {
    super(root);
    this.element = createElement("span", {
      ariaLabel: options.ariaLabel,
      className: `zaw-badge zaw-badge-${options.kind ?? "status"}`,
      textContent: options.text,
    });
    if (options.title) this.element.title = options.title;
    this.root.replaceChildren(this.element);
  }

  setText(text: string): void {
    this.element.textContent = text;
  }

  setAriaLabel(label: string): void {
    this.element.setAttribute("aria-label", label);
  }
}
