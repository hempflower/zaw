import { Workbench } from "./bootstrap/workbench";
import { createWorkbenchContainer } from "./bootstrap/container";

export function mountWorkbench(root: HTMLElement, apiBase = "/api/v1") {
  const container = createWorkbenchContainer(root, apiBase);
  return container.get(Workbench).start();
}

export type { IAgentHost, IAgentHostProvider } from "./services/agent-host";
export type { IWorkspaceProvider } from "./services/workspace";
export type { IFloatingWindowService } from "./services/floating-window";
