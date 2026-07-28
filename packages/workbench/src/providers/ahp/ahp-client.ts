import { AHP_PROTOCOL_VERSION } from "@zaw/protocol";
import type {
  AHPActionEnvelope,
  AHPInitializeParams,
  AHPInitializeResult,
  AHPJsonRpcResponse,
} from "@zaw/protocol";
import type { AgentMessage } from "../../services/agent-host";
import type { AgentTerminal } from "../../services/agent-host";
import type { AgentHostAgent } from "../../services/agent-host";
import type {
  AgentChangeset,
  AgentChangesetFile,
} from "../../services/agent-host";

export type AHPAction = AHPActionEnvelope;

export class AHPClient {
  private readonly pending = new Map<
    number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  private nextID = 1;
  private nextClientSeq = 1;
  private socket: WebSocket;
  private clientID: string;
  private defaultDirectory = "";
  private closed = false;
  private actionListeners = new Set<(action: AHPAction) => void>();
  private closeListeners = new Set<() => void>();
  private sessionChats = new Map<string, string>();
  private sessionChangesets = new Map<string, string>();
  private terminals = new Map<string, AgentTerminal>();
  private agents: AgentHostAgent[] = [];

  private constructor(socket: WebSocket, clientID: string) {
    this.socket = socket;
    this.clientID = clientID;
    socket.addEventListener("message", (event) => this.receive(event));
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const request of this.pending.values()) {
        request.reject(new Error("Agent Host connection closed"));
      }
      this.pending.clear();
      for (const listener of this.closeListeners) listener();
    });
  }

  static async connect(workspaceID: string): Promise<AHPClient> {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(
      `${scheme}://${window.location.host}/api/v1/workspaces/${workspaceID}/ahp`,
    );
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("Agent Host is offline")),
        { once: true },
      );
    });
    const clientID = workbenchClientID(workspaceID);
    const client = new AHPClient(socket, clientID);
    const initializeParams: AHPInitializeParams = {
      channel: "ahp-root://",
      protocolVersions: [AHP_PROTOCOL_VERSION],
      clientId: clientID,
      initialSubscriptions: ["ahp-root://"],
    };
    const initialized = (await client.request(
      "initialize",
      initializeParams,
    )) as AHPInitializeResult;
    client.defaultDirectory = initialized.defaultDirectory ?? "";
    client.readRootState(initialized.snapshots ?? []);
    return client;
  }

  async createSession(
    title: string,
    provider?: string,
  ): Promise<{ resource: string }> {
    const resource = `ahp-session:/${crypto.randomUUID()}`;
    await this.request("createSession", {
      channel: resource,
      ...(provider ? { provider } : {}),
    });
    const chat = await this.subscribeSession(resource);
    if (title) this.dispatch(resource, { type: "session/titleChanged", title });
    this.sessionChats.set(resource, chat);
    return { resource };
  }

  listAgents(): readonly AgentHostAgent[] {
    return this.agents;
  }

  async listSessions(): Promise<Array<{ resource: string; title: string }>> {
    const result = (await this.request("listSessions", {
      channel: "ahp-root://",
    })) as { items: Array<{ resource: string; title: string }> };
    return result.items;
  }

  async attachSession(resource: string): Promise<void> {
    if (!this.sessionChats.has(resource)) await this.subscribeSession(resource);
  }

  close() {
    this.socket.close();
  }

  isClosed(): boolean {
    return this.closed;
  }

  onAction(listener: (action: AHPAction) => void): () => void {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async createTerminal(resource: string, name: string): Promise<AgentTerminal> {
    const result = (await this.request("createTerminal", {
      channel: resource,
      claim: { kind: "client", clientId: this.clientID },
      name,
      cols: 100,
      rows: 24,
    })) as {
      snapshot?: { resource?: string; state?: Record<string, unknown> };
    };
    const created = terminalFromSnapshot(result.snapshot, resource, name);
    this.terminals.set(resource, created);
    const subscribed = (await this.request("subscribe", {
      channel: resource,
    })) as {
      snapshot?: { resource?: string; state?: Record<string, unknown> };
    };
    const terminal = terminalFromSnapshot(
      subscribed.snapshot,
      resource,
      created.title,
    );
    if (!terminal.output) terminal.output = created.output;
    this.terminals.set(resource, terminal);
    return terminal;
  }

  listTerminals(): AgentTerminal[] {
    return [...this.terminals.values()];
  }

  async attachTerminal(resource: string): Promise<AgentTerminal> {
    const result = (await this.request("subscribe", { channel: resource })) as {
      snapshot?: { state?: Record<string, unknown> };
    };
    const state = result.snapshot?.state ?? {};
    const terminal = {
      resource,
      title:
        typeof state.title === "string"
          ? state.title
          : (this.terminals.get(resource)?.title ?? "Terminal"),
      output: terminalOutput(state.content),
    };
    this.terminals.set(resource, terminal);
    this.dispatch(resource, {
      type: "terminal/claimed",
      claim: { kind: "client", clientId: this.clientID },
    });
    return terminal;
  }

  terminalInput(resource: string, data: string) {
    this.dispatch(resource, { type: "terminal/input", data });
  }

  terminalResize(resource: string, cols: number, rows: number) {
    this.dispatch(resource, { type: "terminal/resized", cols, rows });
  }

  async disposeTerminal(resource: string): Promise<void> {
    await this.request("disposeTerminal", { channel: resource });
  }

  async promptSession(resource: string, message: AgentMessage): Promise<void> {
    const chat =
      this.sessionChats.get(resource) ??
      (await this.subscribeSession(resource));
    this.sessionChats.set(resource, chat);
    const action = {
      type: "chat/turnStarted",
      turnId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      message: this.toAHPMessage(message),
    };
    this.dispatch(chat, action);
    this.emitAction({ channel: chat, action, serverSeq: 0 });
  }

  async updateDraft(resource: string, message?: AgentMessage): Promise<void> {
    const chat =
      this.sessionChats.get(resource) ??
      (await this.subscribeSession(resource));
    this.sessionChats.set(resource, chat);
    this.dispatch(chat, {
      type: "chat/draftChanged",
      ...(message ? { draft: this.toAHPMessage(message) } : {}),
    });
  }

  async cancelTurn(resource: string, turnID: string): Promise<void> {
    const chat =
      this.sessionChats.get(resource) ??
      (await this.subscribeSession(resource));
    this.sessionChats.set(resource, chat);
    this.dispatch(chat, {
      type: "chat/turnCancelled",
      turnId: turnID,
      duration: 0,
    });
  }

  confirmToolCall(
    chat: string,
    turnID: string,
    toolCallID: string,
    approved: boolean,
  ) {
    this.dispatch(chat, {
      type: "chat/toolCallConfirmed",
      turnId: turnID,
      toolCallId: toolCallID,
      approved,
      ...(approved ? { confirmed: "user-action" } : { reason: "denied" }),
    });
  }

  async listResources(uri = this.defaultDirectory): Promise<
    Array<{
      name: string;
      type: "file" | "directory";
    }>
  > {
    const result = (await this.request("resourceList", {
      channel: "ahp-root://",
      uri,
    })) as { entries: Array<{ name: string; type: "file" | "directory" }> };
    return result.entries;
  }

  async readResource(uri: string): Promise<string> {
    const result = (await this.request("resourceRead", {
      channel: "ahp-root://",
      uri,
      encoding: "utf-8",
    })) as { data: string };
    return result.data;
  }

  async loadChangeset(session: string): Promise<AgentChangeset> {
    if (!this.sessionChangesets.has(session)) {
      await this.subscribeSession(session);
    }
    const resource = this.sessionChangesets.get(session);
    if (!resource) {
      return { files: [], operations: [], resource: "", scope: "workspace" };
    }
    const result = (await this.request("subscribe", { channel: resource })) as {
      snapshot?: { state?: Record<string, unknown> };
    };
    const state = result.snapshot?.state ?? {};
    return {
      resource,
      scope: "workspace",
      files: Array.isArray(state.files)
        ? state.files.map(changesetFile).filter(isChangesetFile)
        : [],
      operations: Array.isArray(state.operations)
        ? state.operations
            .map((operation) => objectValue(operation).id)
            .filter((id): id is string => typeof id === "string")
        : [],
    };
  }

  async invokeChangesetOperation(
    changeset: string,
    operationID: string,
    resource: string,
  ): Promise<void> {
    await this.request("invokeChangesetOperation", {
      channel: changeset,
      operationId: operationID,
      target: { kind: "resource", resource },
    });
  }

  setChangesReviewed(changeset: string, fileIDs: string[], reviewed: boolean) {
    this.dispatch(changeset, {
      type: "changeset/filesReviewChanged",
      files: fileIDs,
      reviewed,
    });
  }

  resourceURI(name: string, base = this.defaultDirectory): string {
    return new URL(name, `${base.replace(/\/$/, "")}/`).toString();
  }

  workspaceDirectory(): string {
    return this.defaultDirectory;
  }

  sessionForChat(chat: string): string | undefined {
    for (const [session, resource] of this.sessionChats) {
      if (resource === chat) return session;
    }
    return undefined;
  }

  private toAHPMessage(message: AgentMessage) {
    const meta = {
      ...(message.reasoningEffort
        ? { "zaw/reasoningEffort": message.reasoningEffort }
        : {}),
      ...(message.approvalMode
        ? { "zaw/approvalMode": message.approvalMode }
        : {}),
      ...(message.mode ? { "zaw/agentMode": message.mode } : {}),
    };
    return {
      text: message.text,
      origin: { kind: "user" },
      ...(message.attachments?.length
        ? { attachments: message.attachments }
        : {}),
      ...(message.model ? { model: { id: message.model } } : {}),
      ...(Object.keys(meta).length ? { _meta: meta } : {}),
      ...(message.agent?.startsWith("agent:")
        ? { agent: { uri: message.agent } }
        : {}),
    };
  }

  private request(method: string, params: object): Promise<unknown> {
    const id = this.nextID++;
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  private async subscribeSession(resource: string): Promise<string> {
    const result = (await this.request("subscribe", { channel: resource })) as {
      snapshot?: {
        state?: {
          changesets?: unknown[];
          defaultChat?: string;
        };
      };
    };
    const chat = result.snapshot?.state?.defaultChat;
    if (!chat)
      throw new Error("Agent Host did not provide a default Chat channel");
    this.sessionChats.set(resource, chat);
    const changesets = result.snapshot?.state?.changesets;
    if (Array.isArray(changesets)) {
      const uriTemplate = objectValue(changesets[0]).uriTemplate;
      if (typeof uriTemplate === "string" && !uriTemplate.includes("{")) {
        this.sessionChangesets.set(resource, uriTemplate);
      }
    }
    const chatResult = (await this.request("subscribe", { channel: chat })) as {
      snapshot?: { fromSeq?: number; state?: Record<string, unknown> };
    };
    if (chatResult.snapshot?.state) {
      this.emitAction({
        channel: chat,
        action: { type: "chat/snapshot", state: chatResult.snapshot.state },
        serverSeq: chatResult.snapshot.fromSeq ?? 0,
      });
    }
    return chat;
  }

  private emitAction(action: AHPAction) {
    for (const listener of this.actionListeners) listener(action);
  }

  private dispatch(channel: string, action: object) {
    this.socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "dispatchAction",
        params: { channel, clientSeq: this.nextClientSeq++, action },
      }),
    );
  }

  private receive(event: MessageEvent<string>) {
    const payload = JSON.parse(event.data) as Partial<AHPJsonRpcResponse> & {
      method?: string;
      params?: AHPAction;
    };
    if (payload.method === "action" && payload.params) {
      this.applyTerminalAction(payload.params);
      this.emitAction(payload.params);
      return;
    }
    if (payload.method && payload.params) {
      const params = payload.params as Record<string, unknown>;
      const channel =
        typeof params.channel === "string" ? params.channel : "ahp-root://";
      const serverSeq =
        typeof params.serverSeq === "number" ? params.serverSeq : 0;
      this.emitAction({
        channel,
        action: { type: payload.method, ...params },
        serverSeq,
      });
      return;
    }
    if (typeof payload.id !== "number") {
      return;
    }
    const request = this.pending.get(payload.id);
    if (!request) {
      return;
    }
    this.pending.delete(payload.id);
    if (payload.error) {
      request.reject(new Error(payload.error.message));
      return;
    }
    request.resolve(payload.result);
  }

  private readRootState(snapshots: unknown[]) {
    for (const snapshotValue of snapshots) {
      const snapshot = objectValue(snapshotValue);
      if (snapshot.resource !== "ahp-root://") continue;
      const state = objectValue(snapshot.state);
      this.replaceAgents(state.agents);
      this.replaceTerminals(state.terminals);
    }
  }

  private applyTerminalAction(envelope: AHPAction) {
    if (envelope.action.type === "root/agentsChanged") {
      this.replaceAgents(envelope.action.agents);
      return;
    }
    if (envelope.action.type === "root/terminalsChanged") {
      this.replaceTerminals(envelope.action.terminals);
      return;
    }
    const terminal = this.terminals.get(envelope.channel);
    if (!terminal) return;
    if (
      envelope.action.type === "terminal/data" &&
      typeof envelope.action.data === "string"
    ) {
      terminal.output += envelope.action.data;
    }
    if (
      envelope.action.type === "terminal/titleChanged" &&
      typeof envelope.action.title === "string"
    ) {
      terminal.title = envelope.action.title;
    }
  }

  private replaceAgents(value: unknown) {
    if (!Array.isArray(value)) {
      this.agents = [];
      return;
    }
    this.agents = value.flatMap((entry) => {
      const agent = objectValue(entry);
      if (typeof agent.provider !== "string") return [];
      return [
        {
          description:
            typeof agent.description === "string" ? agent.description : "",
          id: agent.provider,
          name:
            typeof agent.displayName === "string"
              ? agent.displayName
              : agent.provider,
        },
      ];
    });
  }

  private replaceTerminals(value: unknown) {
    if (!Array.isArray(value)) return;
    const next = new Map<string, AgentTerminal>();
    for (const itemValue of value) {
      const item = objectValue(itemValue);
      if (typeof item.resource !== "string") continue;
      const existing = this.terminals.get(item.resource);
      next.set(item.resource, {
        resource: item.resource,
        title: typeof item.title === "string" ? item.title : "Terminal",
        output: existing?.output ?? "",
      });
    }
    this.terminals = next;
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function terminalOutput(value: unknown) {
  if (!Array.isArray(value)) return "";
  return value
    .map((partValue) => {
      const part = objectValue(partValue);
      return typeof part.output === "string"
        ? part.output
        : typeof part.value === "string"
          ? part.value
          : "";
    })
    .join("");
}

function terminalFromSnapshot(
  snapshot: { resource?: string; state?: Record<string, unknown> } | undefined,
  resource: string,
  fallbackTitle: string,
): AgentTerminal {
  const state = snapshot?.state ?? {};
  return {
    resource: snapshot?.resource ?? resource,
    title: typeof state.title === "string" ? state.title : fallbackTitle,
    output: terminalOutput(state.content),
  };
}

function workbenchClientID(workspaceID: string) {
  const key = `zaw.ahp-client.${workspaceID}`;
  try {
    const persistence = window.sessionStorage;
    const existing = persistence?.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    persistence?.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function changesetFile(value: unknown): AgentChangesetFile | undefined {
  const file = objectValue(value);
  const edit = objectValue(file.edit);
  const before = objectValue(edit.before);
  const after = objectValue(edit.after);
  const resource =
    typeof after.uri === "string"
      ? after.uri
      : typeof before.uri === "string"
        ? before.uri
        : "";
  if (typeof file.id !== "string" || !resource) return undefined;
  const status =
    Object.keys(before).length === 0
      ? "A"
      : Object.keys(after).length === 0
        ? "D"
        : "M";
  return {
    diff:
      typeof edit.diff === "string"
        ? edit.diff
        : edit.diff
          ? JSON.stringify(edit.diff, null, 2)
          : "",
    id: file.id,
    path: file.id,
    resource,
    reviewed: file.reviewed === true,
    status,
  };
}

function isChangesetFile(
  value: AgentChangesetFile | undefined,
): value is AgentChangesetFile {
  return value !== undefined;
}
