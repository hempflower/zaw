import { Widget, append, createElement } from "./widget";

export type SplitViewOptions = {
  first: Node;
  orientation: "horizontal" | "vertical";
  resizeID: string;
  second: Node;
};

export class SplitViewWidget extends Widget {
  constructor(
    root: HTMLElement,
    private readonly options: SplitViewOptions,
  ) {
    super(root);
    const split = createElement("div", {
      className: `zaw-split-view ${this.options.orientation}`,
    });
    const first = createElement("div", { className: "zaw-split-view-pane" });
    first.append(this.options.first);
    const handle = createElement("div", { className: "zaw-split-view-handle" });
    handle.dataset.resizeSplit = this.options.resizeID;
    const second = createElement("div", { className: "zaw-split-view-pane" });
    second.append(this.options.second);
    append(split, first, handle, second);
    this.root.replaceChildren(split);
  }
}
