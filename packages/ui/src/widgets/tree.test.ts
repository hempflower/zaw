// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { TreeWidget } from "./tree";

describe("TreeWidget", () => {
  it("creates tree items and emits selection", () => {
    const root = document.createElement("div");
    const widget = new TreeWidget(root, [{ id: "one", label: "One" }]);
    let selected = "";
    widget.onDidSelect((event) => {
      selected = event.id;
    });
    expect(root.querySelector('[role="tree"]')).toBeTruthy();
    root.querySelector<HTMLButtonElement>(".zaw-tree-row")?.click();
    expect(selected).toBe("one");
  });

  it("expands, enters children and returns to parents with tree keys", () => {
    const root = document.createElement("div");
    document.body.append(root);
    new TreeWidget(root, [
      {
        children: [{ id: "child", label: "Child" }],
        id: "parent",
        label: "Parent",
      },
    ]);
    let parent = root.querySelector<HTMLButtonElement>('[role="treeitem"]')!;
    parent.focus();
    parent.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
    );
    parent = root.querySelector<HTMLButtonElement>('[data-tree-id="parent"]')!;
    expect(parent.getAttribute("aria-expanded")).toBe("true");
    parent.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
    );
    expect((document.activeElement as HTMLElement).dataset.treeID).toBe(
      "child",
    );
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }),
    );
    expect((document.activeElement as HTMLElement).dataset.treeID).toBe(
      "parent",
    );
    root.remove();
  });
});
