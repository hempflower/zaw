// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { DropdownWidget } from "./dropdown";

describe("DropdownWidget", () => {
  it("creates a details dropdown", () => {
    const root = document.createElement("div");
    const panel = document.createElement("div");
    panel.className = "zaw-dropdown-panel";
    new DropdownWidget(root, {
      ariaLabel: "Choose item",
      panel,
      trigger: "Current",
      variant: "borderless",
    });
    expect(root.querySelector(".zaw-dropdown-panel")).toBeTruthy();
    expect(root.querySelector(".zaw-dropdown-borderless")).toBeTruthy();
  });

  it("closes on outside click or Escape and keeps only one dropdown open", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);
    new DropdownWidget(first, {
      ariaLabel: "First",
      panel: document.createElement("div"),
      trigger: "First",
    });
    new DropdownWidget(second, {
      ariaLabel: "Second",
      panel: document.createElement("div"),
      trigger: "Second",
    });
    const firstDetails = first.querySelector("details")!;
    const secondDetails = second.querySelector("details")!;
    firstDetails.open = true;
    firstDetails.dispatchEvent(new Event("toggle"));
    secondDetails.open = true;
    secondDetails.dispatchEvent(new Event("toggle"));
    expect(firstDetails.open).toBe(false);
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    expect(secondDetails.open).toBe(false);
    secondDetails.open = true;
    secondDetails.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(secondDetails.open).toBe(false);
  });

  it("opens with arrows, focuses an option and restores the trigger on Escape", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const panel = document.createElement("div");
    for (const label of ["One", "Two"]) {
      const option = document.createElement("button");
      option.setAttribute("role", "option");
      option.textContent = label;
      panel.append(option);
    }
    new DropdownWidget(root, {
      ariaLabel: "Choose",
      panel,
      trigger: "Current",
    });
    const summary = root.querySelector<HTMLElement>("summary")!;
    summary.focus();
    summary.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
    );
    await Promise.resolve();
    expect(document.activeElement?.textContent).toBe("One");
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );
    expect(document.activeElement).toBe(summary);
    root.remove();
  });

  it("opens upward when the panel does not fit below the trigger", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const panel = document.createElement("div");
    panel.className = "zaw-dropdown-panel";
    new DropdownWidget(root, {
      ariaLabel: "Choose",
      panel,
      trigger: "Current",
    });
    const summary = root.querySelector("summary")!;
    const renderedPanel = root.querySelector<HTMLElement>(
      ".zaw-dropdown-panel",
    )!;
    summary.getBoundingClientRect = () =>
      ({ bottom: 590, top: 560 }) as DOMRect;
    renderedPanel.getBoundingClientRect = () => ({ height: 120 }) as DOMRect;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 600,
    });

    const details = root.querySelector("details")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await Promise.resolve();

    expect(root.querySelector(".zaw-dropdown")?.classList).toContain("drop-up");
    expect(
      renderedPanel.style.getPropertyValue("--zaw-dropdown-max-height"),
    ).toBe("552px");
    root.remove();
  });

  it("opens upward before a clipping panel boundary", async () => {
    const clippingParent = document.createElement("div");
    clippingParent.style.overflow = "hidden";
    const root = document.createElement("div");
    clippingParent.append(root);
    document.body.append(clippingParent);
    const panel = document.createElement("div");
    panel.className = "zaw-dropdown-panel";
    new DropdownWidget(root, {
      ariaLabel: "Choose",
      panel,
      trigger: "Current",
    });
    clippingParent.getBoundingClientRect = () =>
      ({ top: 100, bottom: 420 }) as DOMRect;
    const summary = root.querySelector("summary")!;
    summary.getBoundingClientRect = () =>
      ({ bottom: 410, top: 380 }) as DOMRect;
    root.querySelector<HTMLElement>(
      ".zaw-dropdown-panel",
    )!.getBoundingClientRect = () => ({ height: 90 }) as DOMRect;

    const details = root.querySelector("details")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await Promise.resolve();

    expect(root.querySelector(".zaw-dropdown")?.classList).toContain("drop-up");
    clippingParent.remove();
  });
});
