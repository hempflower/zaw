// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { Badge } from "./badge";

describe("Badge", () => {
  it("updates count and accessible name without replacing its DOM node", () => {
    const root = document.createElement("div");
    const badge = new Badge(root, {
      ariaLabel: "2 sessions",
      kind: "count",
      text: "2",
    });
    const element = badge.element;

    badge.setText("3");
    badge.setAriaLabel("3 sessions");

    expect(badge.element).toBe(element);
    expect(element.textContent).toBe("3");
    expect(element.getAttribute("aria-label")).toBe("3 sessions");
  });
});
