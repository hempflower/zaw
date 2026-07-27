// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { InputWidget } from "./input";

describe("InputWidget", () => {
  it("creates input DOM and emits input changes", () => {
    const root = document.createElement("div");
    const widget = new InputWidget(root, { ariaLabel: "Name", value: "Ada" });
    let value = "";
    widget.onDidInput((event) => {
      value = event.value;
    });
    const input = root.querySelector<HTMLInputElement>("input");
    expect(input?.classList.contains("zaw-control")).toBe(true);
    input!.value = "Grace";
    input!.dispatchEvent(new Event("input"));
    expect(value).toBe("Grace");
  });
});
