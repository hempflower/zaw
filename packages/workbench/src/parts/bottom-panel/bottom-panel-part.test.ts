// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { noop, root } from "../test-helpers";
import { BottomPanelPart } from "./bottom-panel-part";

describe("BottomPanelPart", () => {
  it("renders resize and non-destructive close controls", () => {
    const panel = root();
    new BottomPanelPart(panel, {
      activeTerminal: "ahp-terminal:/one",
      collapsed: false,
      height: 320,
      terminal: {
        resource: "ahp-terminal:/one",
        title: "Terminal 1",
        output: "ready",
      },
      terminals: [
        {
          resource: "ahp-terminal:/one",
          title: "Terminal 1",
          output: "ready",
        },
      ],
    });

    expect(panel.querySelector('[data-resize-panel="bottom"]')).toBeTruthy();
    expect(
      panel
        .querySelector<HTMLElement>(".terminal-panel")
        ?.style.getPropertyValue("--zaw-terminal-panel-height"),
    ).toBe("320px");
    expect(
      panel.querySelector('button[aria-label="Close terminal panel"]'),
    ).toBeTruthy();
    expect(
      panel.querySelector('button[aria-label="Close Terminal 1"]'),
    ).toBeTruthy();
  });
});
