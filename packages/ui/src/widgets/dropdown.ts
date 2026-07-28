import { Widget, append, createElement } from "./widget";

let activeDropdown: HTMLDetailsElement | undefined;

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
    this.listen(details, "toggle", () => {
      if (!details.open) {
        if (activeDropdown === details) activeDropdown = undefined;
        return;
      }
      if (activeDropdown && activeDropdown !== details)
        activeDropdown.open = false;
      activeDropdown = details;
      queueMicrotask(() => {
        this.positionPanel(dropdown, summary);
        this.focusPanelItem(details);
      });
    });
    this.listen(window, "resize", () => {
      if (details.open) this.positionPanel(dropdown, summary);
    });
    this.listen(
      window,
      "scroll",
      () => {
        if (details.open) this.positionPanel(dropdown, summary);
      },
      { capture: true },
    );
    this.listen(
      document,
      "pointerdown",
      (event) => {
        if (details.open && !dropdown.contains(event.target as Node))
          details.open = false;
      },
      { capture: true },
    );
    this.listen(details, "keydown", (event) => {
      if (event.key === "Escape") {
        details.open = false;
        summary.focus();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (
        event.target === summary &&
        (event.key === "ArrowDown" || event.key === "ArrowUp")
      ) {
        if (!details.open) details.open = true;
        queueMicrotask(() =>
          this.focusPanelItem(details, event.key === "ArrowUp"),
        );
        event.preventDefault();
      }
    });
    this._register({
      dispose: () => {
        if (activeDropdown === details) activeDropdown = undefined;
      },
    });
  }

  private positionPanel(dropdown: HTMLElement, summary: HTMLElement): void {
    const panel = dropdown.querySelector<HTMLElement>(".zaw-dropdown-panel");
    if (!panel) return;
    dropdown.classList.remove("drop-up");
    panel.style.removeProperty("--zaw-dropdown-max-height");
    const margin = 8;
    const trigger = summary.getBoundingClientRect();
    const panelHeight = panel.getBoundingClientRect().height;
    const viewport = verticalClippingBounds(dropdown);
    const below = Math.max(0, viewport.bottom - trigger.bottom - margin);
    const above = Math.max(0, trigger.top - viewport.top - margin);
    const dropUp = panelHeight > below && above > below;
    dropdown.classList.toggle("drop-up", dropUp);
    panel.style.setProperty(
      "--zaw-dropdown-max-height",
      `${Math.max(0, Math.floor(dropUp ? above : below))}px`,
    );
  }

  private focusPanelItem(details: HTMLDetailsElement, last = false): void {
    const items = Array.from(
      details.querySelectorAll<HTMLButtonElement>(
        '[role="option"]:not([disabled]), [role="menuitem"]:not([disabled])',
      ),
    );
    const target = last
      ? items.at(-1)
      : (items.find((item) => item.getAttribute("aria-selected") === "true") ??
        items[0]);
    for (const item of items) item.tabIndex = item === target ? 0 : -1;
    target?.focus();
  }
}

function verticalClippingBounds(element: HTMLElement): {
  bottom: number;
  top: number;
} {
  let top = 0;
  let bottom = window.innerHeight;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent);
    const overflow = `${style.overflow} ${style.overflowY}`;
    if (!/(auto|scroll|hidden|clip)/.test(overflow)) continue;
    const bounds = parent.getBoundingClientRect();
    top = Math.max(top, bounds.top);
    bottom = Math.min(bottom, bounds.bottom);
  }
  return { bottom: Math.max(top, bottom), top };
}
