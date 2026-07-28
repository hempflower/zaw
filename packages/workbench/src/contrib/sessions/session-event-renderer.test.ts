// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { renderSessionEvent } from "./session-event-renderer";

describe("session event renderer", () => {
  it("renders a source-aligned accessible confirmation and dispatches its decision", () => {
    const confirmToolCall = vi.fn();
    const element = renderSessionEvent(
      {
        actionValue: "ahp-chat:/one",
        detail: "Run pnpm test",
        kind: "approval",
        state: "pending",
        title: "Run command",
        toolCallID: "tool-one",
      },
      { confirmToolCall },
    );

    expect(element.tabIndex).toBe(0);
    expect(element.getAttribute("aria-label")).toContain("Run pnpm test");
    (element.querySelector(".zaw-button-primary") as HTMLButtonElement).click();
    expect(confirmToolCall).toHaveBeenCalledWith(
      "ahp-chat:/one",
      "tool-one",
      true,
    );
  });

  it("presents approval commands separately from their intention", () => {
    const element = renderSessionEvent({
      actionValue: "ahp-chat:/one",
      detail: "$ curl -sI https://example.com\nCheck connectivity",
      kind: "approval",
      state: "pending",
      title: "Allow shell",
      toolCallID: "permission-one",
    });

    expect(element.querySelector(".approval-command code")?.textContent).toBe(
      "curl -sI https://example.com",
    );
    expect(element.querySelector(".approval-description")?.textContent).toBe(
      "Check connectivity",
    );
  });

  it("uses a native disclosure for tool details", () => {
    const element = renderSessionEvent({
      detail: "src/index.ts",
      kind: "tool",
      state: "running",
      title: "Read file",
      toolCallID: "tool-one",
    });

    expect(element.tagName).toBe("DETAILS");
    expect(element.querySelector("summary")?.textContent).toContain("running");
    expect(element.querySelector(".tool-detail")?.textContent).toBe(
      "src/index.ts",
    );
  });

  it("renders sanitized markdown instead of literal message text", () => {
    const element = renderSessionEvent({
      kind: "message",
      role: "agent",
      text: "**ready** <script>danger()</script>",
    });

    expect(element.querySelector("strong")?.textContent).toBe("ready");
    expect(element.querySelector("script")).toBeNull();
  });

  it("recognizes fenced Mermaid diagrams for asynchronous rendering", () => {
    const element = renderSessionEvent({
      kind: "message",
      role: "agent",
      text: "```mermaid\ngraph TD\nA-->B\n```",
    });

    expect(
      element.querySelector("code.language-mermaid")?.textContent,
    ).toContain("A-->B");
  });
});
