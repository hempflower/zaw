import { describe, expect, it, vi } from "vitest";
import type {
  CommandHandler,
  ICommandRegistry,
} from "../../platform/commands/commands";
import { IActiveSessionService } from "../../services/active-session";
import { IChatSessionService } from "../../services/chat-session";
import { IWorkspaceService } from "../workspace/workspace-service";
import { ISessionService } from "./session-service";
import { ISessionCatalogService } from "./session-catalog-service";
import { registerSessionCommands } from "./session.commands";

describe("session commands", () => {
  it("creates from the new-session input and sends its initial draft", async () => {
    const handlers = new Map<string, CommandHandler>();
    registerSessionCommands({
      registerCommand: (id: string, handler: CommandHandler) => {
        handlers.set(id, handler);
        return { dispose() {} };
      },
    } as unknown as ICommandRegistry);
    const identity = {
      workspaceID: "workspace-one",
      resource: "ahp-session:/one",
    };
    const create = vi.fn().mockResolvedValue(identity);
    const send = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn();
    const services = new Map<symbol, unknown>([
      [IWorkspaceService, { selectedWorkspaceID: "workspace-one" }],
      [ISessionService, { create, send }],
      [IChatSessionService, { update }],
    ]);

    await handlers.get("zaw.session.create")?.(
      { get: <T>(id: symbol) => services.get(id) as T },
      "Implement the picker",
      {
        agent: "copilot",
        approvalMode: "ask",
        attachments: [],
        draft: "Build it",
        model: "gpt-5.6",
        reasoningEffort: "high",
      },
    );

    expect(create).toHaveBeenCalledWith(
      "workspace-one",
      "Implement the picker",
      "copilot",
    );
    expect(update).toHaveBeenCalledWith(identity, {
      agent: "copilot",
      approvalMode: "ask",
      attachments: [],
      draft: "Build it",
      model: "gpt-5.6",
      reasoningEffort: "high",
    });
    expect(send).toHaveBeenCalledWith(identity);
  });

  it("routes tool confirmation through the active session service", async () => {
    const handlers = new Map<string, CommandHandler>();
    registerSessionCommands({
      registerCommand: (id: string, handler: CommandHandler) => {
        handlers.set(id, handler);
        return { dispose() {} };
      },
    } as unknown as ICommandRegistry);
    const identity = {
      workspaceID: "workspace-one",
      resource: "ahp-session:/one",
    };
    const confirmToolCall = vi.fn();
    const services = new Map<symbol, unknown>([
      [IActiveSessionService, { current: () => identity }],
      [ISessionService, { confirmToolCall }],
    ]);

    await handlers.get("zaw.session.confirmToolCall")?.(
      { get: <T>(id: symbol) => services.get(id) as T },
      "ahp-chat:/one",
      "tool-one",
      true,
    );

    expect(confirmToolCall).toHaveBeenCalledWith(
      identity,
      "ahp-chat:/one",
      "tool-one",
      true,
    );
  });

  it("opens the untitled view without creating a backend session", async () => {
    const handlers = new Map<string, CommandHandler>();
    registerSessionCommands({
      registerCommand: (id: string, handler: CommandHandler) => {
        handlers.set(id, handler);
        return { dispose() {} };
      },
    } as unknown as ICommandRegistry);
    const clear = vi.fn();

    await handlers.get("zaw.session.new")?.({
      get: <T>(id: symbol) =>
        (id === IActiveSessionService ? { clear } : undefined) as T,
    });

    expect(clear).toHaveBeenCalledOnce();
  });

  it("selects an existing Session before its Workspace restore begins", async () => {
    const handlers = new Map<string, CommandHandler>();
    registerSessionCommands({
      registerCommand: (id: string, handler: CommandHandler) => {
        handlers.set(id, handler);
        return { dispose() {} };
      },
    } as unknown as ICommandRegistry);
    const identity = {
      resource: "ahp-session:/existing",
      workspaceID: "workspace-one",
    };
    const order: string[] = [];
    const services = new Map<symbol, unknown>([
      [IActiveSessionService, { select: () => order.push("active-session") }],
      [IWorkspaceService, { select: async () => order.push("workspace") }],
      [ISessionService, { attach: async () => order.push("attach") }],
    ]);

    await handlers.get("zaw.session.open")?.(
      { get: <T>(id: symbol) => services.get(id) as T },
      identity,
    );

    expect(order).toEqual(["active-session", "workspace", "attach"]);
  });

  it("applies catalog actions to every selected session context", async () => {
    const handlers = new Map<string, CommandHandler>();
    registerSessionCommands({
      registerCommand: (id: string, handler: CommandHandler) => {
        handlers.set(id, handler);
        return { dispose() {} };
      },
    } as unknown as ICommandRegistry);
    const togglePinned = vi.fn();
    const sessions = [
      { resource: "ahp-session:/one", workspaceID: "workspace" },
      { resource: "ahp-session:/two", workspaceID: "workspace" },
    ];

    await handlers.get("zaw.session.togglePinned")?.(
      {
        get: <T>(id: symbol) =>
          (id === ISessionCatalogService ? { togglePinned } : undefined) as T,
      },
      { session: sessions[0], sessions },
    );

    expect(togglePinned).toHaveBeenCalledTimes(2);
    expect(togglePinned).toHaveBeenNthCalledWith(1, sessions[0]);
    expect(togglePinned).toHaveBeenNthCalledWith(2, sessions[1]);
  });
});
