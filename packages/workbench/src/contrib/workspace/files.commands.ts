import type { IDisposable } from "@zaw/ui";
import type { ICommandRegistry } from "../../platform/commands/commands";
import { IDetailViewService } from "./detail-view-service";
import { IWorkspaceResourceService } from "./workspace-resource-service";
import { IWorkbenchLayoutService, Part } from "../../workbench/layout/layout";
import { IWorkbenchViewHost } from "../../services/workbench-view-host";

export function registerFilesCommands(
  commands: ICommandRegistry,
): IDisposable[] {
  return [
    commands.registerCommand(
      "zaw.workspace.openFile",
      async (accessor, uri) => {
        await accessor
          .get<IWorkspaceResourceService>(IWorkspaceResourceService)
          .openFile(uri as string);
        accessor
          .get<IWorkbenchViewHost>(IWorkbenchViewHost)
          .focus("zaw.workspace.preview");
      },
      { category: "Files", validate: (uri) => typeof uri === "string" },
    ),
    commands.registerCommand(
      "zaw.workspace.openDirectory",
      (accessor, uri) =>
        accessor
          .get<IWorkspaceResourceService>(IWorkspaceResourceService)
          .openDirectory(uri as string),
      { category: "Files", validate: (uri) => typeof uri === "string" },
    ),
    commands.registerCommand(
      "zaw.workspace.showFiles",
      (accessor) => {
        accessor.get<IDetailViewService>(IDetailViewService).openFiles();
        accessor
          .get<IWorkbenchViewHost>(IWorkbenchViewHost)
          .focus("zaw.workspace.files");
      },
      { category: "Files" },
    ),
    commands.registerCommand(
      "zaw.workspace.selectDetail",
      (accessor, id) =>
        accessor
          .get<IDetailViewService>(IDetailViewService)
          .select(id as string),
      { category: "Workspace", validate: (id) => typeof id === "string" },
    ),
    commands.registerCommand(
      "zaw.workspace.closeDetail",
      (accessor, id) =>
        accessor
          .get<IDetailViewService>(IDetailViewService)
          .close(id as string),
      { category: "Workspace", validate: (id) => typeof id === "string" },
    ),
    commands.registerCommand(
      "zaw.workspace.closeActiveView",
      (accessor) => {
        const details = accessor.get<IDetailViewService>(IDetailViewService);
        if (details.activeTabID !== "files") details.close(details.activeTabID);
        else {
          accessor
            .get<IWorkbenchViewHost>(IWorkbenchViewHost)
            .focus("zaw.sessions.primary");
          accessor
            .get<IWorkbenchLayoutService>(IWorkbenchLayoutService)
            .setVisible(Part.AuxiliaryBar, false);
        }
      },
      { category: "Workspace" },
    ),
  ];
}
