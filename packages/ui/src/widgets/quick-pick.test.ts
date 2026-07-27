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
});
