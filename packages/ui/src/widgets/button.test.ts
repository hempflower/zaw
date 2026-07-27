// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { ButtonWidget, PrimaryButtonWidget } from "./button";

describe("ButtonWidget", () => {
  it("creates button DOM in the constructor", () => {
    const root = document.createElement("div");
    new ButtonWidget(root, { label: "Action", text: "Action" });
    expect(root.querySelector(".zaw-button")?.textContent).toBe("Action");
  });

  it("emits clicks", () => {
    const root = document.createElement("div");
    const button = new PrimaryButtonWidget(root, {
      label: "Save",
      text: "Save",
    });
    let clicked = false;
    button.onDidClick(() => {
      clicked = true;
    });
    root.querySelector<HTMLButtonElement>("button")?.click();
    expect(clicked).toBe(true);
    expect(
      root.querySelector("button")?.classList.contains("zaw-button-primary"),
    ).toBe(true);
  });
});
