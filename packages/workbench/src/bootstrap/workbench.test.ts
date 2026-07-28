// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { Workbench } from "./workbench";
import { LifecycleService } from "../platform/lifecycle/lifecycle-service";
import { WorkbenchLayoutService } from "../workbench/layout/layout-service";
import { Part } from "../workbench/layout/layout";

describe("Workbench", () => {
  it("reclaims the session area when either side pane is hidden", () => {
    const root = document.createElement("div");
    const layout = new WorkbenchLayoutService();
    const workbench = new Workbench(root, new LifecycleService(), layout, {
      mount: vi.fn(),
    } as never);
    workbench.start();
    const shell = root.querySelector(".zaw-workbench")!;
    const parts = Array.from(shell.querySelectorAll("[data-workbench-part]"));
    const observer = new MutationObserver(() => undefined);
    observer.observe(shell, { childList: true, subtree: true });

    layout.setVisible(Part.Sidebar, false);
    expect(shell.classList.contains("left-panel-hidden")).toBe(true);
    expect(shell.classList.contains("right-panel-hidden")).toBe(false);

    layout.setVisible(Part.AuxiliaryBar, false);
    expect(shell.classList.contains("right-panel-hidden")).toBe(true);
    const removed = observer
      .takeRecords()
      .flatMap((record) => Array.from(record.removedNodes));
    expect(removed.some((node) => parts.includes(node as Element))).toBe(false);
    observer.disconnect();
    workbench.dispose();
  });

  it("exposes keyboard-operable sashes with current dimensions", () => {
    const root = document.createElement("div");
    const layout = new WorkbenchLayoutService();
    const workbench = new Workbench(root, new LifecycleService(), layout, {
      mount: vi.fn(),
    } as never);
    workbench.start();
    const sash = root.querySelector<HTMLElement>('[data-sash="sidebar"]')!;
    expect(sash.getAttribute("role")).toBe("separator");
    expect(sash.getAttribute("aria-orientation")).toBe("vertical");
    expect(sash.getAttribute("aria-valuenow")).toBe("300");

    sash.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
    );

    expect(layout.sidebarWidth).toBe(310);
    expect(sash.getAttribute("aria-valuenow")).toBe("310");
    workbench.dispose();
  });
});
