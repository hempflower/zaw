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

  it("uses tab semantics on labels and selects with arrow keys", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const widget = new TabsWidget(root, {
      activeID: "one",
      selectAction: "select",
      tabs: [
        { id: "one", label: "One" },
        { id: "two", label: "Two" },
      ],
    });
    let selected = "";
    widget.onDidSelect((event) => (selected = event.id));
    const tabs = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
    tabs[0].focus();
    tabs[0].dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
    );
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(selected).toBe("two");
    root.remove();
  });
});
