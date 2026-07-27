import type { Credential, Template, Workspace } from "@zaw/protocol";
import type { IDisposable } from "@zaw/ui";
import { injectable } from "inversify";
import { ContributionRegistry } from "./contribution-registry";
import type { ColorTheme } from "../views/settings/settings-view";
import type {
  RuntimeBuild,
  RuntimeJob,
  RuntimeProvisioner,
} from "../views/management/runtime-management-view";

export const IManagementViewRegistry = Symbol.for("IManagementViewRegistry");

export type ManagementViewAction =
  | { kind: "addCredential" }
  | { kind: "addTemplate" }
  | { kind: "changeTheme"; value: ColorTheme }
  | { kind: "editCredential"; id: string }
  | { kind: "editTemplate"; id: string }
  | { kind: "requestDeleteCredential"; id: string }
  | { kind: "requestDeleteTemplate"; id: string }
  | { kind: "requestWorkspaceStop"; id: string }
  | { kind: "startWorkspace"; id: string };

export type ManagementViewContributionContext = {
  builds: RuntimeBuild[];
  credentials: Credential[];
  emitAction: (action: ManagementViewAction) => void;
  jobs: RuntimeJob[];
  provisioners: RuntimeProvisioner[];
  templates: Template[];
  theme: ColorTheme;
  workspaces: Workspace[];
};

export type ManagementViewContributionFactory = (
  root: HTMLElement,
  context: ManagementViewContributionContext,
  descriptor: ManagementViewDescriptor,
) => IDisposable | void;

export type ManagementViewDescriptor = {
  category: string;
  factory: ManagementViewContributionFactory;
  icon: string;
  id: string;
  keywords: string[];
  order?: number;
  scope: "remote" | "user" | "workspace";
  title: string;
  when?: () => boolean;
};

export interface IManagementViewRegistry {
  all(): ManagementViewDescriptor[];
  get(id: string): ManagementViewDescriptor | undefined;
  register(view: ManagementViewDescriptor): IDisposable;
}

@injectable()
export class ManagementViewRegistry
  extends ContributionRegistry<string, ManagementViewDescriptor>
  implements IManagementViewRegistry {}

export function managementViewDescriptor(
  id: string,
  title: string,
  icon: string,
  scope: ManagementViewDescriptor["scope"],
  category: string,
  factory: ManagementViewContributionFactory,
  order?: number,
): ManagementViewDescriptor {
  return {
    category,
    factory,
    icon,
    id,
    keywords: [id, title, category],
    order,
    scope,
    title,
  };
}
