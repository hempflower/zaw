// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { RadioWidget } from "./radio";

describe("RadioWidget", () => {
  it("creates radio DOM and emits value", () => {
    const root = document.createElement("div");
    const widget = new RadioWidget(root, {
      label: "One",
      name: "choice",
      value: "one",
    });
    let value = "";
    widget.onDidChange((event) => {
      value = event.value;
    });
    root
      .querySelector<HTMLInputElement>(".zaw-radio")
      ?.dispatchEvent(new Event("change"));
    expect(value).toBe("one");
  });
});
