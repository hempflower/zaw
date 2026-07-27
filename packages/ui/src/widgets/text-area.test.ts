// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { TextAreaWidget } from "./text-area";

describe("TextAreaWidget", () => {
  it("creates textarea DOM and emits changes", () => {
    const root = document.createElement("div");
    const widget = new TextAreaWidget(root, { ariaLabel: "Body" });
    let value = "";
    widget.onDidChange((event) => {
      value = event.value;
    });
    const textarea = root.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea?.getAttribute("aria-label")).toBe("Body");
    textarea!.value = "Note";
    textarea!.dispatchEvent(new Event("change"));
    expect(value).toBe("Note");
  });
});
