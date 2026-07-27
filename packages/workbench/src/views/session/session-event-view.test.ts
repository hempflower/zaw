// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { SessionEventView } from "./session-event-view";
import { SessionEventRendererRegistry } from "./session-event-renderer-registry";
import { registerBuiltinSessionEventRenderers } from "./session-event.contribution";

describe("SessionEventView", () => {
  it("renders actionable approval independently from tool state", () => {
    const registry = new SessionEventRendererRegistry();
    registerBuiltinSessionEventRenderers(registry);
    const toolRoot = document.createElement("div");
    new SessionEventView(
      toolRoot,
      {
        kind: "tool",
        toolCallID: "tool-one",
        title: "Run command",
        detail: "echo ready",
        state: "pending-confirmation",
      },
      registry,
    );
    const approvalRoot = document.createElement("div");
    new SessionEventView(
      approvalRoot,
      {
        kind: "approval",
        actionValue: "target",
        toolCallID: "tool-one",
        title: "Allow shell",
        detail: "echo ready",
        state: "pending",
      },
      registry,
    );

    expect(toolRoot.querySelector(".tool-event")).toBeTruthy();
    expect(
      toolRoot.querySelector('button[aria-label="Allow tool call"]'),
    ).toBeFalsy();
    expect(
      approvalRoot.querySelector('button[aria-label="Allow tool call"]'),
    ).toBeTruthy();
    expect(
      approvalRoot.querySelector('button[aria-label="Deny tool call"]'),
    ).toBeTruthy();
  });

  it("registers renderers by kind and rejects duplicate ids", () => {
    const registry = new SessionEventRendererRegistry();
    registerBuiltinSessionEventRenderers(registry);
    expect(registry.rendererFor("message")?.id).toBe("session-event.message");
    expect(() =>
      registry.register({
        factory: () => undefined,
        id: "session-event.message",
        kind: "message",
      }),
    ).toThrow();
  });
});
