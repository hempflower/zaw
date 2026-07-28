import { Workbench } from "./bootstrap/workbench";
import { createWorkbenchContainer } from "./bootstrap/container";
import { IActionRegistry } from "./platform/actions/actions";
import { ICommandRegistry } from "./platform/commands/commands";
import { IAgentHostProviderRegistry } from "./services/agent-host-provider-registry";
import { ISessionStatusRegistry } from "./services/session-status";

export type WorkbenchExtensionPoints = Readonly<{
  actions: IActionRegistry;
  agentHostProviders: IAgentHostProviderRegistry;
  commands: ICommandRegistry;
  sessionStatuses: ISessionStatusRegistry;
}>;

export function mountWorkbench(
  root: HTMLElement,
  apiBase = "/api/v1",
  configure?: (extensions: WorkbenchExtensionPoints) => void,
) {
  const container = createWorkbenchContainer(root, apiBase);
  configure?.({
    actions: container.get(IActionRegistry),
    agentHostProviders: container.get(IAgentHostProviderRegistry),
    commands: container.get(ICommandRegistry),
    sessionStatuses: container.get(ISessionStatusRegistry),
  });
  const workbench = container.get(Workbench);
  workbench.start();
  return workbench;
}

export type {
  ActionDescriptor,
  IActionRegistry,
} from "./platform/actions/actions";
export type {
  CommandDescriptor,
  ICommandRegistry,
} from "./platform/commands/commands";

export type { IAgentHost, IAgentHostProvider } from "./services/agent-host";
export {
  AgentHostProviderRegistry,
  IAgentHostProviderRegistry,
} from "./services/agent-host-provider-registry";
export type { AgentHostProviderDescriptor } from "./services/agent-host-provider-registry";
export {
  ISessionStatusRegistry,
  SessionStatusRegistry,
} from "./services/session-status";
export type {
  SessionStatusDescriptor,
  SessionStatusPresentation,
} from "./services/session-status";
export type { IWorkspaceProvider } from "./services/workspace";
export type { IFloatingWindowService } from "./services/floating-window";
