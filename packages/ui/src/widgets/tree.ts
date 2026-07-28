import { Emitter } from "./event";
import { setRovingTabStop } from "./keyboard-navigation";
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
  private readonly tree: HTMLElement;
  private focusedID: string | undefined;

  constructor(
    root: HTMLElement,
    private readonly items: TreeItem[],
  ) {
    super(root);
    this.tree = createElement("ul", {
      className: "zaw-tree",
      role: "tree",
    });
    this.render();
    this.listen(this.tree, "keydown", (event) => this.onKeyDown(event));
  }

  private render(): void {
    this.tree.replaceChildren();
    this.renderItems(this.tree, this.items, 1);
    this.root.replaceChildren(this.tree);
    const rows = this.rows();
    const preferred = rows.find((row) => row.dataset.treeID === this.focusedID);
    setRovingTabStop(rows, preferred);
  }

  private renderItems(parent: HTMLElement, items: TreeItem[], level: number) {
    items.forEach((item) => {
      const row = createElement("li", { role: "none" });
      const button = createElement("button", {
        className: "zaw-tree-row",
        role: "treeitem",
      });
      button.type = "button";
      button.dataset.treeID = item.id;
      button.setAttribute("aria-level", String(level));
      if (item.children?.length)
        button.setAttribute("aria-expanded", String(item.expanded ?? false));
      append(
        button,
        item.children?.length
          ? createElement("span", {
              className: `codicon codicon-chevron-${item.expanded ? "down" : "right"}`,
            })
          : createElement("span", { className: "zaw-tree-indent" }),
        document.createTextNode(item.label),
      );
      this.listen(button, "focus", () => {
        this.focusedID = item.id;
        setRovingTabStop(this.rows(), button);
      });
      this.listen(button, "click", (event) => {
        this.focusedID = item.id;
        this._onDidSelect.fire({ id: item.id, event });
      });
      row.append(button);
      if (item.expanded && item.children?.length) {
        const children = createElement("ul", { role: "group" });
        this.renderItems(children, item.children, level + 1);
        row.append(children);
      }
      parent.append(row);
    });
  }

  private rows(): HTMLButtonElement[] {
    return Array.from(
      this.tree.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
    );
  }

  private findItem(id: string, items = this.items): TreeItem | undefined {
    for (const item of items) {
      if (item.id === id) return item;
      const child = item.children && this.findItem(id, item.children);
      if (child) return child;
    }
    return undefined;
  }

  private focusRow(row: HTMLButtonElement | undefined): void {
    if (!row) return;
    this.focusedID = row.dataset.treeID;
    setRovingTabStop(this.rows(), row);
    row.focus();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const rows = this.rows();
    const current = (
      event.target as Element | null
    )?.closest<HTMLButtonElement>('[role="treeitem"]');
    if (!current) return;
    const index = rows.indexOf(current);
    let target: HTMLButtonElement | undefined;
    if (event.key === "ArrowDown") target = rows[index + 1] ?? rows[0];
    else if (event.key === "ArrowUp") target = rows[index - 1] ?? rows.at(-1);
    else if (event.key === "Home") target = rows[0];
    else if (event.key === "End") target = rows.at(-1);
    else if (event.key === "ArrowRight") {
      const item = this.findItem(current.dataset.treeID ?? "");
      if (item?.children?.length && !item.expanded) {
        item.expanded = true;
        this.render();
        target = this.rows().find(
          (row) => row.dataset.treeID === current.dataset.treeID,
        );
      } else if (item?.children?.length) target = rows[index + 1];
    } else if (event.key === "ArrowLeft") {
      const item = this.findItem(current.dataset.treeID ?? "");
      if (item?.children?.length && item.expanded) {
        item.expanded = false;
        this.render();
        target = this.rows().find(
          (row) => row.dataset.treeID === current.dataset.treeID,
        );
      } else {
        const level = Number(current.getAttribute("aria-level") ?? 1);
        target = rows
          .slice(0, index)
          .reverse()
          .find((row) => Number(row.getAttribute("aria-level") ?? 1) < level);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      current.click();
    } else return;
    event.preventDefault();
    event.stopPropagation();
    this.focusRow(target);
  }
}
