// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { DialogWidget } from "./dialog";

describe("DialogWidget", () => {
  it("creates modal DOM and emits close", () => {
    const root = document.createElement("div");
    const widget = new DialogWidget(root, {
      body: document.createTextNode("Body"),
      title: "Dialog",
    });
    let closed = false;
    widget.onDidClose(() => {
      closed = true;
    });
    expect(root.querySelector('[aria-modal="true"]')).toBeTruthy();
    root.querySelector<HTMLButtonElement>("button")?.click();
    expect(closed).toBe(true);
  });
});
