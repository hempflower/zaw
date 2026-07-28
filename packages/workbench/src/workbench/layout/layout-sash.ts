export type LayoutSashKind = "auxiliary" | "panel" | "sidebar";

export interface LayoutSashOptions {
  readonly currentSize: () => number;
  readonly kind: LayoutSashKind;
  readonly resize: (size: number) => void;
}

const metadata: Record<
  LayoutSashKind,
  {
    cursor: "col-resize" | "row-resize";
    direction: 1 | -1;
    label: string;
    minimum: number;
    negativeKey: string;
    positiveKey: string;
  }
> = {
  auxiliary: {
    cursor: "col-resize",
    direction: -1,
    label: "Resize Details",
    minimum: 270,
    negativeKey: "ArrowRight",
    positiveKey: "ArrowLeft",
  },
  panel: {
    cursor: "row-resize",
    direction: -1,
    label: "Resize Terminal Panel",
    minimum: 77,
    negativeKey: "ArrowDown",
    positiveKey: "ArrowUp",
  },
  sidebar: {
    cursor: "col-resize",
    direction: 1,
    label: "Resize Agent Sessions",
    minimum: 270,
    negativeKey: "ArrowLeft",
    positiveKey: "ArrowRight",
  },
};

/** Creates a VS Code-style pointer and keyboard operable layout separator. */
export function createLayoutSash(options: LayoutSashOptions): HTMLElement {
  const configuration = metadata[options.kind];
  const sash = document.createElement("div");
  sash.className = `agent-layout-sash agent-layout-sash-${options.kind}`;
  sash.dataset.sash = options.kind;
  sash.tabIndex = 0;
  sash.style.cursor = configuration.cursor;
  sash.setAttribute("role", "separator");
  sash.setAttribute("aria-label", configuration.label);
  sash.setAttribute(
    "aria-orientation",
    configuration.cursor === "col-resize" ? "vertical" : "horizontal",
  );
  sash.setAttribute("aria-valuemin", String(configuration.minimum));
  sash.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    sash.setPointerCapture(event.pointerId);
    const horizontal = configuration.cursor === "col-resize";
    const startPointer = horizontal ? event.clientX : event.clientY;
    const startSize = options.currentSize();
    const move = (moveEvent: PointerEvent) => {
      const pointer = horizontal ? moveEvent.clientX : moveEvent.clientY;
      options.resize(
        startSize + configuration.direction * (pointer - startPointer),
      );
    };
    const end = () => {
      sash.removeEventListener("pointermove", move);
      sash.removeEventListener("pointerup", end);
      sash.removeEventListener("pointercancel", end);
    };
    sash.addEventListener("pointermove", move);
    sash.addEventListener("pointerup", end);
    sash.addEventListener("pointercancel", end);
  });
  sash.addEventListener("keydown", (event) => {
    const delta =
      event.key === configuration.positiveKey
        ? 10
        : event.key === configuration.negativeKey
          ? -10
          : 0;
    if (!delta) return;
    event.preventDefault();
    options.resize(options.currentSize() + delta);
  });
  return sash;
}
