// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { root } from "../test-helpers";
import { LeftSidebarPart } from "./left-sidebar-part";

describe("LeftSidebarPart", () => {
  it("hosts contributed sidebar content", () => {
    const sidebar = root();
    const content = document.createElement("div");
    content.textContent = "Contributed sessions";
    new LeftSidebarPart(sidebar, {
      content,
      mobileOpen: false,
    });

    expect(sidebar.textContent).toContain("Contributed sessions");
    expect(sidebar.querySelector(".workspace-sidebar")?.contains(content)).toBe(
      true,
    );
  });
});
