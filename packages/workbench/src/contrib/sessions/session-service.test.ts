import { describe, expect, it, vi } from "vitest";
import { ActiveSessionService } from "../../services/active-session";
import { ChatSessionService } from "../../services/chat-session";
import { SessionService } from "./session-service";
import type { ISessionCatalogService } from "./session-catalog-service";
import type { IWorkspaceAttachmentService } from "../../services/workspace-attachment";

describe("SessionService", () => {
  it("creates, selects, sends and cancels through the workspace attachment", async () => {
    const host = {
      createSession: vi
        .fn()
        .mockResolvedValue({ resource: "ahp-session:/one" }),
      promptSession: vi.fn().mockResolvedValue(undefined),
      cancelTurn: vi.fn().mockResolvedValue(undefined),
      confirmToolCall: vi.fn(),
    };
    const attachment = {
      attach: vi.fn().mockResolvedValue(host),
      attached: vi.fn().mockReturnValue(host),
    } as unknown as IWorkspaceAttachmentService;
    const active = new ActiveSessionService();
    const chat = new ChatSessionService();
    const add = vi.fn();
    const commitNewSession = vi.fn();
    const catalog = { add } as unknown as ISessionCatalogService;
    const service = new SessionService(attachment, chat, active, catalog, {
      commitNewSession,
    } as never);
    const identity = await service.create("workspace-one", "One");
    expect(active.current()).toEqual(identity);
    expect(add).toHaveBeenCalledWith(identity, "One");
    expect(commitNewSession).toHaveBeenCalledWith(identity);
    chat.update(identity, { draft: "hello" });
    await service.send(identity);
    expect(host.promptSession).toHaveBeenCalledWith(
      identity.resource,
      expect.objectContaining({ text: "hello" }),
    );
    chat.setActiveTurn(identity, "turn-one");
    await service.cancel(identity);
    expect(host.cancelTurn).toHaveBeenCalledWith(identity.resource, "turn-one");
    service.confirmToolCall(identity, "ahp-chat:/one", "tool-one", true);
    expect(host.confirmToolCall).toHaveBeenCalledWith(
      "ahp-chat:/one",
      "turn-one",
      "tool-one",
      true,
    );
  });

  it("subscribes an existing session before making it active", async () => {
    const identity = { workspaceID: "one", resource: "ahp-session:/one" };
    const host = {
      attachSession: vi.fn().mockResolvedValue(undefined),
    };
    const attachment = {
      attach: vi.fn().mockResolvedValue(host),
      attached: vi.fn().mockReturnValue(host),
    };
    const active = new ActiveSessionService();
    const service = new SessionService(
      attachment as never,
      new ChatSessionService(),
      active,
      { add: vi.fn() } as never,
    );

    await service.attach(identity);

    expect(host.attachSession).toHaveBeenCalledWith(identity.resource);
    expect(active.current()).toEqual(identity);
  });

  it("preserves the draft when sending fails and exposes attachment failures", async () => {
    const host = {
      promptSession: vi.fn().mockRejectedValue(new Error("offline")),
    };
    const attachment = {
      attach: vi.fn().mockRejectedValue(new Error("connect failed")),
      attached: vi.fn().mockReturnValue(host),
    } as unknown as IWorkspaceAttachmentService;
    const identity = {
      workspaceID: "workspace-one",
      resource: "ahp-session:/one",
    };
    const chat = new ChatSessionService();
    chat.update(identity, { draft: "keep me" });
    const service = new SessionService(
      attachment,
      chat,
      new ActiveSessionService(),
      { add: vi.fn() } as unknown as ISessionCatalogService,
    );
    await expect(service.send(identity)).rejects.toThrow("offline");
    expect(chat.composition(identity).draft).toBe("keep me");
    await expect(service.create("workspace-two", "Two")).rejects.toThrow(
      "connect failed",
    );
  });

  it("sends attachment-only prompts and clears them only after success", async () => {
    const host = { promptSession: vi.fn().mockResolvedValue(undefined) };
    const attachment = {
      attached: vi.fn().mockReturnValue(host),
    } as unknown as IWorkspaceAttachmentService;
    const identity = {
      workspaceID: "workspace-one",
      resource: "ahp-session:/one",
    };
    const chat = new ChatSessionService();
    chat.update(identity, {
      attachments: [
        {
          contentType: "text/markdown",
          data: "# Context",
          displayKind: "document",
          label: "context.md",
          type: "embeddedResource",
        },
      ],
      draft: "",
    });
    const service = new SessionService(
      attachment,
      chat,
      new ActiveSessionService(),
      { add: vi.fn() } as unknown as ISessionCatalogService,
    );

    await service.send(identity);

    expect(host.promptSession).toHaveBeenCalledWith(identity.resource, {
      agent: "",
      approvalMode: "ask",
      mode: "agent",
      attachments: [expect.objectContaining({ label: "context.md" })],
      model: "",
      reasoningEffort: "",
      text: "",
    });
    expect(chat.composition(identity).attachments).toEqual([]);
  });

  it("does not send a stale hidden Plan mode", async () => {
    const host = { promptSession: vi.fn().mockResolvedValue(undefined) };
    const attachment = {
      attached: vi.fn().mockReturnValue(host),
    } as unknown as IWorkspaceAttachmentService;
    const identity = {
      workspaceID: "workspace-one",
      resource: "ahp-session:/one",
    };
    const chat = new ChatSessionService();
    chat.update(identity, { draft: "continue", mode: "plan" });
    const service = new SessionService(
      attachment,
      chat,
      new ActiveSessionService(),
      { add: vi.fn() } as unknown as ISessionCatalogService,
    );

    await service.send(identity);

    expect(host.promptSession).toHaveBeenCalledWith(
      identity.resource,
      expect.objectContaining({ mode: "agent" }),
    );
  });
});
