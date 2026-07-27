import type { Workspace } from "@zaw/protocol";

export const IWorkspaceProvider = Symbol.for("IWorkspaceProvider");

export type WorkspaceBuildOperation =
  | "rebuild-from-current-template"
  | "start"
  | "stop";

export type CreateWorkspaceInput = {
  name: string;
  parameters: Record<string, unknown>;
  templateId: string;
};

export interface IWorkspaceProvider {
  create(input: CreateWorkspaceInput): Promise<{ buildId: string; id: string }>;
  list(): Promise<Workspace[]>;
  requestBuild(
    workspaceID: string,
    operation: WorkspaceBuildOperation,
  ): Promise<{ id: string }>;
}
