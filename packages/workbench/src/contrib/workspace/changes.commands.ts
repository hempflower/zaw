import type { IDisposable } from "@zaw/ui";
import type { ICommandRegistry } from "../../platform/commands/commands";
import { IDetailViewService } from "./detail-view-service";
import { IWorkspaceResourceService } from "./workspace-resource-service";
import { IWorkbenchViewHost } from "../../services/workbench-view-host";

export function registerChangesCommands(
  commands: ICommandRegistry,
): IDisposable[] {
  const resource = (
    id: string,
    method: "openChange" | "stageChange" | "reviewChange" | "requestRevert",
  ) =>
    commands.registerCommand(
      id,
      (accessor, path) =>
        accessor
          .get<IWorkspaceResourceService>(IWorkspaceResourceService)
          [method](path as never),
      { category: "Changes", validate: (path) => typeof path === "string" },
    );
  return [
    commands.registerCommand(
      "zaw.workspace.refresh",
      (accessor) =>
        accessor
          .get<IWorkspaceResourceService>(IWorkspaceResourceService)
          .refresh(),
      { category: "Workspace" },
    ),
    resource("zaw.workspace.openChange", "openChange"),
    resource("zaw.workspace.stageChange", "stageChange"),
    resource("zaw.workspace.reviewChange", "reviewChange"),
    resource("zaw.workspace.requestRevert", "requestRevert"),
    commands.registerCommand(
      "zaw.workspace.revert",
      (accessor) =>
        accessor
          .get<IWorkspaceResourceService>(IWorkspaceResourceService)
          .revertChange(),
      { category: "Changes" },
    ),
    commands.registerCommand(
      "zaw.workspace.showChanges",
      (accessor) => {
        accessor.get<IDetailViewService>(IDetailViewService).openChanges();
        accessor
          .get<IWorkbenchViewHost>(IWorkbenchViewHost)
          .focus("zaw.workspace.changes");
      },
      { category: "Changes" },
    ),
  ];
}
