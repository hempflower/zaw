import type { IDisposable } from "@zaw/ui";
import {
  managementViewDescriptor,
  type IManagementViewRegistry,
} from "../../services/management-view-registry";
import { CredentialManagementView } from "./credential-management-view";

export function registerCredentialManagementContribution(
  registry: IManagementViewRegistry,
): IDisposable {
  return registry.register(
    managementViewDescriptor(
      "credentials",
      "Credentials",
      "key",
      "remote",
      "Resources",
      (root, context) => {
        const widget = new CredentialManagementView(root, {
          credentials: context.credentials,
          templates: context.templates,
        });
        widget.onDidAddCredential(() =>
          context.emitAction({ kind: "addCredential" }),
        );
        widget.onDidEditCredential((id) =>
          context.emitAction({ kind: "editCredential", id }),
        );
        widget.onDidRequestDeleteCredential((id) =>
          context.emitAction({ kind: "requestDeleteCredential", id }),
        );
        return widget;
      },
      30,
    ),
  );
}
