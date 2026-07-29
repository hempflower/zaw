import { describe, expect, it, vi } from "vitest";
import { AHPProjectionService } from "./ahp-projection-service";
import type { ITerminalService } from "../terminal/terminal-service";
import type { IWorkspaceResourceService } from "../workspace/workspace-resource-service";
import type { IChatSessionService } from "../../services/chat-session";
import type { IWorkspaceAttachmentService } from "../../services/workspace-attachment";
import type { ISessionTodoService } from "../../services/session-todos";

describe("AHPProjectionService", () => {
  it("projects session todo metadata without appending a chat event", () => {
    const replaceFromMeta = vi.fn();
    const appendEvent = vi.fn();
    const projection = new AHPProjectionService(
      { appendOutput: vi.fn() } as unknown as ITerminalService,
      { replaceChanges: vi.fn() } as unknown as IWorkspaceResourceService,
      { appendEvent } as unknown as IChatSessionService,
      { attached: vi.fn() } as unknown as IWorkspaceAttachmentService,
      { replaceFromMeta } as unknown as ISessionTodoService,
    );

    projection.project("workspace-one", {
      action: {
        type: "session/metaChanged",
        _meta: {
          zaw_todos: {
            version: 1,
            items: [{ id: "one", title: "Implement", status: "in_progress" }],
          },
        },
      },
      channel: "ahp-session:/one",
      serverSeq: 2,
    });

    expect(replaceFromMeta).toHaveBeenCalledWith(
      { resource: "ahp-session:/one", workspaceID: "workspace-one" },
      expect.objectContaining({ zaw_todos: expect.any(Object) }),
    );
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it("projects a chat delta into the session identified by the attached host", () => {
    const terminals = { appendOutput: vi.fn() } as unknown as ITerminalService;
    const resources = {
      replaceChanges: vi.fn(),
    } as unknown as IWorkspaceResourceService;
    const appendMessageDelta = vi.fn();
    const chat = {
      appendMessageDelta,
      setActiveTurn: vi.fn(),
    } as unknown as IChatSessionService;
    const attachment = {
      attached: vi
        .fn()
        .mockReturnValue({ sessionForChat: () => "ahp-session:/one" }),
    } as unknown as IWorkspaceAttachmentService;
    const projection = new AHPProjectionService(
      terminals,
      resources,
      chat,
      attachment,
    );
    projection.project("workspace-one", {
      channel: "ahp-chat:/one",
      serverSeq: 1,
      action: { type: "chat/delta", content: "Hello", partId: "part-one" },
    });
    expect(appendMessageDelta).toHaveBeenCalledWith(
      { workspaceID: "workspace-one", resource: "ahp-session:/one" },
      "part-one",
      "Hello",
    );
  });

  it("projects turn start, deltas, completion, and errors in protocol order", () => {
    const order: string[] = [];
    const terminals = { appendOutput: vi.fn() } as unknown as ITerminalService;
    const resources = {
      replaceChanges: vi.fn(),
    } as unknown as IWorkspaceResourceService;
    const chat = {
      appendEvent: vi.fn((_, event) => order.push(`event:${event.kind}`)),
      appendMessageDelta: vi.fn(() => order.push("event:message")),
      setActiveTurn: vi.fn((_, turnID?: string) =>
        order.push(`turn:${turnID ?? "none"}`),
      ),
    } as unknown as IChatSessionService;
    const attachment = {
      attached: vi
        .fn()
        .mockReturnValue({ sessionForChat: () => "ahp-session:/one" }),
    } as unknown as IWorkspaceAttachmentService;
    const projection = new AHPProjectionService(
      terminals,
      resources,
      chat,
      attachment,
    );
    const project = (serverSeq: number, action: Record<string, unknown>) =>
      projection.project("workspace-one", {
        channel: "ahp-chat:/one",
        serverSeq,
        action,
      });

    project(1, {
      type: "chat/turnStarted",
      turnId: "turn-1",
      message: { text: "Question" },
    });
    project(2, {
      type: "chat/delta",
      content: "Hello",
      partId: "part-one",
    });
    project(3, { type: "chat/turnComplete" });
    project(4, { type: "chat/error", error: { message: "retry" } });

    expect(order).toEqual([
      "event:message",
      "turn:turn-1",
      "event:message",
      "turn:none",
      "event:error",
      "turn:none",
    ]);
  });

  it("echoes each user turn and scopes reused response part IDs", () => {
    const events: import("../../services/chat-events").ChatEvent[] = [];
    const chat = {
      appendEvent: vi.fn((_, event) => events.push(event)),
      appendMessageDelta: vi.fn((_, id, text) => {
        const existing = events.find(
          (event) => event.kind === "message" && event.id === id,
        );
        if (existing?.kind === "message") existing.text += text;
        else events.push({ id, kind: "message", role: "agent", text });
      }),
      setActiveTurn: vi.fn(),
    } as unknown as IChatSessionService;
    const projection = new AHPProjectionService(
      { appendOutput: vi.fn() } as unknown as ITerminalService,
      { replaceChanges: vi.fn() } as unknown as IWorkspaceResourceService,
      chat,
      {
        attached: () => ({ sessionForChat: () => "ahp-session:/one" }),
      } as unknown as IWorkspaceAttachmentService,
    );
    const project = (action: Record<string, unknown>) =>
      projection.project("workspace-one", {
        action,
        channel: "ahp-chat:/one",
        serverSeq: 1,
      });

    project({
      message: { text: "First" },
      turnId: "turn-one",
      type: "chat/turnStarted",
    });
    project({ content: "Answer one", partId: "markdown", type: "chat/delta" });
    project({ type: "chat/turnComplete" });
    project({
      message: { text: "Second" },
      turnId: "turn-two",
      type: "chat/turnStarted",
    });
    project({ content: "Answer two", partId: "markdown", type: "chat/delta" });

    expect(events).toEqual([
      { id: "turn-one:user", kind: "message", role: "user", text: "First" },
      {
        id: "turn-one:markdown",
        kind: "message",
        role: "agent",
        text: "Answer one",
      },
      { id: "turn-two:user", kind: "message", role: "user", text: "Second" },
      {
        id: "turn-two:markdown",
        kind: "message",
        role: "agent",
        text: "Answer two",
      },
    ]);
  });

  it("renders the protocol error message without JSON wrapping", () => {
    const appendEvent = vi.fn();
    const projection = new AHPProjectionService(
      { appendOutput: vi.fn() } as unknown as ITerminalService,
      { replaceChanges: vi.fn() } as unknown as IWorkspaceResourceService,
      { appendEvent, setActiveTurn: vi.fn() } as unknown as IChatSessionService,
      {
        attached: () => ({ sessionForChat: () => "ahp-session:/one" }),
      } as unknown as IWorkspaceAttachmentService,
    );
    projection.project("workspace-one", {
      action: {
        error: { errorType: "", message: "Unsupported reasoning effort" },
        type: "chat/error",
      },
      channel: "ahp-chat:/one",
      serverSeq: 1,
    });
    expect(appendEvent).toHaveBeenCalledWith(
      { resource: "ahp-session:/one", workspaceID: "workspace-one" },
      { kind: "error", text: "Unsupported reasoning effort" },
    );
  });

  it("projects the tool lifecycle into one replaceable event", () => {
    const identity = {
      workspaceID: "workspace-one",
      resource: "ahp-session:/one",
    };
    let events: import("../../services/chat-events").ChatEvent[] = [];
    const chat = {
      events: () => events,
      replaceEvents: vi.fn((_, next) => {
        events = [...next];
      }),
      setActiveTurn: vi.fn(),
    } as unknown as IChatSessionService;
    const projection = new AHPProjectionService(
      { appendOutput: vi.fn() } as unknown as ITerminalService,
      { replaceChanges: vi.fn() } as unknown as IWorkspaceResourceService,
      chat,
      {
        attached: () => ({ sessionForChat: () => identity.resource }),
      } as unknown as IWorkspaceAttachmentService,
    );
    const project = (serverSeq: number, action: Record<string, unknown>) =>
      projection.project(identity.workspaceID, {
        action,
        channel: "ahp-chat:/one",
        serverSeq,
      });

    project(1, {
      displayName: "Run command",
      toolCallId: "tool-one",
      toolName: "terminal",
      type: "chat/toolCallStart",
    });
    project(2, {
      confirmationTitle: "Run in terminal",
      invocationMessage: "Run tests",
      toolCallId: "tool-one",
      toolInput: "pnpm test",
      type: "chat/toolCallReady",
    });

    expect(events).toEqual([
      {
        actionValue: "ahp-chat:/one",
        detail: "pnpm test",
        kind: "approval",
        state: "pending",
        summary: "pnpm test",
        title: "Run in terminal",
        toolCallID: "tool-one",
      },
    ]);

    project(3, {
      approved: true,
      toolCallId: "tool-one",
      type: "chat/toolCallConfirmed",
    });
    expect(events).toEqual([
      expect.objectContaining({ kind: "approval", state: "approved" }),
    ]);
    project(4, {
      result: { pastTenseMessage: "Ran tests", success: true },
      toolCallId: "tool-one",
      type: "chat/toolCallComplete",
    });

    expect(events).toEqual([
      {
        detail: "Ran tests",
        kind: "tool",
        state: "completed",
        summary: "pnpm test",
        title: "Run in terminal",
        toolCallID: "tool-one",
      },
    ]);
  });

  it("formats shell approvals and removes the permission pseudo-tool once resolved", () => {
    const identity = {
      workspaceID: "workspace-one",
      resource: "ahp-session:/one",
    };
    let events: import("../../services/chat-events").ChatEvent[] = [];
    const projection = new AHPProjectionService(
      { appendOutput: vi.fn() } as unknown as ITerminalService,
      { replaceChanges: vi.fn() } as unknown as IWorkspaceResourceService,
      {
        events: () => events,
        replaceEvents: vi.fn((_, next) => (events = [...next])),
        setActiveTurn: vi.fn(),
      } as unknown as IChatSessionService,
      {
        attached: () => ({ sessionForChat: () => identity.resource }),
      } as unknown as IWorkspaceAttachmentService,
    );
    const raw = JSON.stringify({
      fullCommandText: "curl -sI https://www.baidu.com",
      intention: "Check whether Baidu is reachable",
      kind: "shell",
    });

    projection.project(identity.workspaceID, {
      action: {
        confirmationTitle: "Allow shell",
        invocationMessage: raw,
        toolCallId: "permission-1",
        toolInput: raw,
        type: "chat/toolCallReady",
      },
      channel: "ahp-chat:/one",
      serverSeq: 1,
    });
    expect(events[0]).toMatchObject({
      detail:
        "$ curl -sI https://www.baidu.com\nCheck whether Baidu is reachable",
      kind: "approval",
    });

    projection.project(identity.workspaceID, {
      action: {
        approved: true,
        toolCallId: "permission-1",
        type: "chat/toolCallConfirmed",
      },
      channel: "ahp-chat:/one",
      serverSeq: 2,
    });
    expect(events).toEqual([
      expect.objectContaining({ kind: "approval", state: "approved" }),
    ]);
  });

  it("shows a failed tool's concrete error instead of its generic status", () => {
    const identity = {
      workspaceID: "workspace-one",
      resource: "ahp-session:/one",
    };
    let events: import("../../services/chat-events").ChatEvent[] = [];
    const projection = new AHPProjectionService(
      { appendOutput: vi.fn() } as unknown as ITerminalService,
      { replaceChanges: vi.fn() } as unknown as IWorkspaceResourceService,
      {
        events: () => events,
        replaceEvents: vi.fn((_, next) => (events = [...next])),
        setActiveTurn: vi.fn(),
      } as unknown as IChatSessionService,
      {
        attached: () => ({ sessionForChat: () => identity.resource }),
      } as unknown as IWorkspaceAttachmentService,
    );
    const project = (action: Record<string, unknown>) =>
      projection.project(identity.workspaceID, {
        action,
        channel: "ahp-chat:/one",
        serverSeq: 1,
      });
    project({
      displayName: "Shell",
      toolCallId: "tool-failed",
      type: "chat/toolCallStart",
    });
    project({
      result: {
        error: { message: "curl: Could not resolve host: example.invalid" },
        pastTenseMessage: "Failed shell",
        success: false,
      },
      toolCallId: "tool-failed",
      type: "chat/toolCallComplete",
    });

    expect(events[0]).toMatchObject({
      detail: "curl: Could not resolve host: example.invalid",
      state: "failed",
    });
  });

  it("keeps response text after a tool after the tool event", () => {
    const identity = {
      workspaceID: "workspace-one",
      resource: "ahp-session:/one",
    };
    let events: import("../../services/chat-events").ChatEvent[] = [];
    const chat = {
      appendEvent: vi.fn((_, event) => events.push(event)),
      appendMessageDelta: vi.fn((_, id, text) => {
        const existing = events.find(
          (event) => event.kind === "message" && event.id === id,
        );
        if (existing?.kind === "message") existing.text += text;
        else events.push({ id, kind: "message", role: "agent", text });
      }),
      events: () => events,
      replaceEvents: vi.fn((_, next) => (events = [...next])),
      setActiveTurn: vi.fn(),
    } as unknown as IChatSessionService;
    const projection = new AHPProjectionService(
      { appendOutput: vi.fn() } as unknown as ITerminalService,
      { replaceChanges: vi.fn() } as unknown as IWorkspaceResourceService,
      chat,
      {
        attached: () => ({ sessionForChat: () => identity.resource }),
      } as unknown as IWorkspaceAttachmentService,
    );
    const project = (action: Record<string, unknown>) =>
      projection.project(identity.workspaceID, {
        action,
        channel: "ahp-chat:/one",
        serverSeq: 1,
      });

    project({ turnId: "turn", type: "chat/turnStarted" });
    project({ content: "Before", partId: "markdown", type: "chat/delta" });
    project({
      displayName: "Bash",
      toolCallId: "tool",
      type: "chat/toolCallStart",
    });
    project({
      confirmed: "approved",
      toolCallId: "tool",
      toolInput: '{"command":"pwd"}',
      type: "chat/toolCallReady",
    });
    project({ content: "After", partId: "markdown", type: "chat/delta" });

    expect(events.map((event) => event.kind)).toEqual([
      "message",
      "tool",
      "message",
    ]);
    expect(events[1]).toMatchObject({ summary: "pwd" });
    expect(events[2]).toMatchObject({
      id: "turn:markdown:segment-1",
      text: "After",
    });
  });

  it("omits a resolved permission pseudo-tool restored from a snapshot", () => {
    const replaceEvents = vi.fn();
    const projection = new AHPProjectionService(
      { appendOutput: vi.fn() } as unknown as ITerminalService,
      { replaceChanges: vi.fn() } as unknown as IWorkspaceResourceService,
      {
        replaceEvents,
        setActiveTurn: vi.fn(),
        update: vi.fn(),
      } as unknown as IChatSessionService,
      {
        attached: () => ({ sessionForChat: () => "ahp-session:/one" }),
      } as unknown as IWorkspaceAttachmentService,
    );
    projection.project("workspace-one", {
      action: {
        state: {
          turns: [
            {
              id: "turn-one",
              responseParts: [
                {
                  kind: "toolCall",
                  toolCall: {
                    _meta: { "zaw/permissionRequest": true },
                    displayName: "shell",
                    invocationMessage: '{"kind":"shell"}',
                    status: "running",
                    toolCallId: "permission-9",
                  },
                },
              ],
            },
          ],
        },
        type: "chat/snapshot",
      },
      channel: "ahp-chat:/one",
      serverSeq: 1,
    });

    expect(replaceEvents).toHaveBeenCalledWith(
      { resource: "ahp-session:/one", workspaceID: "workspace-one" },
      [],
    );
  });

  it("restores transcript, active turn, and approval from a chat snapshot", () => {
    const replaceEvents = vi.fn();
    const setActiveTurn = vi.fn();
    const update = vi.fn();
    const projection = new AHPProjectionService(
      { appendOutput: vi.fn() } as unknown as ITerminalService,
      { replaceChanges: vi.fn() } as unknown as IWorkspaceResourceService,
      {
        replaceEvents,
        setActiveTurn,
        update,
      } as unknown as IChatSessionService,
      {
        attached: () => ({ sessionForChat: () => "ahp-session:/one" }),
      } as unknown as IWorkspaceAttachmentService,
    );
    const identity = {
      resource: "ahp-session:/one",
      workspaceID: "workspace-one",
    };

    projection.project(identity.workspaceID, {
      action: {
        state: {
          activeTurn: {
            id: "turn-two",
            message: { text: "Run tests" },
            responseParts: [
              {
                kind: "toolCall",
                toolCall: {
                  confirmationTitle: "Run in terminal",
                  displayName: "Terminal",
                  invocationMessage: "Run pnpm test",
                  status: "pending-confirmation",
                  toolCallId: "tool-one",
                  toolName: "terminal",
                },
              },
            ],
          },
          draft: { text: "Then fix failures" },
          turns: [
            {
              id: "turn-one",
              message: { text: "Inspect the project" },
              responseParts: [
                {
                  content: "I found the workbench.",
                  id: "one",
                  kind: "markdown",
                },
                {
                  content: { markdown: "Connection will retry" },
                  kind: "systemNotification",
                  level: "warning",
                },
              ],
            },
          ],
        },
        type: "chat/snapshot",
      },
      channel: "ahp-chat:/one",
      serverSeq: 1,
    });

    expect(replaceEvents).toHaveBeenCalledWith(identity, [
      {
        id: "turn-one:user",
        kind: "message",
        role: "user",
        text: "Inspect the project",
      },
      {
        id: "turn-one:one",
        kind: "message",
        role: "agent",
        text: "I found the workbench.",
      },
      {
        kind: "notification",
        level: "warning",
        text: "Connection will retry",
      },
      { id: "turn-two:user", kind: "message", role: "user", text: "Run tests" },
      {
        actionValue: "ahp-chat:/one",
        detail: "Run pnpm test",
        kind: "approval",
        state: "pending",
        title: "Run in terminal",
        toolCallID: "tool-one",
      },
    ]);
    expect(setActiveTurn).toHaveBeenCalledWith(identity, "turn-two");
    expect(update).toHaveBeenCalledWith(
      identity,
      expect.objectContaining({ draft: "Then fix failures" }),
    );
  });
});
