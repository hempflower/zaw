import type { AHPActionEnvelope } from "@zaw/protocol";
import type { ChatAttachment } from "./chat-session";

export const IAgentHostProvider = Symbol.for("IAgentHostProvider");

export type AHPAction = AHPActionEnvelope;

export type AgentMessage = {
  agent?: string;
  mode?: "agent" | "ask" | "plan";
  approvalMode?: "allow" | "ask" | "autopilot";
  attachments?: ChatAttachment[];
  model?: string;
  reasoningEffort?: string;
  text: string;
};

export type AgentTerminal = {
  output: string;
  resource: string;
  title: string;
};

export type AgentHostAgent = {
  description: string;
  id: string;
  name: string;
};

export type AgentChangesetFile = {
  diff: string;
  id: string;
  path: string;
  resource: string;
  reviewed: boolean;
  status: string;
};

export type AgentChangeset = {
  files: AgentChangesetFile[];
  operations: string[];
  resource: string;
  scope: "workspace";
};

export interface IAgentHost {
  close(): void;
  isClosed(): boolean;
  onAction(listener: (action: AHPAction) => void): () => void;
  onClose(listener: () => void): () => void;
  createSession(
    title: string,
    provider?: string,
  ): Promise<{ resource: string }>;
  listAgents(): readonly AgentHostAgent[];
  listSessions(): Promise<Array<{ resource: string; title: string }>>;
  attachSession(resource: string): Promise<void>;
  promptSession(resource: string, message: AgentMessage): Promise<void>;
  updateDraft(resource: string, message?: AgentMessage): Promise<void>;
  cancelTurn(resource: string, turnID: string): Promise<void>;
  confirmToolCall(
    chat: string,
    turnID: string,
    toolCallID: string,
    approved: boolean,
  ): void;
  createTerminal(resource: string, name: string): Promise<AgentTerminal>;
  listTerminals(): AgentTerminal[];
  attachTerminal(resource: string): Promise<AgentTerminal>;
  disposeTerminal(resource: string): Promise<void>;
  terminalInput(resource: string, data: string): void;
  terminalResize(resource: string, cols: number, rows: number): void;
  listResources(
    uri?: string,
  ): Promise<Array<{ name: string; type: "directory" | "file" }>>;
  readResource(uri: string): Promise<string>;
  resourceURI(path: string, base?: string): string;
  loadChangeset(session: string): Promise<AgentChangeset>;
  invokeChangesetOperation(
    changeset: string,
    operationID: string,
    resource: string,
  ): Promise<void>;
  setChangesReviewed(
    changeset: string,
    fileIDs: string[],
    reviewed: boolean,
  ): void;
  sessionForChat(resource: string): string | undefined;
}

export interface IAgentHostProvider {
  connect(workspaceID: string): Promise<IAgentHost>;
}
