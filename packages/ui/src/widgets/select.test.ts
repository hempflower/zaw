// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { SelectWidget } from "./select";

describe("SelectWidget", () => {
  it("updates selected option without rebuilding the root", () => {
    const root = document.createElement("div");
    const widget = new SelectWidget(root, {
      ariaLabel: "Theme",
      options: [
        {
          description: "Follow the operating system",
          label: "System",
          value: "system",
        },
        { description: "Always bright", label: "Light", value: "light" },
      ],
      value: "system",
    });
    let selectedValue = "";
    widget.onDidSelect((event) => {
      selectedValue = event.value;
    });
    const field = root.firstElementChild;
    expect(root.querySelector(".zaw-select-menu")).toBeTruthy();
    expect(
      root.querySelector<HTMLInputElement>('input[type="hidden"]')?.value,
    ).toBe("system");
    root.querySelectorAll<HTMLButtonElement>(".zaw-select-option")[1]?.click();
    expect(selectedValue).toBe("light");
    expect(root.firstElementChild).toBe(field);
    expect(
      root.querySelector<HTMLInputElement>('input[type="hidden"]')?.value,
    ).toBe("light");
  });
});
