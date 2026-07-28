// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { Toolbar } from "./toolbar";

describe("Toolbar", () => {
  it("exposes toolbar semantics and emits action identities", () => {
    const root = document.createElement("div");
    const toolbar = new Toolbar(root, {
      actions: [
        { ariaLabel: "New", icon: "add", id: "new", kind: "icon" },
        { ariaLabel: "Send", icon: "arrow-up", id: "send", kind: "primary" },
      ],
      ariaLabel: "Composer actions",
    });
    const listener = vi.fn();
    toolbar.onDidRun(listener);
    toolbar.action("send")?.element.click();
    expect(root.querySelector('[role="toolbar"]')).toBeTruthy();
    expect(listener.mock.calls[0]?.[0].id).toBe("send");
    toolbar.setActionHidden("new", true);
    expect(
      root.querySelector<HTMLElement>('[data-action-id="new"]')?.hidden,
    ).toBe(true);
  });

  it("uses cyclic arrow and Home/End keyboard navigation", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const toolbar = new Toolbar(root, {
      actions: [
        { ariaLabel: "First", id: "first", kind: "text", label: "First" },
        { ariaLabel: "Second", id: "second", kind: "text", label: "Second" },
        { ariaLabel: "Last", id: "last", kind: "text", label: "Last" },
      ],
      ariaLabel: "Actions",
    });
    toolbar.action("first")?.element.focus();
    toolbar.element.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }),
    );
    expect(document.activeElement).toBe(toolbar.action("last")?.element);
    toolbar.element.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Home" }),
    );
    expect(document.activeElement).toBe(toolbar.action("first")?.element);
    expect(toolbar.action("first")?.element.tabIndex).toBe(0);
    expect(toolbar.action("second")?.element.tabIndex).toBe(-1);
    root.remove();
  });
});
