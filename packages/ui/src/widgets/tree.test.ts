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
});
