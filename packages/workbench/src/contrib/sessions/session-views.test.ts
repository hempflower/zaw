// @vitest-environment happy-dom

import { Emitter } from "@zaw/ui";
import { describe, expect, it } from "vitest";
import type { ICommandService } from "../../platform/commands/commands";
import type { IActiveSessionService } from "../../services/active-session";
import type { IChatSessionService } from "../../services/chat-session";
import type { ISessionCatalogService } from "./session-catalog-service";
import { SessionPane } from "./session-pane";

describe("SessionPane", () => {
  it("keeps resolved approval records out of the conversation transcript", () => {
    const identity = { workspaceID: "one", resource: "ahp-session:/one" };
    const root = document.createElement("div");
    new SessionPane(
      root,
      {
        current: () => identity,
        onDidChange: new Emitter<typeof identity | null>().event,
      } as unknown as IActiveSessionService,
      {
        onDidChange: new Emitter<void>().event,
        sessionTitles: {},
      } as unknown as ISessionCatalogService,
      {
        activeTurn: () => undefined,
        composition: () => ({
          agent: "copilot",
          approvalMode: "ask" as const,
          attachments: [],
          draft: "",
          model: "",
        }),
        events: () => [
          {
            actionValue: "ahp-chat:/one",
            detail: "old approval",
            kind: "approval" as const,
            state: "approved" as const,
            title: "Allow shell",
            toolCallID: "permission-one",
          },
        ],
        onDidChange: new Emitter<typeof identity>().event,
        update: () => undefined,
      } as unknown as IChatSessionService,
      { executeCommand: async () => undefined } as ICommandService,
    );

    expect(
      root.querySelector(".agent-conversation-transcript .approval-event"),
    ).toBeNull();
  });

  it("preserves textarea identity, selection and focus across a draft update", async () => {
    const identity = { workspaceID: "one", resource: "ahp-session:/one" };
    const activeChanges = new Emitter<typeof identity | null>();
    const chatChanges = new Emitter<typeof identity>();
    let draft = "hello";
    const active = {
      current: () => identity,
      onDidChange: activeChanges.event,
    } as unknown as IActiveSessionService;
    const catalog = {
      onDidChange: new Emitter<void>().event,
      sessionTitles: { "one|ahp-session%3A%2Fone": "One" },
    } as unknown as ISessionCatalogService;
    const chat = {
      activeTurn: () => undefined,
      composition: () => ({
        agent: "copilot",
        approvalMode: "ask",
        attachments: [],
        draft,
        model: "",
      }),
      events: () => [],
      onDidChange: chatChanges.event,
      update: () => ({
        agent: "copilot",
        approvalMode: "ask",
        attachments: [],
        draft,
        model: "",
      }),
    } as unknown as IChatSessionService;
    const root = document.createElement("div");
    document.body.append(root);
    new SessionPane(root, active, catalog, chat, {
      executeCommand: async () => undefined,
    } as ICommandService);
    const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(1, 4);
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) =>
      mutations.push(...records),
    );
    observer.observe(root, { childList: true });
    draft = "hello world";
    chatChanges.fire(identity);
    await Promise.resolve();
    observer.disconnect();
    expect(root.querySelector("textarea")).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(4);
    expect(mutations).toEqual([]);
  });

  it("appends a streaming event without replacing prior message nodes", () => {
    const identity = { workspaceID: "one", resource: "ahp-session:/one" };
    const activeChanges = new Emitter<typeof identity | null>();
    const chatChanges = new Emitter<typeof identity>();
    const events = [
      { kind: "message" as const, role: "agent" as const, text: "one" },
    ];
    const active = {
      current: () => identity,
      onDidChange: activeChanges.event,
    } as unknown as IActiveSessionService;
    const catalog = {
      onDidChange: new Emitter<void>().event,
      sessionTitles: {},
    } as unknown as ISessionCatalogService;
    const chat = {
      activeTurn: () => undefined,
      composition: () => ({
        agent: "copilot",
        approvalMode: "ask" as const,
        attachments: [],
        draft: "",
        model: "",
      }),
      events: () => events,
      onDidChange: chatChanges.event,
      update: () => undefined,
    } as unknown as IChatSessionService;
    const root = document.createElement("div");
    new SessionPane(root, active, catalog, chat, {
      executeCommand: async () => undefined,
    } as ICommandService);
    const first = root.querySelector(".session-event")!;
    events.push({ kind: "message", role: "agent", text: "two" });
    chatChanges.fire(identity);
    expect(root.querySelectorAll(".session-event")).toHaveLength(2);
    expect(root.querySelector(".session-event")).toBe(first);
  });

  it("updates a streamed response without replacing its message node", () => {
    const identity = { workspaceID: "one", resource: "ahp-session:/one" };
    const chatChanges = new Emitter<typeof identity>();
    let events = [
      {
        id: "part-one",
        kind: "message" as const,
        role: "agent" as const,
        text: "Hello",
      },
    ];
    const root = document.createElement("div");
    new SessionPane(
      root,
      {
        current: () => identity,
        onDidChange: new Emitter<typeof identity | null>().event,
      } as unknown as IActiveSessionService,
      {
        onDidChange: new Emitter<void>().event,
        sessionTitles: {},
      } as unknown as ISessionCatalogService,
      {
        activeTurn: () => "turn-one",
        composition: () => ({
          agent: "copilot",
          approvalMode: "ask" as const,
          attachments: [],
          draft: "",
          model: "",
        }),
        events: () => events,
        onDidChange: chatChanges.event,
        update: () => undefined,
      } as unknown as IChatSessionService,
      { executeCommand: async () => undefined } as ICommandService,
    );
    const message = root.querySelector<HTMLElement>(".session-event")!;
    for (let index = 0; index < 10; index++) {
      events = [{ ...events[0], text: `Hello world ${index}` }];
      chatChanges.fire(identity);
    }

    expect(root.querySelector(".session-event")).toBe(message);
    expect(message.textContent).toBe("Hello world 9");
  });

  it("preserves each session view, draft focus, and scroll state across A/B switches", async () => {
    const identityA = { workspaceID: "one", resource: "ahp-session:/a" };
    const identityB = { workspaceID: "one", resource: "ahp-session:/b" };
    let current = identityA;
    const activeChanges = new Emitter<typeof identityA | null>();
    const root = document.createElement("div");
    document.body.append(root);
    new SessionPane(
      root,
      {
        current: () => current,
        onDidChange: activeChanges.event,
      } as unknown as IActiveSessionService,
      {
        onDidChange: new Emitter<void>().event,
        sessionTitles: {},
      } as unknown as ISessionCatalogService,
      {
        activeTurn: () => undefined,
        composition: (identity: typeof identityA) => ({
          agent: "copilot",
          approvalMode: "ask" as const,
          attachments: [],
          draft: identity.resource.endsWith("a") ? "draft a" : "draft b",
          model: "",
        }),
        events: () => [],
        onDidChange: new Emitter<typeof identityA>().event,
        update: () => undefined,
      } as unknown as IChatSessionService,
      { executeCommand: async () => undefined } as ICommandService,
    );
    const viewA = root.querySelector<HTMLElement>(
      ".agent-active-session-view",
    )!;
    const editorA = viewA.querySelector<HTMLTextAreaElement>("textarea")!;
    const transcriptA = viewA.querySelector<HTMLElement>(
      ".agent-conversation-transcript",
    )!;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    transcriptA.scrollTop = 48;
    editorA.focus();

    current = identityB;
    activeChanges.fire(identityB);
    current = identityA;
    activeChanges.fire(identityA);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(root.querySelectorAll(".agent-active-session-view")).toHaveLength(2);
    expect(viewA.hidden).toBe(false);
    expect(viewA.querySelector("textarea")).toBe(editorA);
    expect(transcriptA.scrollTop).toBe(48);
    expect(document.activeElement).toBe(editorA);
    root.remove();
  });
});
