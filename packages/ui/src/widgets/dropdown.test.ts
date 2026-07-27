// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { DropdownWidget } from "./dropdown";

describe("DropdownWidget", () => {
  it("creates a details dropdown", () => {
    const root = document.createElement("div");
    const panel = document.createElement("div");
    panel.className = "zaw-dropdown-panel";
    new DropdownWidget(root, {
      ariaLabel: "Choose item",
      panel,
      trigger: "Current",
      variant: "borderless",
    });
    expect(root.querySelector(".zaw-dropdown-panel")).toBeTruthy();
    expect(root.querySelector(".zaw-dropdown-borderless")).toBeTruthy();
  });
});
