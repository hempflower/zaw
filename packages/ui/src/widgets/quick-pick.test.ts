// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { QuickPickWidget } from "./quick-pick";

describe("QuickPickWidget", () => {
  it("creates listbox rows and emits selected IDs", () => {
    const root = document.createElement("div");
    const widget = new QuickPickWidget(root, [{ id: "one", label: "One" }]);
    let selected = "";
    widget.onDidSelect((event) => {
      selected = event.id;
    });
    expect(root.querySelector('[role="listbox"]')).toBeTruthy();
    root.querySelector<HTMLButtonElement>("button")?.click();
    expect(selected).toBe("one");
  });

  it("moves the single tab stop with Arrow and End", () => {
    const root = document.createElement("div");
    document.body.append(root);
    new QuickPickWidget(root, [
      { id: "one", label: "One" },
      { id: "two", label: "Two" },
      { id: "three", label: "Three" },
    ]);
    const rows = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
    rows[0].focus();
    rows[0].dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
    );
    expect(document.activeElement).toBe(rows[1]);
    rows[1].dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "End" }),
    );
    expect(document.activeElement).toBe(rows[2]);
    root.remove();
  });
});
