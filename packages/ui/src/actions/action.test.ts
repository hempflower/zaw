// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { ActionButton, IconActionButton } from "./action";

describe("ActionButton", () => {
  it("renders a borderless icon action with accessible state", () => {
    const root = document.createElement("div");
    const action = new IconActionButton(root, {
      ariaLabel: "Toggle sidebar",
      checked: true,
      icon: "layout-sidebar-left",
    });
    const element = root.querySelector("button");
    expect(element?.classList.contains("zaw-action-icon")).toBe(true);
    expect(element?.getAttribute("aria-label")).toBe("Toggle sidebar");
    expect(element?.getAttribute("aria-pressed")).toBe("true");
    action.setChecked(false);
    action.setDisabled(true);
    expect(element?.getAttribute("aria-pressed")).toBe("false");
    expect(element?.hasAttribute("disabled")).toBe(true);
  });

  it("keeps its DOM node while state changes", () => {
    const root = document.createElement("div");
    const action = new ActionButton(root, {
      ariaLabel: "Run",
      icon: "play",
      label: "Run",
    });
    const element = action.element;
    const listener = vi.fn();
    action.onDidClick(listener);
    action.setLabel("Running");
    action.setIcon("loading");
    element.click();
    expect(action.element).toBe(element);
    expect(root.textContent).toContain("Running");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("exposes a stable busy state and restores its explicit disabled state", () => {
    const root = document.createElement("div");
    const action = new ActionButton(root, {
      ariaLabel: "Send",
      icon: "send",
      working: true,
    });
    const element = action.element;
    expect(element.getAttribute("aria-busy")).toBe("true");
    expect(element.disabled).toBe(true);
    expect(
      element.querySelector<HTMLElement>(".zaw-action-progress")?.hidden,
    ).toBe(false);

    action.setWorking(false);
    expect(action.element).toBe(element);
    expect(element.getAttribute("aria-busy")).toBe("false");
    expect(element.disabled).toBe(false);
    expect(
      element.querySelector<HTMLElement>(".zaw-action-progress")?.hidden,
    ).toBe(true);
    action.setDisabled(true);
    action.setWorking(true);
    action.setWorking(false);
    expect(element.disabled).toBe(true);
  });

  it("preserves editor focus when invoked with a pointer", () => {
    const input = document.createElement("textarea");
    const root = document.createElement("div");
    document.body.append(input, root);
    const action = new ActionButton(root, {
      ariaLabel: "Toggle",
      label: "Toggle",
    });
    input.focus();
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    action.element.dispatchEvent(down);
    action.element.click();
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    input.remove();
    root.remove();
  });
});
