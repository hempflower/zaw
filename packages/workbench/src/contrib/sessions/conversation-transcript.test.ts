// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../../services/chat-events";
import { ConversationTranscript } from "./conversation-transcript";

describe("ConversationTranscript", () => {
  it("updates a streaming item without replacing its root", () => {
    const transcript = new ConversationTranscript();
    const first: ChatEvent = {
      kind: "message",
      role: "agent",
      text: "one",
    };
    transcript.update([first]);
    const row = transcript.content.querySelector(".session-event");
    const observer = new MutationObserver(() => undefined);
    observer.observe(transcript.content, { childList: true, subtree: true });
    transcript.update([{ ...first, text: "two" }]);
    const removed = observer
      .takeRecords()
      .flatMap((record) => Array.from(record.removedNodes));
    expect(transcript.content.querySelector(".session-event")).toBe(row);
    expect(removed.some((node) => node === row)).toBe(false);
    expect(row?.textContent).toBe("two");
    observer.disconnect();
  });

  it("reveals scroll-to-bottom only while the reader is away from the end", () => {
    const transcript = new ConversationTranscript();
    Object.defineProperties(transcript.element, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1000 },
    });
    transcript.element.scrollTop = 100;
    transcript.element.dispatchEvent(new Event("scroll"));
    expect(transcript.scrollDownHost.hidden).toBe(false);

    transcript.scrollDownHost.querySelector("button")?.click();
    expect(transcript.element.scrollTop).toBe(1000);
    expect(transcript.scrollDownHost.hidden).toBe(true);
  });

  it("collapses consecutive tool calls into one completed steps disclosure", () => {
    const transcript = new ConversationTranscript();
    transcript.update(
      ["Read file", "Run command", "Edit file", "Run tests"].map(
        (title, index): ChatEvent => ({
          detail: title,
          kind: "tool",
          state: "completed",
          title,
          toolCallID: `tool-${index}`,
        }),
      ),
    );

    const group = transcript.content.querySelector(".tool-event-group");
    expect(group?.querySelector(":scope > summary")?.textContent).toContain(
      "Completed 4 steps",
    );
    expect(
      group?.querySelectorAll(".tool-group-items > .tool-event"),
    ).toHaveLength(4);

    (group as HTMLDetailsElement).open = true;
    transcript.update(
      ["Read file", "Run command", "Edit file", "Run tests"].map(
        (title, index): ChatEvent => ({
          detail: title,
          kind: "tool",
          state: index === 3 ? "running" : "completed",
          title,
          toolCallID: `tool-${index}`,
        }),
      ),
    );
    expect(transcript.content.querySelector(".tool-event-group")).toBe(group);
    expect((group as HTMLDetailsElement).open).toBe(true);
  });
});
