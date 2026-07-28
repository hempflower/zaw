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

  it("traps focus, closes on Escape and restores the previous focus", async () => {
    const opener = document.createElement("button");
    const root = document.createElement("div");
    const input = document.createElement("input");
    document.body.append(opener, root);
    opener.focus();
    const widget = new DialogWidget(root, { body: input, title: "Dialog" });
    let closed = false;
    widget.onDidClose(() => (closed = true));
    await Promise.resolve();
    const close = root.querySelector<HTMLButtonElement>("button")!;
    expect(document.activeElement).toBe(close);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
    );
    expect(document.activeElement).toBe(close);
    close.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );
    expect(closed).toBe(true);
    widget.dispose();
    expect(document.activeElement).toBe(opener);
    root.remove();
    opener.remove();
  });
});
