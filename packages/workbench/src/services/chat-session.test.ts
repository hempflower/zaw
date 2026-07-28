import { describe, expect, it } from "vitest";
import { ChatSessionService } from "./chat-session";
import { ActiveSessionService } from "./active-session";
import { ContextKeyService } from "../platform/context-key/context-key-service";

describe("ChatSessionService", () => {
  it("deduplicates optimistic and acknowledged messages by stable ID", () => {
    const service = new ChatSessionService();
    const identity = { workspaceID: "one", resource: "ahp-session:/one" };
    const message = {
      id: "turn-one:user",
      kind: "message" as const,
      role: "user" as const,
      text: "hello",
    };

    service.appendEvent(identity, message);
    service.appendEvent(identity, message);

    expect(service.events(identity)).toEqual([message]);
  });

  it("isolates drafts and active turns by composite Session identity", () => {
    const service = new ChatSessionService();
    const first = { workspaceID: "one", resource: "ahp-session:/same" };
    const second = { workspaceID: "two", resource: "ahp-session:/same" };

    service.update(first, { draft: "first" });
    service.update(second, { draft: "second" });
    service.setActiveTurn(first, "turn-one");

    expect(service.composition(first).draft).toBe("first");
    expect(service.composition(second).draft).toBe("second");
    expect(service.activeTurn(first)).toBe("turn-one");
    expect(service.activeTurn(second)).toBeUndefined();
  });

  it("clears only transient message data after sending", () => {
    const service = new ChatSessionService();
    const identity = { workspaceID: "one", resource: "ahp-session:/one" };
    service.update(identity, {
      approvalMode: "allow",
      draft: "hello",
      model: "model-one",
      attachments: [
        {
          type: "embeddedResource",
          label: "image.png",
          data: "AAAA",
          contentType: "image/png",
          displayKind: "image",
        },
      ],
    });

    service.clearAfterSend(identity);

    expect(service.composition(identity)).toMatchObject({
      approvalMode: "allow",
      attachments: [],
      draft: "",
      model: "model-one",
    });
  });

  it("restores persisted attachments with the session draft", () => {
    const values = new Map<string, string>();
    const storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    } as Storage;
    const identity = { workspaceID: "one", resource: "ahp-session:/one" };
    new ChatSessionService(storage).update(identity, {
      attachments: [
        {
          contentType: "text/markdown",
          data: "# Context",
          displayKind: "document",
          label: "context.md",
          type: "embeddedResource",
        },
      ],
      draft: "Use the context",
    });

    const restored = new ChatSessionService(storage).composition(identity);

    expect(restored.attachments).toEqual([
      {
        contentType: "text/markdown",
        data: "# Context",
        displayKind: "document",
        label: "context.md",
        type: "embeddedResource",
      },
    ]);
    expect(restored.draft).toBe("Use the context");
  });

  it("updates turn and approval context keys only for the active session", () => {
    const context = new ContextKeyService();
    const active = new ActiveSessionService(context);
    const service = new ChatSessionService(undefined, context, active);
    const current = { workspaceID: "one", resource: "ahp-session:/one" };
    const other = { workspaceID: "two", resource: "ahp-session:/two" };
    active.select(current);
    service.setActiveTurn(other, "ignored");
    service.appendEvent(other, {
      kind: "approval",
      state: "pending",
      actionValue: "",
      detail: "",
      title: "",
      toolCallID: "other",
    });
    expect(context.getValue("session.turnActive")).toBe(false);
    expect(context.getValue("session.toolApprovalPending")).toBe(false);
    service.setActiveTurn(current, "turn-one");
    service.appendEvent(current, {
      kind: "approval",
      state: "pending",
      actionValue: "",
      detail: "",
      title: "",
      toolCallID: "one",
    });
    expect(context.getValue("session.turnActive")).toBe(true);
    expect(context.getValue("session.toolApprovalPending")).toBe(true);
  });

  it("coalesces streaming chunks by response part id", () => {
    const service = new ChatSessionService();
    const identity = { workspaceID: "one", resource: "ahp-session:/one" };

    service.appendMessageDelta(identity, "part-one", "Hello");
    service.appendMessageDelta(identity, "part-one", " world");

    expect(service.events(identity)).toEqual([
      {
        id: "part-one",
        kind: "message",
        role: "agent",
        text: "Hello world",
      },
    ]);
  });
});
