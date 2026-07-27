// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { DropdownPanelWidget } from "./dropdown-panel";

describe("DropdownPanelWidget", () => {
  it("creates grouped items and emits selection", () => {
    const root = document.createElement("div");
    const widget = new DropdownPanelWidget(root, {
      sections: [
        { items: [{ label: "Create" }] },
        { items: [{ label: "One", value: "one" }] },
      ],
    });
    let selected = "";
    widget.onDidSelect(({ item }) => {
      selected = item.value ?? item.label;
    });
    expect(root.querySelector(".zaw-dropdown-item-content")?.textContent).toBe(
      "Create",
    );
    root.querySelectorAll<HTMLButtonElement>("button")[1]?.click();
    expect(selected).toBe("one");
  });
});
