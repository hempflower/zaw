import type { IDisposable } from "@zaw/ui";
import { ContextKeyExpr } from "../../platform/context-key/context-key";
import type { ICommandRegistry } from "../../platform/commands/commands";
import {
  IThemeService,
  type ColorTheme,
} from "../../platform/theme/theme-service";
import { ManagementContext } from "../../workbench/context-keys";
import { IManagementService } from "./management-service";

export function registerManagementCommands(
  commands: ICommandRegistry,
): IDisposable[] {
  return [
    commands.registerCommand(
      "zaw.openSettings",
      (accessor) =>
        accessor.get<IManagementService>(IManagementService).openManagement(),
      { category: "Management" },
    ),
    commands.registerCommand(
      "zaw.management.newTemplate",
      (accessor) =>
        accessor.get<IManagementService>(IManagementService).addTemplate(),
      {
        category: "Management",
        precondition: ContextKeyExpr.has(ManagementContext.open.key),
      },
    ),
    commands.registerCommand(
      "zaw.management.newCredential",
      (accessor) =>
        accessor.get<IManagementService>(IManagementService).addCredential(),
      {
        category: "Management",
        precondition: ContextKeyExpr.has(ManagementContext.open.key),
      },
    ),
    commands.registerCommand(
      "zaw.workspace.openCreate",
      (accessor) =>
        accessor
          .get<IManagementService>(IManagementService)
          .openWorkspaceCreate(),
      { category: "Workspace" },
    ),
    commands.registerCommand(
      "zaw.theme.set",
      (accessor, theme) =>
        accessor.get<IThemeService>(IThemeService).set(theme as ColorTheme),
      {
        category: "Appearance",
        validate: (theme) =>
          theme === "dark" ||
          theme === "light" ||
          theme === "hc" ||
          theme === "system",
      },
    ),
  ];
}
