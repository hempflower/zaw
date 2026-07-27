import type { Workspace } from "@zaw/protocol";
import { inject, injectable } from "inversify";
import type {
  CreateWorkspaceInput,
  IWorkspaceProvider,
  WorkspaceBuildOperation,
} from "../services/workspace";
import { HTTPClient } from "./http-client";

@injectable()
export class HTTPWorkspaceProvider implements IWorkspaceProvider {
  constructor(@inject(HTTPClient) private readonly client: HTTPClient) {}

  create(input: CreateWorkspaceInput) {
    return this.client.request<{ buildId: string; id: string }>("/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  list() {
    return this.client.request<Workspace[]>("/workspaces");
  }

  requestBuild(workspaceID: string, operation: WorkspaceBuildOperation) {
    return this.client.request<{ id: string }>(
      `/workspaces/${workspaceID}/builds`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation }),
      },
    );
  }
}
