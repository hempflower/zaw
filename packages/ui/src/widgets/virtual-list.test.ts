// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { VirtualList } from "./virtual-list";

describe("VirtualList", () => {
  it("only renders rows near the viewport and reuses keyed elements", () => {
    const root = document.createElement("div");
    const list = new VirtualList(
      root,
      {
        getHeight: () => 50,
        getKey: (item: number) => String(item),
        render: () => document.createElement("div"),
        update: (element, item) => {
          element.textContent = String(item);
        },
      },
      { ariaLabel: "Chats", overscan: 0, viewportHeight: 200 },
    );
    list.setItems(Array.from({ length: 10_000 }, (_, index) => index));
    const first = root.querySelector('[role="listitem"]');
    expect(root.querySelectorAll('[role="listitem"]')).toHaveLength(5);

    list.setItems(Array.from({ length: 10_000 }, (_, index) => index));
    expect(root.querySelector('[role="listitem"]')).toBe(first);
  });

  it("supports mixed row heights and reveal", () => {
    const root = document.createElement("div");
    const list = new VirtualList(
      root,
      {
        getHeight: (item: number) => item,
        getKey: (item: number) => String(item),
        render: () => document.createElement("div"),
        update: () => undefined,
      },
      { ariaLabel: "Mixed", overscan: 0, viewportHeight: 30 },
    );
    list.setItems([10, 20, 30, 40]);
    list.reveal(3);
    expect(
      root.querySelector<HTMLElement>(".zaw-virtual-list")?.scrollTop,
    ).toBe(70);
  });

  it("renders the tail of a 10,000 row list without walking every row", () => {
    const root = document.createElement("div");
    let heightReads = 0;
    let updates = 0;
    const list = new VirtualList(
      root,
      {
        getHeight: () => {
          heightReads++;
          return 20;
        },
        getKey: (item: number) => String(item),
        render: () => document.createElement("div"),
        update: () => updates++,
      },
      { ariaLabel: "Large", overscan: 0, viewportHeight: 100 },
    );
    list.setItems(Array.from({ length: 10_000 }, (_, index) => index));
    const viewport = list.getHTMLElement();
    updates = 0;
    viewport.scrollTop = 199_900;
    viewport.dispatchEvent(new Event("scroll"));
    expect(heightReads).toBe(10_000);
    expect(updates).toBeLessThanOrEqual(7);
    expect(root.textContent).not.toContain("0");
  });

  it("uses one tab stop and supports keyboard navigation and activation", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const selected: number[] = [];
    const list = new VirtualList(
      root,
      {
        getHeight: () => 20,
        getKey: String,
        render: () => {
          const button = document.createElement("button");
          button.addEventListener("click", () =>
            selected.push(Number(button.textContent)),
          );
          return button;
        },
        update: (element, item) => {
          element.textContent = String(item);
        },
      },
      { ariaLabel: "Keyboard list", overscan: 0, viewportHeight: 100 },
    );
    list.setItems([1, 2, 3]);
    const rows = Array.from(
      root.querySelectorAll<HTMLElement>('[role="listitem"]'),
    );
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1]);
    rows[0].focus();
    rows[0].dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
    );
    expect(document.activeElement).toBe(rows[1]);
    rows[1].dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    expect(selected).toEqual([2]);
    root.remove();
  });
});
