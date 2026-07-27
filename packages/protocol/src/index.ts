export const AHP_PROTOCOL_VERSION = "0.6.0";

export type AHPJsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type AHPJsonRpcResponse<Result = unknown> = {
  jsonrpc: "2.0";
  id: number;
  result?: Result;
  error?: AHPJsonRpcError;
};

export type AHPInitializeParams = {
  channel: "ahp-root://";
  protocolVersions: string[];
  clientId: string;
  initialSubscriptions?: string[];
};

export type AHPInitializeResult = {
  protocolVersion: string;
  serverSeq: number;
  snapshots: unknown[];
  defaultDirectory?: string;
};

export type AHPActionEnvelope<Action = Record<string, unknown>> = {
  channel: string;
  action: Action;
  serverSeq: number;
};

export type AHPMuxFrame =
  | { type: "open"; streamId: string }
  | { type: "opened"; streamId: string }
  | { type: "data"; streamId: string; payload: Record<string, unknown> }
  | { type: "close"; streamId: string; reason?: string };

export type TemplateSource = {
  kind: "git" | "tar";
  url: string;
  ref?: string;
  commit?: string;
  sha256?: string;
  format?: "tar" | "tar.gz" | "tar.zst";
  directory?: string;
  credentialId?: string;
};

export type Template = {
  id: string;
  name: string;
  description: string;
  source: TemplateSource;
  createdAt: string;
  updatedAt: string;
};

export type Credential = {
  id: string;
  name: string;
  kind: "username_password" | "token" | "ssh_key";
  metadata: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type Workspace = {
  id: string;
  name: string;
  templateId: string;
  desiredState: "running" | "stopped" | "deleted";
  observedState: string;
  agentHostState: "online" | "offline" | "";
  agentHostTelemetry?: {
    health: string;
    cpuPercent: number;
    memoryBytes: number;
  };
  currentBuildId: string;
  sourceSnapshot: TemplateSource;
  parameters: Record<string, unknown>;
  createdAt: string;
};
