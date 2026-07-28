import { Emitter } from "../widgets/event";
import { Widget, createElement } from "../widgets/widget";

export type ActionKind = "icon" | "primary" | "text";

export interface ActionOptions {
  readonly ariaLabel: string;
  readonly checked?: boolean;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly icon?: string;
  readonly kind?: ActionKind;
  readonly label?: string;
  readonly title?: string;
  readonly working?: boolean;
}

/**
 * A compact workbench action. Unlike ButtonWidget, this is intended for
 * toolbars and command surfaces rather than form submission.
 */
export class ActionButton extends Widget {
  private readonly _onDidClick = this._register(new Emitter<MouseEvent>());
  readonly onDidClick = this._onDidClick.event;

  readonly element: HTMLButtonElement;
  private readonly iconElement: HTMLSpanElement | undefined;
  private readonly labelElement: HTMLSpanElement | undefined;
  private readonly progressElement: HTMLSpanElement;
  private disabled: boolean;
  private working = false;

  constructor(root: HTMLElement, options: ActionOptions) {
    super(root);
    const kind = options.kind ?? "text";
    const element = createElement("button", {
      ariaLabel: options.ariaLabel,
      className: ["zaw-action", `zaw-action-${kind}`, options.className ?? ""]
        .filter(Boolean)
        .join(" "),
    });
    element.type = "button";
    this.disabled = Boolean(options.disabled);
    element.disabled = this.disabled;
    element.title = options.title ?? options.ariaLabel;
    element.setAttribute("aria-pressed", String(Boolean(options.checked)));
    element.classList.toggle("checked", Boolean(options.checked));

    this.iconElement = options.icon
      ? createElement("span", {
          className: `codicon codicon-${options.icon} zaw-action-glyph`,
        })
      : undefined;
    this.iconElement?.setAttribute("aria-hidden", "true");
    this.labelElement = options.label
      ? createElement("span", {
          className: "zaw-action-label",
          textContent: options.label,
        })
      : undefined;
    this.progressElement = createElement("span", {
      className: "codicon codicon-loading zaw-action-progress",
    });
    this.progressElement.setAttribute("aria-hidden", "true");
    element.append(
      this.progressElement,
      ...[this.iconElement, this.labelElement].filter(
        (node): node is HTMLElement => Boolean(node),
      ),
    );
    // Workbench toolbar actions preserve the editor/list focus on pointer use;
    // keyboard focus remains available through the toolbar's roving tabindex.
    this.listen(element, "mousedown", (event) => event.preventDefault());
    this.listen(element, "click", (event) => this._onDidClick.fire(event));
    this.element = element;
    this.root.replaceChildren(element);
    this.setWorking(Boolean(options.working));
  }

  setChecked(checked: boolean): void {
    this.element.classList.toggle("checked", checked);
    this.element.setAttribute("aria-pressed", String(checked));
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.element.disabled = disabled || this.working;
  }

  setWorking(working: boolean): void {
    this.working = working;
    this.progressElement.hidden = !working;
    this.element.classList.toggle("working", working);
    this.element.setAttribute("aria-busy", String(working));
    this.element.disabled = this.disabled || working;
  }

  setIcon(icon: string): void {
    if (!this.iconElement) return;
    for (const className of Array.from(this.iconElement.classList)) {
      if (className.startsWith("codicon-") && className !== "codicon")
        this.iconElement.classList.remove(className);
    }
    this.iconElement.classList.add(`codicon-${icon}`);
  }

  setLabel(label: string): void {
    if (this.labelElement) this.labelElement.textContent = label;
  }
}

export class IconActionButton extends ActionButton {
  constructor(
    root: HTMLElement,
    options: Omit<ActionOptions, "kind" | "label"> & { readonly icon: string },
  ) {
    super(root, { ...options, kind: "icon" });
  }
}
