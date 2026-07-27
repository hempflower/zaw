import type { IDisposable } from "@zaw/ui";
import {
  managementViewDescriptor,
  type IManagementViewRegistry,
} from "../../services/management-view-registry";
import { SettingsView } from "../settings/settings-view";

export function registerSettingsManagementContribution(
  registry: IManagementViewRegistry,
): IDisposable {
  return registry.register(
    managementViewDescriptor(
      "settings",
      "Common Settings",
      "settings-gear",
      "user",
      "General",
      (root, context) => {
        const widget = new SettingsView(root, { theme: context.theme });
        widget.onDidChangeTheme((value) =>
          context.emitAction({ kind: "changeTheme", value }),
        );
        return widget;
      },
      10,
    ),
  );
}
