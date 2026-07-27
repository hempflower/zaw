// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { ChatComposerWidget } from "./chat-composer";

describe("ChatComposerWidget", () => {
  it("disables composition while offline and exposes selections", () => {
    const composer = document.createElement("div");
    new ChatComposerWidget(composer, {
      activeTurn: false,
      composition: {
        agent: "copilot",
        approvalMode: "ask",
        attachments: [],
        draft: "hello",
        model: "model-one",
      },
      enabled: false,
      models: [{ id: "model-one", name: "Model One" }],
    });

    expect(composer.querySelectorAll(".zaw-select")).toHaveLength(3);
    expect(composer.querySelector("textarea[disabled]")).toBeTruthy();
    expect(
      composer
        .querySelector('button[aria-label="Send message"]')
        ?.hasAttribute("disabled"),
    ).toBe(true);
  });
});
