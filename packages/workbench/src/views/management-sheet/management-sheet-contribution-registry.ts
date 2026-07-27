import type { Credential, Template, Workspace } from "@zaw/protocol";
import type { IDisposable } from "@zaw/ui";
import { injectable } from "inversify";
import { ContributionRegistry } from "../../services/contribution-registry";
import type { ManagementSheet, TemplateKind } from "./management-sheet-view";

export const IManagementSheetContributionRegistry = Symbol.for(
  "IManagementSheetContributionRegistry",
);

export type ManagementSheetAction =
  | { kind: "chooseTemplateSource"; value: TemplateKind }
  | { kind: "close" }
  | { kind: "continueEditing" }
  | { kind: "deleteCredential" }
  | { kind: "deleteTemplate" }
  | { kind: "discardChanges" }
  | { kind: "pickWorkspace"; value: string }
  | { kind: "revertChange" }
  | { kind: "saveCredential" }
  | { kind: "saveTemplate" }
  | { kind: "saveWorkspace" }
  | { kind: "setCredentialKind"; value: Credential["kind"] }
  | { kind: "startWorkspaceCreate" }
  | { kind: "stopWorkspace" };

export type ManagementSheetContributionContext = {
  credentialKind: Credential["kind"];
  credentials: Credential[];
  editingCredential: Credential | null;
  editingTemplate: Template | null;
  emitAction: (action: ManagementSheetAction) => void;
  pendingCredentialDeleteID: string;
  pendingRevertPath: string;
  pendingTemplateDeleteID: string;
  pendingWorkspaceID: string;
  templateKind: TemplateKind;
  templates: Template[];
  workspaces: Workspace[];
};

export type ManagementSheetContribution = IDisposable | void;

export type ManagementSheetContributionFactory = (
  root: HTMLElement,
  context: ManagementSheetContributionContext,
) => ManagementSheetContribution;

export type ManagementSheetContributionDescriptor = {
  factory: ManagementSheetContributionFactory;
  id: Exclude<ManagementSheet, null>;
  order?: number;
  title: string;
  when?: () => boolean;
};

export interface IManagementSheetContributionRegistry {
  all(): ManagementSheetContributionDescriptor[];
  get(
    id: Exclude<ManagementSheet, null>,
  ): ManagementSheetContributionDescriptor | undefined;
  register(descriptor: ManagementSheetContributionDescriptor): IDisposable;
}

@injectable()
export class ManagementSheetContributionRegistry
  extends ContributionRegistry<
    Exclude<ManagementSheet, null>,
    ManagementSheetContributionDescriptor
  >
  implements IManagementSheetContributionRegistry {}
