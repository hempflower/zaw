import { ButtonWidget, Emitter, Widget, append, createElement } from "@zaw/ui";
import type { FloatingWindowState } from "../services/floating-window";

export type FloatingWindowWidgetOptions = {
  content: Node;
  state: FloatingWindowState;
};

export class FloatingWindowWidget extends Widget {
  private readonly _onDidClose = this._register(new Emitter<void>());
  private readonly _onDidMaximize = this._register(new Emitter<void>());
  private readonly _onDidRestore = this._register(new Emitter<void>());
  readonly onDidClose = this._onDidClose.event;
  readonly onDidMaximize = this._onDidMaximize.event;
  readonly onDidRestore = this._onDidRestore.event;

  constructor(
    root: HTMLElement,
    private readonly options: FloatingWindowWidgetOptions,
  ) {
    super(root);
    const state = this.options.state;
    const maximize = createElement("span");
    const maximizeButton = new ButtonWidget(maximize, {
      icon: state.maximized ? "screen-normal" : "screen-full",
      label: state.maximized ? "Restore window" : "Maximize window",
    });
    maximizeButton.onDidClick(
      () =>
        state.maximized
          ? this._onDidRestore.fire()
          : this._onDidMaximize.fire(),
      undefined,
      this.disposables,
    );
    const close = createElement("span");
    const closeButton = new ButtonWidget(close, {
      icon: "close",
      label: `Close ${state.title}`,
    });
    closeButton.onDidClick(
      () => this._onDidClose.fire(),
      undefined,
      this.disposables,
    );
    const section = createElement("section", {
      ariaLabel: state.title,
      className: `zaw-floating-window${state.maximized ? " maximized" : ""}`,
      role: "dialog",
    });
    section.dataset.floatingWindow = state.id;
    section.setAttribute("aria-modal", "true");
    section.tabIndex = -1;
    section.style.left = `${Math.round(state.bounds.left)}px`;
    section.style.top = `${Math.round(state.bounds.top)}px`;
    section.style.width = `${Math.round(state.bounds.width)}px`;
    section.style.height = `${Math.round(state.bounds.height)}px`;
    const header = createElement("header", {
      className: "zaw-floating-window-titlebar",
    });
    header.dataset.floatingWindowDrag = "true";
    const actions = createElement("span");
    append(
      actions,
      ...Array.from(maximize.childNodes),
      ...Array.from(close.childNodes),
    );
    append(
      header,
      createElement("strong", { textContent: state.title }),
      actions,
    );
    const content = createElement("div", {
      className: "zaw-floating-window-content",
    });
    content.append(this.options.content);
    append(section, header, content);
    if (!state.maximized)
      resizeHandles().forEach((handle) => section.append(handle));
    this.root.replaceChildren(section);
  }
}

export class OverlayLayerWidget extends Widget {
  constructor(
    root: HTMLElement,
    private readonly window: Node | null,
  ) {
    super(root);
    if (!this.window) {
      this.root.replaceChildren();
      return;
    }
    const layer = createElement("div", { className: "zaw-overlay-layer" });
    append(
      layer,
      createElement("div", { className: "zaw-floating-backdrop" }),
      this.window,
    );
    this.root.replaceChildren(layer);
  }
}

function resizeHandles() {
  return ["n", "ne", "e", "se", "s", "sw", "w", "nw"].map((edge) => {
    const handle = createElement("div", {
      className: `zaw-floating-resize ${edge}`,
    });
    handle.dataset.floatingResize = edge;
    return handle;
  });
}
