import type { Credential, Template } from "@zaw/protocol";

export const IManagementProvider = Symbol.for("IManagementProvider");
export type SaveCredentialInput = Omit<
  Credential,
  "id" | "createdAt" | "updatedAt"
> & { secret: Record<string, string> };

/** Runtime resource types used by the management views. */
export interface ManagementModel {
  id: string;
  providerId: string;
  name: string;
  upstreamModel: string;
  isDefault: boolean;
  capabilities: ManagementModelCapabilities;
}

export interface ManagementModelCapabilities {
  textInput: boolean;
  contextWindow: number;
  imageInput?: boolean;
  audioInput?: boolean;
  fileInput?: boolean;
  reasoning?: boolean;
  tools?: boolean;
  structuredOutput?: boolean;
  streaming?: boolean;
  reasoningEfforts?: string[];
}

export interface ManagementModelProvider {
  id: string;
  name: string;
  kind: "anthropic" | "deepseek" | "openai";
  apiBase: string;
  hasApiKey: boolean;
}

export type SaveModelProviderInput = Omit<
  ManagementModelProvider,
  "hasApiKey"
> & { apiKey: string };

export type SaveModelInput = Omit<ManagementModel, "id">;

export interface ManagementProvisioner {
  id: string;
  name: string;
  addr: string;
  ready: boolean;
}

export interface ManagementJob {
  id: string;
  buildID: string;
  provisionerID: string;
  status: string;
  workspaceID: string;
}

export interface ManagementBuild {
  id: string;
  workspaceID: string;
  templateID: string;
  status: string;
}

/**
 * Typed provider for management operations.
 * Encapsulates all HTTP endpoint details; callers never pass URL strings.
 */
export interface IManagementProvider {
  // ── Credentials ──
  listCredentials(): Promise<Credential[]>;
  getCredential(id: string): Promise<Credential>;
  saveCredential(input: SaveCredentialInput): Promise<Credential>;
  deleteCredential(id: string): Promise<void>;

  // ── Templates ──
  listTemplates(): Promise<Template[]>;
  getTemplate(id: string): Promise<Template>;
  saveTemplate(input: Omit<Template, "id">): Promise<Template>;
  deleteTemplate(id: string): Promise<void>;

  // ── Models ──
  listModels(): Promise<ManagementModel[]>;
  listModelProviders(): Promise<ManagementModelProvider[]>;
  saveModelProvider(
    input: SaveModelProviderInput,
    id?: string,
  ): Promise<ManagementModelProvider>;
  deleteModelProvider(id: string): Promise<void>;
  saveModel(input: SaveModelInput, id?: string): Promise<ManagementModel>;
  deleteModel(id: string): Promise<void>;

  // ── Runtime ──
  listProvisioners(): Promise<ManagementProvisioner[]>;
  listJobs(): Promise<ManagementJob[]>;
  listBuilds(): Promise<ManagementBuild[]>;

  // ── Workspace operations ──
  startWorkspace(id: string): Promise<void>;
  stopWorkspace(id: string): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;
}
