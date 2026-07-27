import type { IDisposable } from "@zaw/ui";
import {
  managementViewDescriptor,
  type IManagementViewRegistry,
} from "../../services/management-view-registry";
import {
  RuntimeManagementView,
  type RuntimeManagementKind,
} from "./runtime-management-view";

const runtimeViews: Array<{
  category: string;
  icon: string;
  id: RuntimeManagementKind;
  order: number;
  scope: "remote" | "workspace";
  title: string;
}> = [
  {
    category: "Runtime",
    icon: "remote-explorer",
    id: "workspaces",
    order: 40,
    scope: "workspace",
    title: "Workspaces",
  },
  {
    category: "Runtime",
    icon: "hubot",
    id: "agent-hosts",
    order: 50,
    scope: "workspace",
    title: "Agent Hosts",
  },
  {
    category: "Runtime",
    icon: "server-process",
    id: "provisioners",
    order: 60,
    scope: "remote",
    title: "Provisioners",
  },
  {
    category: "Runtime",
    icon: "output",
    id: "builds",
    order: 70,
    scope: "workspace",
    title: "Builds",
  },
];

export function registerRuntimeManagementContributions(
  registry: IManagementViewRegistry,
): IDisposable[] {
  return runtimeViews.map((view) =>
    registry.register(
      managementViewDescriptor(
        view.id,
        view.title,
        view.icon,
        view.scope,
        view.category,
        (root, context) => {
          const widget = new RuntimeManagementView(root, {
            builds: context.builds,
            jobs: context.jobs,
            kind: view.id,
            provisioners: context.provisioners,
            workspaces: context.workspaces,
          });
          widget.onDidRequestWorkspaceStop((id) =>
            context.emitAction({ kind: "requestWorkspaceStop", id }),
          );
          widget.onDidStartWorkspace((id) =>
            context.emitAction({ kind: "startWorkspace", id }),
          );
          return widget;
        },
        view.order,
      ),
    ),
  );
}
