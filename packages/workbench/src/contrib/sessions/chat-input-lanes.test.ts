// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { ComposerPersistentLane, InterruptionLane } from "./chat-input-lanes";

describe("chat input lanes", () => {
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
