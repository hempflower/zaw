// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { CheckboxWidget } from "./checkbox";

describe("CheckboxWidget", () => {
  it("creates checkbox DOM and emits checked state", () => {
    const root = document.createElement("div");
    const widget = new CheckboxWidget(root, {
      label: "Enabled",
      name: "enabled",
    });
    let checked = false;
    widget.onDidChange((event) => {
      checked = event.checked;
    });
    const input = root.querySelector<HTMLInputElement>(".zaw-checkbox");
    expect(input).toBeTruthy();
    input!.checked = true;
    input!.dispatchEvent(new Event("change"));
    expect(checked).toBe(true);
  });
});
