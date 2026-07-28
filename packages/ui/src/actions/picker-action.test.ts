// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { PickerAction } from "./picker-action";

describe("PickerAction", () => {
  it("renders and updates a compact picker without replacing the trigger", () => {
    const root = document.createElement("div");
    const picker = new PickerAction(root, {
      ariaLabel: "Model",
      icon: "sparkle",
      items: [
        { label: "Auto", value: "auto" },
        { label: "GPT", value: "gpt" },
      ],
      value: "auto",
    });
    const trigger = root.querySelector("summary");
    const observer = new MutationObserver(() => undefined);
    observer.observe(root, { childList: true, subtree: true });
    const listener = vi.fn();
    picker.onDidSelect(listener);
    root.querySelectorAll<HTMLButtonElement>('[role="option"]')[1]?.click();
    const removed = observer
      .takeRecords()
      .flatMap((record) => Array.from(record.removedNodes));
    expect(root.querySelector("summary")).toBe(trigger);
    expect(removed.some((node) => node === trigger)).toBe(false);
    expect(root.textContent).toContain("GPT");
    expect(listener.mock.calls[0]?.[0].item.value).toBe("gpt");
    observer.disconnect();
  });
});
