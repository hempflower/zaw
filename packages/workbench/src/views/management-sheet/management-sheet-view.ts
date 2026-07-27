import type { Credential, Template, Workspace } from "@zaw/protocol";
import {
  ButtonWidget,
  DisposableStore,
  Emitter,
  Widget,
  append,
  createElement,
} from "@zaw/ui";
import type {
  IManagementSheetContributionRegistry,
  ManagementSheetAction,
} from "./management-sheet-contribution-registry";

export type TemplateKind = "git" | "tar";
export type ManagementSheet =
  | "confirm-revert"
  | "confirm-discard"
  | "confirm-credential-delete"
  | "confirm-workspace-stop"
  | "confirm-template-delete"
  | "credential"
  | "template"
  | "template-source"
  | "workspace"
  | "workspace-picker"
  | null;

export type ManagementSheetViewOptions = {
  credentialKind: Credential["kind"];
  credentials: Credential[];
  editingCredential: Credential | null;
  editingTemplate: Template | null;
  pendingRevertPath: string;
  pendingCredentialDeleteID: string;
  pendingTemplateDeleteID: string;
  pendingWorkspaceID: string;
  sheet: ManagementSheet;
  templateKind: TemplateKind;
  templates: Template[];
  workspaces: Workspace[];
};

export class ManagementSheetView extends Widget {
  private readonly actionForwarders: {
    [K in ManagementSheetAction["kind"]]: (
      action: Extract<ManagementSheetAction, { kind: K }>,
    ) => void;
  } = {
    chooseTemplateSource: (action) =>
      this._onDidChooseTemplateSource.fire(action.value),
    close: () => this._onDidClose.fire(),
    continueEditing: () => this._onDidContinueEditing.fire(),
    deleteCredential: () => this._onDidDeleteCredential.fire(),
    deleteTemplate: () => this._onDidDeleteTemplate.fire(),
    discardChanges: () => this._onDidDiscardChanges.fire(),
    pickWorkspace: (action) => this._onDidPickWorkspace.fire(action.value),
    revertChange: () => this._onDidRevertChange.fire(),
    saveCredential: () => this._onDidSaveCredential.fire(),
    saveTemplate: () => this._onDidSaveTemplate.fire(),
    saveWorkspace: () => this._onDidSaveWorkspace.fire(),
    setCredentialKind: (action) =>
      this._onDidSetCredentialKind.fire(action.value),
    startWorkspaceCreate: () => this._onDidStartWorkspaceCreate.fire(),
    stopWorkspace: () => this._onDidStopWorkspace.fire(),
  };
  private readonly contributionDisposables = this._register(
    new DisposableStore(),
  );
  private readonly _onDidAction = this._register(
    new Emitter<ManagementSheetAction>(),
  );
  private readonly _onDidChooseTemplateSource = this._register(
    new Emitter<TemplateKind>(),
  );
  private readonly _onDidClose = this._register(new Emitter<void>());
  private readonly _onDidContinueEditing = this._register(new Emitter<void>());
  private readonly _onDidDeleteCredential = this._register(new Emitter<void>());
  private readonly _onDidDeleteTemplate = this._register(new Emitter<void>());
  private readonly _onDidDiscardChanges = this._register(new Emitter<void>());
  private readonly _onDidPickWorkspace = this._register(new Emitter<string>());
  private readonly _onDidRevertChange = this._register(new Emitter<void>());
  private readonly _onDidSaveCredential = this._register(new Emitter<void>());
  private readonly _onDidSaveTemplate = this._register(new Emitter<void>());
  private readonly _onDidSaveWorkspace = this._register(new Emitter<void>());
  private readonly _onDidSetCredentialKind = this._register(
    new Emitter<Credential["kind"]>(),
  );
  private readonly _onDidStartWorkspaceCreate = this._register(
    new Emitter<void>(),
  );
  private readonly _onDidStopWorkspace = this._register(new Emitter<void>());
  readonly onDidChooseTemplateSource = this._onDidChooseTemplateSource.event;
  readonly onDidClose = this._onDidClose.event;
  readonly onDidContinueEditing = this._onDidContinueEditing.event;
  readonly onDidDeleteCredential = this._onDidDeleteCredential.event;
  readonly onDidDeleteTemplate = this._onDidDeleteTemplate.event;
  readonly onDidDiscardChanges = this._onDidDiscardChanges.event;
  readonly onDidPickWorkspace = this._onDidPickWorkspace.event;
  readonly onDidRevertChange = this._onDidRevertChange.event;
  readonly onDidSaveCredential = this._onDidSaveCredential.event;
  readonly onDidSaveTemplate = this._onDidSaveTemplate.event;
  readonly onDidSaveWorkspace = this._onDidSaveWorkspace.event;
  readonly onDidSetCredentialKind = this._onDidSetCredentialKind.event;
  readonly onDidStartWorkspaceCreate = this._onDidStartWorkspaceCreate.event;
  readonly onDidStopWorkspace = this._onDidStopWorkspace.event;

  constructor(
    root: HTMLElement,
    private readonly options: ManagementSheetViewOptions,
    private readonly registry: IManagementSheetContributionRegistry,
  ) {
    super(root);
    this._onDidAction.event((action) => this.forwardAction(action));
    if (!this.options.sheet) {
      this.root.replaceChildren();
      return;
    }
    const descriptor = this.registry.get(this.options.sheet);
    if (!descriptor) {
      this.root.replaceChildren();
      return;
    }
    const contentRoot = createElement("div");
    const contribution = descriptor.factory(contentRoot, {
      ...this.options,
      emitAction: (action) => this._onDidAction.fire(action),
    });
    if (contribution) this.contributionDisposables.add(contribution);
    this.sheetShell(descriptor.title, contentRoot);
  }

  private sheetShell(title: string, content: Node) {
    const fragment = document.createDocumentFragment();
    const backdrop = createElement("div", { className: "surface-backdrop" });
    this.listen(backdrop, "click", () => this._onDidClose.fire());
    const surface = createElement("section", {
      ariaLabel: title,
      className: "sheet-surface",
      role: "dialog",
    });
    surface.setAttribute("aria-modal", "true");
    const header = createElement("header");
    const close = createElement("span");
    const closeButton = new ButtonWidget(close, {
      icon: "close",
      label: "Close",
    });
    closeButton.onDidClick(
      () => this._onDidClose.fire(),
      undefined,
      this.disposables,
    );
    append(
      header,
      createElement("strong", { textContent: title }),
      ...Array.from(close.childNodes),
    );
    const body = createElement("div", { className: "sheet-content" });
    body.append(content);
    append(surface, header, body);
    fragment.append(backdrop, surface);
    this.root.replaceChildren(fragment);
  }

  private forwardAction(action: ManagementSheetAction) {
    this.actionForwarders[action.kind](action as never);
  }
}
