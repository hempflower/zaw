// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { noop, root } from "../test-helpers";
import { PrimaryAreaPart } from "./primary-area-part";

describe("PrimaryAreaPart", () => {
  it("creates a session canvas for empty state", () => {
    const element = root();
    new PrimaryAreaPart(element, {
      composer: document.createTextNode(""),
      emptyState: document.createTextNode("Empty"),
      messages: [],
      selectedSessionTitle: "New session",
      sessionSelected: false,
      summary: document.createTextNode(""),
      terminalOpen: false,
      terminalPart: null,
      workspaceID: "",
      workspaceOnline: false,
    });
    expect(element.querySelector(".session-canvas")?.textContent).toContain(
      "Empty",
    );
  });
});
