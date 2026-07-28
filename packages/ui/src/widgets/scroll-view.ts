import {
  DisposableStore,
  Emitter,
  type Event,
  type IDisposable,
} from "./event";
import { Widget } from "./widget";

export interface ScrollViewState {
  readonly scrollHeight: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly scrollWidth: number;
}

export interface ScrollViewOptions {
  readonly horizontal?: boolean;
  readonly vertical?: boolean;
}

const instances = new WeakMap<HTMLElement, ScrollView>();

/** VS Code-style overlay scrollbars for an existing native scroll viewport. */
export class ScrollView extends Widget {
  private readonly verticalTrack: HTMLElement;
  private readonly verticalSlider: HTMLElement;
  private readonly horizontalTrack: HTMLElement;
  private readonly horizontalSlider: HTMLElement;
  private readonly adjustedPosition: boolean;
  private readonly onDidScrollEmitter = this._register(
    new Emitter<ScrollViewState>(),
  );
  private frame = 0;

  readonly onDidScroll: Event<ScrollViewState> = this.onDidScrollEmitter.event;

  static attach(
    viewport: HTMLElement,
    options: ScrollViewOptions = {},
  ): ScrollView {
    const existing = instances.get(viewport);
    if (existing) return existing;
    const result = new ScrollView(viewport, options);
    instances.set(viewport, result);
    return result;
  }

  private constructor(
    readonly viewport: HTMLElement,
    private readonly options: ScrollViewOptions,
  ) {
    super(viewport);
    viewport.classList.add("zaw-scroll-view");
    this.adjustedPosition = getComputedStyle(viewport).position === "static";
    viewport.classList.toggle(
      "zaw-scroll-view-positioned",
      this.adjustedPosition,
    );
    [this.verticalTrack, this.verticalSlider] =
      this.createScrollbar("vertical");
    [this.horizontalTrack, this.horizontalSlider] =
      this.createScrollbar("horizontal");
    viewport.prepend(this.verticalTrack, this.horizontalTrack);
    this.listen(viewport, "scroll", () => {
      this.scheduleLayout();
      this.onDidScrollEmitter.fire(this.state());
    });
    this.installDrag(this.verticalSlider, "vertical");
    this.installDrag(this.horizontalSlider, "horizontal");

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => this.scheduleLayout());
      observer.observe(viewport);
      this._register({ dispose: () => observer.disconnect() });
    }
    if (typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(() => this.scheduleLayout());
      observer.observe(viewport, { childList: true, subtree: true });
      this._register({ dispose: () => observer.disconnect() });
    }
    this.scheduleLayout();
  }

  scrollTo(options: ScrollToOptions): void {
    this.viewport.scrollTo(options);
  }

  scrollToEnd(): void {
    this.viewport.scrollTop = this.viewport.scrollHeight;
  }

  layout(): void {
    const { clientHeight, clientWidth, scrollHeight, scrollWidth } =
      this.viewport;
    this.verticalTrack.style.top = `${this.viewport.scrollTop}px`;
    this.verticalTrack.style.left = `${this.viewport.scrollLeft + clientWidth}px`;
    this.horizontalTrack.style.top = `${this.viewport.scrollTop + clientHeight}px`;
    this.horizontalTrack.style.left = `${this.viewport.scrollLeft}px`;
    this.layoutScrollbar(
      this.verticalTrack,
      this.verticalSlider,
      this.options.vertical !== false && scrollHeight > clientHeight,
      clientHeight,
      scrollHeight,
      this.viewport.scrollTop,
    );
    this.layoutScrollbar(
      this.horizontalTrack,
      this.horizontalSlider,
      this.options.horizontal !== false && scrollWidth > clientWidth,
      clientWidth,
      scrollWidth,
      this.viewport.scrollLeft,
    );
  }

  override dispose(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.verticalTrack.remove();
    this.horizontalTrack.remove();
    this.viewport.classList.remove("zaw-scroll-view");
    if (this.adjustedPosition) {
      this.viewport.classList.remove("zaw-scroll-view-positioned");
    }
    instances.delete(this.viewport);
    super.dispose();
  }

  private createScrollbar(
    orientation: "horizontal" | "vertical",
  ): [HTMLElement, HTMLElement] {
    const track = document.createElement("div");
    track.className = `zaw-scrollbar ${orientation}`;
    track.style.position = "absolute";
    track.dataset.scrollViewDecoration = "true";
    track.setAttribute("aria-hidden", "true");
    const slider = document.createElement("div");
    slider.className = "slider";
    track.append(slider);
    return [track, slider];
  }

  private installDrag(
    slider: HTMLElement,
    orientation: "horizontal" | "vertical",
  ): void {
    this.listen(slider, "pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      slider.setPointerCapture(event.pointerId);
      const startPointer =
        orientation === "vertical" ? event.clientY : event.clientX;
      const startScroll =
        orientation === "vertical"
          ? this.viewport.scrollTop
          : this.viewport.scrollLeft;
      const onMove = (move: PointerEvent) => {
        const pointer =
          orientation === "vertical" ? move.clientY : move.clientX;
        const viewportSize =
          orientation === "vertical"
            ? this.viewport.clientHeight
            : this.viewport.clientWidth;
        const scrollSize =
          orientation === "vertical"
            ? this.viewport.scrollHeight
            : this.viewport.scrollWidth;
        const sliderSize =
          orientation === "vertical" ? slider.offsetHeight : slider.offsetWidth;
        const available = Math.max(1, viewportSize - sliderSize);
        const next =
          startScroll +
          ((pointer - startPointer) * (scrollSize - viewportSize)) / available;
        if (orientation === "vertical") this.viewport.scrollTop = next;
        else this.viewport.scrollLeft = next;
      };
      const onEnd = () => {
        slider.removeEventListener("pointermove", onMove);
        slider.removeEventListener("pointerup", onEnd);
        slider.removeEventListener("pointercancel", onEnd);
      };
      slider.addEventListener("pointermove", onMove);
      slider.addEventListener("pointerup", onEnd);
      slider.addEventListener("pointercancel", onEnd);
    });
  }

  private layoutScrollbar(
    track: HTMLElement,
    slider: HTMLElement,
    visible: boolean,
    viewportSize: number,
    scrollSize: number,
    scrollPosition: number,
  ): void {
    track.classList.toggle("visible", visible);
    if (!visible || viewportSize <= 0 || scrollSize <= 0) return;
    const sliderSize = Math.max(20, (viewportSize * viewportSize) / scrollSize);
    const sliderPosition =
      (scrollPosition / Math.max(1, scrollSize - viewportSize)) *
      Math.max(0, viewportSize - sliderSize);
    slider.style.setProperty("--zaw-scrollbar-slider-size", `${sliderSize}px`);
    slider.style.setProperty(
      "--zaw-scrollbar-slider-position",
      `${sliderPosition}px`,
    );
  }

  private scheduleLayout(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.layout();
    });
  }

  private state(): ScrollViewState {
    return {
      scrollHeight: this.viewport.scrollHeight,
      scrollLeft: this.viewport.scrollLeft,
      scrollTop: this.viewport.scrollTop,
      scrollWidth: this.viewport.scrollWidth,
    };
  }
}

/** Enhances current and future CSS scroll containers under a root. */
export function installScrollViews(root: HTMLElement): IDisposable {
  const store = new DisposableStore();
  let queued = false;
  const scan = () => {
    queued = false;
    const elements = [root, ...root.querySelectorAll<HTMLElement>("*")];
    for (const element of elements) {
      if (
        element.dataset.scrollViewDecoration ||
        element.matches("textarea, select, .xterm, .xterm-viewport")
      ) {
        continue;
      }
      const style = getComputedStyle(element);
      const scrollable = [
        style.overflow,
        style.overflowX,
        style.overflowY,
      ].some((value) => value === "auto" || value === "scroll");
      if (scrollable) ScrollView.attach(element);
    }
  };
  const queueScan = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(scan);
  };
  if (typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(queueScan);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style"],
      childList: true,
      subtree: true,
    });
    store.add({ dispose: () => observer.disconnect() });
  }
  queueScan();
  return store;
}
