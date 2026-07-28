import type { Credential, Template } from "@zaw/protocol";
import { inject, injectable } from "inversify";
import type {
  IManagementProvider,
  ManagementBuild,
  ManagementJob,
  ManagementModel,
  ManagementModelProvider,
  ManagementProvisioner,
  SaveCredentialInput,
  SaveModelInput,
  SaveModelProviderInput,
} from "../services/management";
import { HTTPClient } from "./http-client";

@injectable()
export class HTTPManagementProvider implements IManagementProvider {
  constructor(@inject(HTTPClient) private readonly client: HTTPClient) {}

  // ── Credentials ──
  listCredentials(): Promise<Credential[]> {
    return this.client.request<Credential[]>("/credentials");
  }

  getCredential(id: string): Promise<Credential> {
    return this.client.request<Credential>(
      `/credentials/${encodeURIComponent(id)}`,
    );
  }

  saveCredential(input: SaveCredentialInput): Promise<Credential> {
    return this.client.request<Credential>("/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  deleteCredential(id: string): Promise<void> {
    return this.client.request<void>(`/credentials/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  // ── Templates ──
  listTemplates(): Promise<Template[]> {
    return this.client.request<Template[]>("/templates");
  }

  getTemplate(id: string): Promise<Template> {
    return this.client.request<Template>(
      `/templates/${encodeURIComponent(id)}`,
    );
  }

  saveTemplate(input: Omit<Template, "id">): Promise<Template> {
    return this.client.request<Template>("/templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  deleteTemplate(id: string): Promise<void> {
    return this.client.request<void>(`/templates/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  // ── Models ──
  listModels(): Promise<ManagementModel[]> {
    return this.client.request<ManagementModel[]>("/models");
  }

  listModelProviders(): Promise<ManagementModelProvider[]> {
    return this.client.request<ManagementModelProvider[]>("/model-providers");
  }

  saveModelProvider(
    input: SaveModelProviderInput,
    id?: string,
  ): Promise<ManagementModelProvider> {
    return this.client.request<ManagementModelProvider>(
      id ? `/model-providers/${encodeURIComponent(id)}` : "/model-providers",
      {
        method: id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }

  deleteModelProvider(id: string): Promise<void> {
    return this.client.request<void>(
      `/model-providers/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }

  saveModel(input: SaveModelInput, id?: string): Promise<ManagementModel> {
    return this.client.request<ManagementModel>(
      id ? `/models/${encodeURIComponent(id)}` : "/models",
      {
        method: id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }

  deleteModel(id: string): Promise<void> {
    return this.client.request<void>(`/models/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  // ── Runtime ──
  listProvisioners(): Promise<ManagementProvisioner[]> {
    return this.client.request<ManagementProvisioner[]>("/provisioners");
  }

  listJobs(): Promise<ManagementJob[]> {
    return this.client.request<ManagementJob[]>("/provisioner-jobs");
  }

  listBuilds(): Promise<ManagementBuild[]> {
    return this.client.request<ManagementBuild[]>("/builds");
  }

  // ── Workspace operations ──
  startWorkspace(id: string): Promise<void> {
    return this.requestWorkspaceBuild(id, "start");
  }

  stopWorkspace(id: string): Promise<void> {
    return this.requestWorkspaceBuild(id, "stop");
  }

  deleteWorkspace(id: string): Promise<void> {
    return this.requestWorkspaceBuild(id, "delete");
  }

  private requestWorkspaceBuild(id: string, operation: string): Promise<void> {
    return this.client.request<void>(
      `/workspaces/${encodeURIComponent(id)}/builds`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation }),
      },
    );
  }
}
