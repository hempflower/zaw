import type { IDisposable } from "@zaw/ui";
import type { IManagementViewRegistry } from "../../services/management-view-registry";
import { registerCredentialManagementContribution } from "./credential-management.contribution";
import { registerRuntimeManagementContributions } from "./runtime-management.contribution";
import { registerSettingsManagementContribution } from "./settings-management.contribution";
import { registerTemplateManagementContribution } from "./template-management.contribution";

export function registerBuiltinManagementViews(
  registry: IManagementViewRegistry,
): IDisposable[] {
  return [
    registerSettingsManagementContribution(registry),
    registerTemplateManagementContribution(registry),
    registerCredentialManagementContribution(registry),
    ...registerRuntimeManagementContributions(registry),
  ];
}
