// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { noop, root } from "../test-helpers";
import { TitlebarPart } from "./titlebar-part";

describe("TitlebarPart", () => {
  it("creates titlebar controls", () => {
    const element = root();
    const part = new TitlebarPart(element, {
      leftSidebarVisible: true,
      secondarySidebarVisible: true,
    });
    expect(element.querySelector(".app-titlebar")).toBeTruthy();
    expect(
      element.querySelector('button[aria-label="Hide Sessions panel"]'),
    ).toBeTruthy();
    expect(() => part.dispose()).not.toThrow();
  });
});
