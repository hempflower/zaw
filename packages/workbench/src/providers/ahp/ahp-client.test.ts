import { afterEach, describe, expect, it, vi } from "vitest";
import { AHP_PROTOCOL_VERSION } from "@zaw/protocol";
import { AHPClient } from "./ahp-client";

type Listener = (event: MessageEvent<string>) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readonly listeners = new Map<string, Listener[]>();
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
    queueMicrotask(() => this.emit("open", new MessageEvent("open")));
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(payload: string): void {
    this.sent.push(payload);
    const request = JSON.parse(payload) as {
      id?: number;
      method?: string;
      params?: { channel?: string };
    };
    if (request.id !== undefined) {
      let result: unknown = {};
      if (request.method === "initialize") {
        result = {
          defaultDirectory: "file:///workspace/",
          snapshots: [
            {
              resource: "ahp-root://",
              state: {
                agents: [
                  {
                    provider: "copilot",
                    displayName: "GitHub Copilot",
                    description: "Agent SDK",
                  },
                ],
                terminals: [
                  { resource: "ahp-terminal:/existing", title: "Existing" },
                ],
              },
            },
          ],
        };
      } else if (request.method === "resourceList") {
        result = {
          entries: [
            { name: "src", type: "directory" },
            { name: "README.md", type: "file" },
          ],
        };
      } else if (request.method === "resourceRead") {
        result = { data: "# Workspace\n" };
      } else if (
        request.method === "subscribe" &&
        request.params?.channel?.startsWith("ahp-session:/")
      ) {
        result = {
          snapshot: {
            resource: request.params.channel,
            state: {
              defaultChat: "ahp-chat:/default",
              _meta: {
                zaw_todos: { version: 1, items: [] },
              },
              changesets: [
                {
                  uriTemplate: "ahp-changeset:/working-tree",
                  changeKind: "uncommitted",
                },
              ],
            },
          },
        };
      } else if (
        request.method === "subscribe" &&
        request.params?.channel?.startsWith("ahp-changeset:/")
      ) {
        result = {
          snapshot: {
            resource: request.params.channel,
            state: {
              files: [
                {
                  id: "README.md",
                  edit: {
                    before: { uri: "file:///workspace/README.md" },
                    after: { uri: "file:///workspace/README.md" },
                    diff: "@@ changed",
                  },
                },
              ],
              operations: [{ id: "stage" }, { id: "revert" }],
            },
          },
        };
      } else if (request.method === "subscribe") {
        result = {
          snapshot: {
            resource: request.params?.channel,
            state: request.params?.channel?.startsWith("ahp-terminal:/")
              ? {
                  title: "Existing",
                  content: [{ type: "unclassified", value: "ready\n" }],
                }
              : {},
          },
        };
      }
      queueMicrotask(() =>
        this.emit(
          "message",
          new MessageEvent("message", {
            data: JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              result,
            }),
          }),
        ),
      );
    }
  }

  close(): void {
    this.emit("close", new MessageEvent("close"));
  }

  receive(payload: unknown): void {
    this.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify(payload),
      }),
    );
  }

  private emit(type: string, event: MessageEvent<string>): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("AHPClient", () => {
  afterEach(() => {
    MockWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  it("negotiates AHP and marks a closed connection for recovery", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "zaw.test" },
    });

    const client = await AHPClient.connect("workspace-1");

    expect(MockWebSocket.instances[0]?.url).toBe(
      "ws://zaw.test/api/v1/workspaces/workspace-1/ahp",
    );
    expect(client.workspaceDirectory()).toBe("file:///workspace/");
    expect(client.listAgents()).toEqual([
      { description: "Agent SDK", id: "copilot", name: "GitHub Copilot" },
    ]);
    expect(client.isClosed()).toBe(false);
    const initialize = JSON.parse(
      MockWebSocket.instances[0]?.sent[0] ?? "{}",
    ) as {
      params?: { protocolVersions?: string[]; clientId?: string };
    };
    expect(initialize.params?.protocolVersions).toEqual([AHP_PROTOCOL_VERSION]);
    expect(initialize.params?.clientId).toBeTruthy();

    MockWebSocket.instances[0]?.close();

    expect(client.isClosed()).toBe(true);
  });

  it("forwards root events and sends terminal resize actions", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "zaw.test" },
    });
    const client = await AHPClient.connect("workspace-1");
    const actions: string[] = [];
    const closed = vi.fn();
    client.onAction((action) => actions.push(String(action.action.type)));
    client.onClose(closed);

    MockWebSocket.instances[0]?.receive({
      jsonrpc: "2.0",
      method: "root/sessionAdded",
      params: { channel: "ahp-root://", serverSeq: 3 },
    });
    MockWebSocket.instances[0]?.receive({
      jsonrpc: "2.0",
      method: "action",
      params: {
        action: {
          type: "root/agentsChanged",
          agents: [
            {
              provider: "claude",
              displayName: "Claude",
              description: "Dynamic provider",
            },
          ],
        },
        channel: "ahp-root://",
        serverSeq: 4,
      },
    });
    client.terminalResize("ahp-terminal:/one", 120, 40);
    MockWebSocket.instances[0]?.close();

    expect(actions).toEqual(["root/sessionAdded", "root/agentsChanged"]);
    expect(client.listAgents()).toEqual([
      { description: "Dynamic provider", id: "claude", name: "Claude" },
    ]);
    expect(MockWebSocket.instances[0]?.sent.at(-1)).toContain(
      "terminal/resized",
    );
    expect(closed).toHaveBeenCalledOnce();
  });

  it("discovers and reattaches Workspace terminals from Root state", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "zaw.test" },
    });
    const client = await AHPClient.connect("workspace-1");

    expect(client.listTerminals()).toEqual([
      {
        resource: "ahp-terminal:/existing",
        title: "Existing",
        output: "",
      },
    ]);
    await expect(
      client.attachTerminal("ahp-terminal:/existing"),
    ).resolves.toEqual({
      resource: "ahp-terminal:/existing",
      title: "Existing",
      output: "ready\n",
    });
    expect(MockWebSocket.instances[0]?.sent.at(-1)).toContain(
      "terminal/claimed",
    );
  });

  it("preserves the subscribed shell prompt when creating a terminal", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "zaw.test" },
    });
    const client = await AHPClient.connect("workspace-1");

    await expect(
      client.createTerminal("ahp-terminal:/new", "Terminal"),
    ).resolves.toMatchObject({
      output: "ready\n",
      resource: "ahp-terminal:/new",
    });
  });

  it("lists and reads Workspace files through standard AHP resources", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "zaw.test" },
    });
    const client = await AHPClient.connect("workspace-1");

    await expect(client.listResources()).resolves.toEqual([
      { name: "src", type: "directory" },
      { name: "README.md", type: "file" },
    ]);
    const readme = client.resourceURI("README.md");
    expect(readme).toBe("file:///workspace/README.md");
    await expect(client.readResource(readme)).resolves.toBe("# Workspace\n");

    const messages = MockWebSocket.instances[0]?.sent.join("\n") ?? "";
    expect(messages).toContain("resourceList");
    expect(messages).toContain("resourceRead");
  });

  it("uses standard Session and Chat channels for user input", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "zaw.test" },
    });
    const client = await AHPClient.connect("workspace-1");
    const actions: Array<Record<string, unknown>> = [];
    client.onAction((event) => actions.push(event.action));
    const created = await client.createSession("AHP chat", "copilot");
    await client.promptSession(created.resource, {
      text: "hello",
      mode: "plan",
      model: "deepseek/deepseek-v4-pro",
      reasoningEffort: "high",
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
    await client.updateDraft(created.resource, { text: "next" });
    await client.cancelTurn(created.resource, "turn-one");
    client.confirmToolCall("ahp-chat:/default", "turn-one", "tool-one", true);
    const messages = MockWebSocket.instances[0]?.sent.map((payload) =>
      JSON.parse(payload),
    ) as Array<{
      method?: string;
      params?: {
        channel?: string;
        provider?: string;
        action?: {
          type?: string;
          message?: Record<string, unknown>;
        };
      };
    }>;
    expect(
      messages.find((message) => message.method === "createSession")?.params,
    ).toMatchObject({ provider: "copilot" });

    expect(messages.some((message) => message.method === "promptSession")).toBe(
      false,
    );
    expect(
      messages.some(
        (message) =>
          message.method === "dispatchAction" &&
          message.params?.channel === "ahp-chat:/default" &&
          message.params.action?.type === "chat/turnStarted",
      ),
    ).toBe(true);
    const turn = messages.find(
      (message) => message.params?.action?.type === "chat/turnStarted",
    );
    expect(turn?.params?.action?.message).toMatchObject({
      _meta: {
        "zaw/reasoningEffort": "high",
        "zaw/agentMode": "plan",
      },
      model: { id: "deepseek/deepseek-v4-pro" },
      attachments: [{ type: "embeddedResource", data: "AAAA" }],
    });
    expect(messages.map((message) => message.params?.action?.type)).toEqual(
      expect.arrayContaining([
        "chat/draftChanged",
        "chat/turnCancelled",
        "chat/toolCallConfirmed",
      ]),
    );
    expect(actions).toContainEqual({
      type: "session/snapshot",
      state: expect.objectContaining({
        _meta: { zaw_todos: { version: 1, items: [] } },
      }),
    });
  });

  it("uses standard Changeset snapshots and operations", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "zaw.test" },
    });
    const client = await AHPClient.connect("workspace-1");
    const created = await client.createSession("Changes");

    const changeset = await client.loadChangeset(created.resource);
    expect(changeset).toMatchObject({
      resource: "ahp-changeset:/working-tree",
      scope: "workspace",
      operations: ["stage", "revert"],
      files: [
        {
          id: "README.md",
          diff: "@@ changed",
          resource: "file:///workspace/README.md",
          status: "M",
        },
      ],
    });
    await client.invokeChangesetOperation(
      changeset.resource,
      "stage",
      changeset.files[0].resource,
    );
    client.setChangesReviewed(changeset.resource, ["README.md"], true);

    const sent = MockWebSocket.instances[0]?.sent.join("\n") ?? "";
    expect(sent).toContain("invokeChangesetOperation");
    expect(sent).toContain("changeset/filesReviewChanged");
    expect(sent).not.toContain("workspaceDiff");
    expect(sent).not.toContain("workspaceStage");
  });
});
