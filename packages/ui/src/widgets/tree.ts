import { Emitter } from "./event";
import { Widget, append, createElement } from "./widget";

export type TreeItem = {
  children?: TreeItem[];
  expanded?: boolean;
  id: string;
  label: string;
};

export class TreeWidget extends Widget {
  private readonly _onDidSelect = this._register(
    new Emitter<{ id: string; event: MouseEvent }>(),
  );
  readonly onDidSelect = this._onDidSelect.event;

  constructor(
    root: HTMLElement,
    private readonly items: TreeItem[],
  ) {
    super(root);
    const tree = createElement("ul", { className: "zaw-tree", role: "tree" });
    this.renderItems(tree, this.items);
    this.root.replaceChildren(tree);
  }

  private renderItems(parent: HTMLElement, items: TreeItem[]) {
    items.forEach((item) => {
      const row = createElement("li", { role: "treeitem" });
      row.setAttribute("aria-expanded", String(item.expanded ?? false));
      const button = createElement("button", { className: "zaw-tree-row" });
      button.type = "button";
      append(
        button,
        item.children?.length
          ? createElement("span", {
              className: `codicon codicon-chevron-${item.expanded ? "down" : "right"}`,
            })
          : createElement("span", { className: "zaw-tree-indent" }),
        document.createTextNode(item.label),
      );
      this.listen(button, "click", (event) =>
        this._onDidSelect.fire({ id: item.id, event }),
      );
      row.append(button);
      if (item.expanded && item.children?.length) {
        const children = createElement("ul", { role: "group" });
        this.renderItems(children, item.children);
        row.append(children);
      }
      parent.append(row);
    });
  }
}
