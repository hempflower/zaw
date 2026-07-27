// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { FloatingWindowService } from "./floating-window";
import {
  FloatingWindowWidget,
  OverlayLayerWidget,
} from "../widgets/floating-window";

describe("Floating window infrastructure", () => {
  it("opens, maximizes, restores and persists bounds", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    } as unknown as Storage;
    const service = new FloatingWindowService(storage);
    service.open("management", "Settings", {
      height: 600,
      left: 80,
      top: 60,
      width: 800,
    });
    service.updateBounds({ height: 620, left: 90, top: 70, width: 820 });
    service.maximize(1280, 800);
    expect(service.current()?.maximized).toBe(true);
    service.restore();
    expect(service.current()?.bounds).toEqual({
      height: 620,
      left: 90,
      top: 70,
      width: 820,
    });
    service.close();
    service.open("management", "Settings", {
      height: 1,
      left: 1,
      top: 1,
      width: 1,
    });
    expect(service.current()?.bounds.width).toBe(820);
  });

  it("renders modal semantics and eight resize handles", () => {
    const state = {
      bounds: { height: 600, left: 80, top: 60, width: 800 },
      id: "management",
      maximized: false,
      title: "Settings",
    };
    const floatingRoot = document.createElement("div");
    new FloatingWindowWidget(floatingRoot, {
      content: document.createTextNode("Content"),
      state,
    });
    const overlayRoot = document.createElement("div");
    new OverlayLayerWidget(overlayRoot, floatingRoot.firstElementChild);
    expect(overlayRoot.querySelector('[role="dialog"]')).toBeTruthy();
    expect(overlayRoot.querySelector('[aria-modal="true"]')).toBeTruthy();
    expect(overlayRoot.querySelectorAll("[data-floating-resize]")).toHaveLength(
      8,
    );
    expect(
      overlayRoot.querySelector("[data-floating-window-drag]"),
    ).toBeTruthy();
  });
});
