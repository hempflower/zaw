import { Emitter } from "./event";
import { Widget, append, createElement } from "./widget";

export type QuickPickItem = { description?: string; id: string; label: string };

export class QuickPickWidget extends Widget {
  private readonly _onDidSelect = this._register(
    new Emitter<{ id: string; event: MouseEvent }>(),
  );
  readonly onDidSelect = this._onDidSelect.event;

  constructor(
    root: HTMLElement,
    private readonly items: QuickPickItem[],
  ) {
    super(root);
    const quickPick = createElement("div", {
      className: "zaw-quick-pick",
      role: "listbox",
    });
    this.items.forEach((item) => {
      const row = createElement("button", {
        className: "zaw-quick-pick-row",
        role: "option",
      });
      row.type = "button";
      append(
        row,
        createElement("span", { textContent: item.label }),
        item.description
          ? createElement("small", { textContent: item.description })
          : null,
      );
      this.listen(row, "click", (event) =>
        this._onDidSelect.fire({ id: item.id, event }),
      );
      quickPick.append(row);
    });
    this.root.replaceChildren(quickPick);
  }
}
