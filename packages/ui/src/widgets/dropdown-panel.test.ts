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

  it("uses roving tabindex and skips disabled items", () => {
    const root = document.createElement("div");
    document.body.append(root);
    new DropdownPanelWidget(root, {
      sections: [
        {
          items: [
            { label: "One" },
            { disabled: true, label: "Disabled" },
            { label: "Three" },
          ],
        },
      ],
    });
    const buttons = Array.from(
      root.querySelectorAll<HTMLButtonElement>("button"),
    );
    buttons[0].focus();
    buttons[0].dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
    );
    expect(document.activeElement).toBe(buttons[2]);
    buttons[2].dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Home" }),
    );
    expect(document.activeElement).toBe(buttons[0]);
    root.remove();
  });
});
