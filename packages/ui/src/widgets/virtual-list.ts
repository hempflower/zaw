import { Widget, createElement } from "./widget";

export interface VirtualListDelegate<T> {
  getHeight(item: T): number;
  getKey(item: T): string;
  render(item: T): HTMLElement;
  update(element: HTMLElement, item: T): void;
}

export interface VirtualListOptions {
  ariaLabel: string;
  itemRole?: "listitem" | "treeitem";
  keyboardNavigation?: boolean;
  overscan?: number;
  role?: "list" | "tree";
  viewportHeight?: number;
}

type Row<T> = {
  bottom: number;
  item: T;
  key: string;
  top: number;
};

/** A fixed/mixed-height list that keeps DOM proportional to the viewport. */
export class VirtualList<T> extends Widget {
  private readonly viewport: HTMLElement;
  private readonly content: HTMLElement;
  private readonly rendered = new Map<string, HTMLElement>();
  private activeKey: string | undefined;
  private rows: Row<T>[] = [];
  private viewportHeight: number;

  constructor(
    root: HTMLElement,
    private readonly delegate: VirtualListDelegate<T>,
    private readonly options: VirtualListOptions,
  ) {
    super(root);
    this.viewportHeight = options.viewportHeight ?? 0;
    this.viewport = createElement("div", {
      ariaLabel: options.ariaLabel,
      className: "zaw-virtual-list",
      role: options.role ?? "list",
    });
    this.viewport.tabIndex = 0;
    this.content = createElement("div", {
      className: "zaw-virtual-list-content",
    });
    this.viewport.append(this.content);
    this.root.replaceChildren(this.viewport);
    this.listen(this.viewport, "scroll", () => this.renderVisible());
    if (options.keyboardNavigation !== false) {
      this.listen(this.viewport, "keydown", (event) => this.onKeyDown(event));
      this.listen(this.viewport, "focusin", (event) => {
        const row = this.rowElement(event.target);
        if (row?.dataset.virtualListKey) {
          this.setActiveKey(row.dataset.virtualListKey);
        }
      });
      this.listen(this.viewport, "pointerdown", (event) => {
        const row = this.rowElement(event.target);
        if (row?.dataset.virtualListKey) {
          this.setActiveKey(row.dataset.virtualListKey);
        }
      });
    }
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => this.renderVisible());
      observer.observe(this.viewport);
      this._register({ dispose: () => observer.disconnect() });
    }
  }

  getHTMLElement(): HTMLElement {
    return this.viewport;
  }

  setItems(items: readonly T[]): void {
    let top = 0;
    this.rows = items.map((item) => {
      const height = this.delegate.getHeight(item);
      const row = {
        bottom: top + height,
        item,
        key: this.delegate.getKey(item),
        top,
      };
      top += height;
      return row;
    });
    this.content.style.height = `${top}px`;
    if (!this.rows.some((row) => row.key === this.activeKey)) {
      this.activeKey = this.rows[0]?.key;
    }
    this.viewport.tabIndex = this.rows.length === 0 ? 0 : -1;
    this.renderVisible();
  }

  layout(viewportHeight?: number): void {
    if (viewportHeight !== undefined) this.viewportHeight = viewportHeight;
    this.renderVisible();
  }

  reveal(index: number): void {
    const row = this.rows[index];
    if (!row) return;
    const height = this.effectiveViewportHeight();
    if (row.top < this.viewport.scrollTop) this.viewport.scrollTop = row.top;
    else if (row.bottom > this.viewport.scrollTop + height)
      this.viewport.scrollTop = row.bottom - height;
    this.renderVisible();
  }

  private effectiveViewportHeight(): number {
    return this.viewportHeight || this.viewport.clientHeight || 600;
  }

  private renderVisible(): void {
    const overscan = this.options.overscan ?? 200;
    const start = Math.max(0, this.viewport.scrollTop - overscan);
    const end =
      this.viewport.scrollTop + this.effectiveViewportHeight() + overscan;
    const visible = new Set<string>();

    for (
      let index = this.firstVisibleIndex(start);
      index < this.rows.length;
      index++
    ) {
      const row = this.rows[index];
      if (row.top > end) break;
      visible.add(row.key);
      let element = this.rendered.get(row.key);
      if (!element) {
        element = this.delegate.render(row.item);
        element.setAttribute("role", this.options.itemRole ?? "listitem");
        element.style.position = "absolute";
        this.rendered.set(row.key, element);
        this.content.append(element);
      }
      this.delegate.update(element, row.item);
      element.dataset.virtualListKey = row.key;
      element.tabIndex = row.key === this.activeKey ? 0 : -1;
      element.style.height = `${row.bottom - row.top}px`;
      element.style.transform = `translateY(${row.top}px)`;
    }

    for (const [key, element] of this.rendered) {
      if (visible.has(key)) continue;
      element.remove();
      this.rendered.delete(key);
    }
  }

  private firstVisibleIndex(offset: number): number {
    let low = 0;
    let high = this.rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.rows[middle].bottom < offset) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private rowElement(target: EventTarget | null): HTMLElement | undefined {
    return target instanceof Element
      ? (target.closest<HTMLElement>("[data-virtual-list-key]") ?? undefined)
      : undefined;
  }

  private setActiveKey(key: string): void {
    this.activeKey = key;
    for (const [rowKey, element] of this.rendered) {
      element.tabIndex = rowKey === key ? 0 : -1;
    }
  }

  private focusIndex(index: number): void {
    const row = this.rows[index];
    if (!row) return;
    this.activeKey = row.key;
    this.reveal(index);
    this.rendered.get(row.key)?.focus();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const currentElement = this.rowElement(event.target);
    const currentKey = currentElement?.dataset.virtualListKey ?? this.activeKey;
    const currentIndex = this.rows.findIndex((row) => row.key === currentKey);
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown")
      nextIndex = Math.min(this.rows.length - 1, Math.max(0, currentIndex + 1));
    else if (event.key === "ArrowUp")
      nextIndex = Math.max(0, currentIndex <= 0 ? 0 : currentIndex - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = this.rows.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      currentElement?.click();
      event.preventDefault();
      event.stopPropagation();
      return;
    } else if (this.options.role === "tree" && event.key === "ArrowRight") {
      if (currentElement?.getAttribute("aria-expanded") === "false") {
        currentElement.click();
      } else if (currentElement?.getAttribute("aria-expanded") === "true") {
        const level = Number(currentElement.getAttribute("aria-level") ?? 1);
        const candidate = this.rendered.get(this.rows[currentIndex + 1]?.key);
        if (Number(candidate?.getAttribute("aria-level") ?? 0) > level)
          nextIndex = currentIndex + 1;
      }
    } else if (this.options.role === "tree" && event.key === "ArrowLeft") {
      if (currentElement?.getAttribute("aria-expanded") === "true") {
        currentElement.click();
      } else {
        const level = Number(currentElement?.getAttribute("aria-level") ?? 1);
        for (let index = currentIndex - 1; index >= 0; index--) {
          const candidate = this.rendered.get(this.rows[index].key);
          const candidateLevel = Number(
            candidate?.getAttribute("aria-level") ?? level,
          );
          if (candidateLevel < level) {
            nextIndex = index;
            break;
          }
        }
      }
    } else return;

    event.preventDefault();
    event.stopPropagation();
    if (nextIndex !== undefined && nextIndex >= 0) this.focusIndex(nextIndex);
  }
}
