// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { SplitViewWidget } from "./split-view";

describe("SplitViewWidget", () => {
  it("creates panes and resize handle", () => {
    const root = document.createElement("div");
    new SplitViewWidget(root, {
      first: document.createTextNode("First"),
      orientation: "horizontal",
      resizeID: "main",
      second: document.createTextNode("Second"),
    });
    expect(root.querySelector("[data-resize-split='main']")).toBeTruthy();
  });
});
