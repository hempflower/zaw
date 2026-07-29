// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import {
  ComposerPersistentLane,
  InterruptionLane,
  SessionTodoList,
} from "./chat-input-lanes";

describe("chat input lanes", () => {
  it("renders a collapsible session plan directly above the composer", () => {
    const plan = new SessionTodoList();
    plan.update([
      { id: "one", status: "completed", title: "Inspect protocol" },
      { id: "two", status: "in_progress", title: "Render todos" },
    ]);

    expect(plan.element.hidden).toBe(false);
    expect(plan.element.textContent).toContain("Plan (1/2)");
    expect(plan.element.querySelectorAll('[role="listitem"]')).toHaveLength(2);

    plan.element.querySelector<HTMLButtonElement>("button")?.click();
    expect(
      plan.element.querySelector<HTMLElement>(".agent-composer-todos-list")
        ?.hidden,
    ).toBe(true);

    plan.update([]);
    expect(plan.element.hidden).toBe(true);
    plan.dispose();
  });

  it("updates notifications without replacing the persistent lane or item", () => {
    const lane = new ComposerPersistentLane();
    lane.update([{ kind: "notification", level: "info", text: "Connecting" }]);
    const item = lane.element.firstElementChild;
    lane.update([{ kind: "notification", level: "warning", text: "Retrying" }]);
    expect(lane.element.firstElementChild).toBe(item);
    expect(item?.textContent).toBe("Retrying");
    expect(lane.element.hidden).toBe(false);
  });

  it("owns pending confirmations and hides after they resolve", () => {
    const confirm = vi.fn();
    const lane = new InterruptionLane({ confirmToolCall: confirm });
    lane.update([
      {
        actionValue: "ahp-chat:/one",
        detail: "Run tests",
        kind: "approval",
        state: "pending",
        title: "Terminal",
        toolCallID: "tool-one",
      },
    ]);
    expect(lane.element.hidden).toBe(false);
    lane.element
      .querySelector<HTMLButtonElement>('[aria-label="Allow Terminal"]')
      ?.click();
    expect(confirm).toHaveBeenCalledWith("ahp-chat:/one", "tool-one", true);
    lane.update([]);
    expect(lane.element.hidden).toBe(true);
  });
});
