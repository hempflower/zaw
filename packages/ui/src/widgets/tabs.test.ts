// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { TabsWidget } from "./tabs";

describe("TabsWidget", () => {
  it("creates tablist and emits selection", () => {
    const root = document.createElement("div");
    const widget = new TabsWidget(root, {
      activeID: "one",
      selectAction: "select",
      tabs: [{ id: "one", label: "One" }],
    });
    let selected = "";
    widget.onDidSelect((event) => {
      selected = event.id;
    });
    expect(root.querySelector('[role="tablist"]')).toBeTruthy();
    root.querySelector<HTMLButtonElement>(".zaw-tab-label")?.click();
    expect(selected).toBe("one");
  });
});
