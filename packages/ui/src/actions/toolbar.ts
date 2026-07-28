import { Emitter } from "../widgets/event";
import { Widget, createElement } from "../widgets/widget";
import { ActionButton, type ActionOptions } from "./action";

export interface ToolbarAction extends ActionOptions {
  readonly id: string;
  readonly hidden?: boolean;
}

export interface ToolbarOptions {
  readonly actions: readonly ToolbarAction[];
  readonly ariaLabel: string;
  readonly className?: string;
  readonly orientation?: "horizontal" | "vertical";
}

export class Toolbar extends Widget {
  private readonly _onDidRun = this._register(
    new Emitter<{ id: string; event: MouseEvent }>(),
  );
  readonly onDidRun = this._onDidRun.event;

  readonly element: HTMLElement;
  private readonly actions = new Map<
    string,
    { readonly host: HTMLElement; readonly widget: ActionButton }
  >();

  constructor(root: HTMLElement, options: ToolbarOptions) {
    super(root);
    const element = createElement("div", {
      ariaLabel: options.ariaLabel,
      className: ["zaw-toolbar", options.className ?? ""]
        .filter(Boolean)
        .join(" "),
      role: "toolbar",
    });
    element.setAttribute(
      "aria-orientation",
      options.orientation ?? "horizontal",
    );
    element.classList.toggle("vertical", options.orientation === "vertical");
    for (const action of options.actions) {
      const host = createElement("div", { className: "zaw-toolbar-item" });
      host.dataset.actionId = action.id;
      host.hidden = Boolean(action.hidden);
      const widget = this._register(new ActionButton(host, action));
      widget.onDidClick(
        (event) => this._onDidRun.fire({ id: action.id, event }),
        undefined,
        this.disposables,
      );
      this.actions.set(action.id, { host, widget });
      element.append(host);
    }
    this.initializeRovingTabIndex();
    this.listen(element, "keydown", (event) => this.onKeyDown(event));
    this.listen(element, "focusin", (event) => {
      const target = event.target;
      if (target instanceof HTMLButtonElement) this.selectRovingTarget(target);
    });
    this.element = element;
    this.root.replaceChildren(element);
  }

  action(id: string): ActionButton | undefined {
    return this.actions.get(id)?.widget;
  }

  setActionHidden(id: string, hidden: boolean): void {
    const action = this.actions.get(id);
    if (!action) return;
    const wasCurrent = action.widget.element.tabIndex === 0;
    action.host.hidden = hidden;
    if (wasCurrent && hidden) this.initializeRovingTabIndex();
  }

  private visibleButtons(): HTMLButtonElement[] {
    return [...this.actions.values()]
      .filter(({ host, widget }) => !host.hidden && !widget.element.disabled)
      .map(({ widget }) => widget.element);
  }

  private initializeRovingTabIndex(): void {
    const visible = this.visibleButtons();
    const selected =
      visible.find((button) => button.tabIndex === 0) ?? visible[0];
    for (const { widget } of this.actions.values())
      widget.element.tabIndex = widget.element === selected ? 0 : -1;
  }

  private selectRovingTarget(target: HTMLButtonElement): void {
    for (const { widget } of this.actions.values())
      widget.element.tabIndex = widget.element === target ? 0 : -1;
  }

  private onKeyDown(event: KeyboardEvent): void {
    const horizontal =
      this.element.getAttribute("aria-orientation") !== "vertical";
    const previousKey = horizontal ? "ArrowLeft" : "ArrowUp";
    const nextKey = horizontal ? "ArrowRight" : "ArrowDown";
    if (
      event.key !== previousKey &&
      event.key !== nextKey &&
      event.key !== "Home" &&
      event.key !== "End"
    )
      return;
    const buttons = this.visibleButtons();
    if (!buttons.length) return;
    const current = document.activeElement;
    let index = buttons.indexOf(current as HTMLButtonElement);
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = buttons.length - 1;
    else if (event.key === previousKey)
      index = (Math.max(index, 0) - 1 + buttons.length) % buttons.length;
    else index = (Math.max(index, -1) + 1) % buttons.length;
    event.preventDefault();
    this.selectRovingTarget(buttons[index]);
    buttons[index].focus();
  }
}
