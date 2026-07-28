// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { OverlayService } from "./overlay-service";

describe("OverlayService", () => {
  it("inerts sibling parts, traps Escape, and cleans up its resize handle", async () => {
    const shell = document.createElement("main");
    shell.className = "zaw-workbench";
    const primary = document.createElement("div");
    const overlayPart = document.createElement("div");
    const modal = document.createElement("section");
    modal.append(document.createElement("button"));
    overlayPart.append(modal);
    shell.append(primary, overlayPart);
    document.body.append(shell);
    const close = vi.fn();
    const handle = new OverlayService().activateModal(modal, close);
    await Promise.resolve();
    expect(primary.inert).toBe(true);
    expect(modal.getAttribute("aria-modal")).toBe("true");
    expect(modal.querySelector(".zaw-floating-resize")).not.toBeNull();
    modal.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(close).toHaveBeenCalledOnce();
    handle.dispose();
    expect(primary.inert).toBe(false);
    expect(modal.querySelector(".zaw-floating-resize")).toBeNull();
  });
});
