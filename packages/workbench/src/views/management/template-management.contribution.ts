import type { IDisposable } from "@zaw/ui";
import {
  managementViewDescriptor,
  type IManagementViewRegistry,
} from "../../services/management-view-registry";
import { TemplateManagementView } from "./template-management-view";

export function registerTemplateManagementContribution(
  registry: IManagementViewRegistry,
): IDisposable {
  return registry.register(
    managementViewDescriptor(
      "templates",
      "Templates",
      "repo-template",
      "remote",
      "Resources",
      (root, context) => {
        const widget = new TemplateManagementView(root, {
          templates: context.templates,
        });
        widget.onDidAddTemplate(() =>
          context.emitAction({ kind: "addTemplate" }),
        );
        widget.onDidEditTemplate((id) =>
          context.emitAction({ kind: "editTemplate", id }),
        );
        widget.onDidRequestDeleteTemplate((id) =>
          context.emitAction({ kind: "requestDeleteTemplate", id }),
        );
        return widget;
      },
      20,
    ),
  );
}
