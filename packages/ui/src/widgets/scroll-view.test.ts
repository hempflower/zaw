// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ScrollView, installScrollViews } from "./scroll-view";

afterEach(() => vi.restoreAllMocks());

describe("ScrollView", () => {
  it("adds overlay scrollbars without replacing viewport content", () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((run) => {
      run(0);
      return 1;
    });
    const viewport = document.createElement("div");
    const content = document.createElement("p");
    viewport.append(content);
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 400 },
    });

    const scrollView = ScrollView.attach(viewport);
    scrollView.layout();

    expect(viewport.classList.contains("zaw-scroll-view")).toBe(true);
    expect(viewport.contains(content)).toBe(true);
    expect(
      viewport.querySelector<HTMLElement>(".zaw-scrollbar.vertical")?.style
        .position,
    ).toBe("absolute");
    expect(
      viewport.querySelector(".zaw-scrollbar.vertical")?.classList,
    ).toContain("visible");
    scrollView.dispose();
  });

  it("automatically enhances CSS scroll containers", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const installation = installScrollViews(root);
    const viewport = document.createElement("div");
    viewport.style.overflow = "auto";
    root.append(viewport);
    await Promise.resolve();
    expect(viewport.classList.contains("zaw-scroll-view")).toBe(true);
    installation.dispose();
  });
});
