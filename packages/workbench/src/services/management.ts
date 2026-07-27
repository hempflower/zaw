import type { Credential, Template } from "@zaw/protocol";

export const IManagementProvider = Symbol.for("IManagementProvider");

export interface IManagementProvider {
  listCredentials(): Promise<Credential[]>;
  listTemplates(): Promise<Template[]>;
  request<T>(path: string, init?: RequestInit): Promise<T>;
}
