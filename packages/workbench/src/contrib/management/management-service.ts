import { Disposable, Emitter, type Event } from "@zaw/ui";
import { inject, injectable, optional } from "inversify";
import type { Credential, Template } from "@zaw/protocol";
import {
  IManagementProvider,
  type ManagementBuild,
  type ManagementJob,
  type ManagementModel,
  type ManagementModelProvider,
  type ManagementProvisioner,
} from "../../services/management";
import {
  IContextKeyService,
  type IContextKey,
} from "../../platform/context-key/context-key";
import { ManagementContext } from "../../workbench/context-keys";

export const IManagementService = Symbol.for("IManagementService");

export type ManagementSheet =
  | "confirm-credential-delete"
  | "confirm-template-delete"
  | "confirm-workspace-stop"
  | "build-logs"
  | "credential"
  | "model"
  | "model-provider"
  | "template"
  | "template-source"
  | "workspace-create"
  | null;

export type TemplateKind = "git" | "tar";

export interface IManagementService {
  // ── Read-only state ──
  readonly templates: readonly Template[];
  readonly credentials: readonly Credential[];
  readonly models: readonly ManagementModel[];
  readonly modelProviders: readonly ManagementModelProvider[];
  readonly modelsState: "error" | "idle" | "loading" | "ready";
  readonly modelsError: string;
  readonly provisioners: readonly ManagementProvisioner[];
  readonly jobs: readonly ManagementJob[];
  readonly builds: readonly ManagementBuild[];

  // ── Editing state ──
  readonly editingTemplate: Template | null;
  readonly editingCredential: Credential | null;
  readonly editingModelProvider: ManagementModelProvider | null;
  readonly editingModel: ManagementModel | null;
  readonly modelProviderID: string;
  readonly credentialKind: Credential["kind"];
  readonly templateKind: TemplateKind;
  readonly sheet: ManagementSheet;
  readonly dirty: boolean;
  readonly open: boolean;

  // ── UI state ──
  readonly managementViewID: string;
  readonly managementQuery: string;
  readonly managementHistory: readonly string[];

  // ── Pending operations ──
  readonly pendingCredentialDeleteID: string;
  readonly pendingTemplateDeleteID: string;
  readonly pendingWorkspaceID: string;

  // ── Events ──
  readonly onDidChange: Event<void>;
  readonly onDidChangeTemplates: Event<readonly Template[]>;
  readonly onDidChangeCredentials: Event<readonly Credential[]>;
  readonly onDidChangeEditing: Event<void>;
  readonly onDidChangeSheet: Event<ManagementSheet>;

  // ── Actions ──
  reload(): Promise<void>;
  reloadRuntime(): Promise<void>;

  // Template
  addTemplate(): void;
  chooseTemplateKind(kind: TemplateKind): void;
  editTemplate(id: string): void;
  saveTemplate(
    name: string,
    description: string,
    source: Record<string, unknown>,
  ): Promise<void>;
  deleteTemplate(): Promise<void>;
  requestDeleteTemplate(id: string): void;

  // Credential
  addCredential(): void;
  editCredential(id: string): void;
  setCredentialKind(kind: Credential["kind"]): void;
  saveCredential(
    name: string,
    kind: Credential["kind"],
    metadata: Record<string, string>,
    secret: Record<string, string>,
  ): Promise<void>;
  deleteCredential(id: string): Promise<void>;
  requestDeleteCredential(id: string): void;

  // Models
  addModel(providerID?: string): void;
  editModel(id: string): void;
  addModelProvider(): void;
  editModelProvider(id: string): void;
  deleteModelProvider(id: string): Promise<void>;
  deleteModel(id: string): Promise<void>;
  saveModelProvider(
    id: string,
    name: string,
    kind: ManagementModelProvider["kind"],
    apiBase: string,
    apiKey: string,
  ): Promise<void>;
  saveModel(
    providerId: string,
    name: string,
    upstreamModel: string,
    isDefault: boolean,
    capabilities: ManagementModel["capabilities"],
  ): Promise<void>;

  // Sheet
  closeSheet(): void;
  close(): void;
  openManagement(): void;
  openWorkspaceCreate(): void;
  openBuildLogs(workspaceID: string): void;
  setDirty(dirty: boolean): void;

  // Navigation
  selectManagementView(id: string): void;
  searchManagement(query: string): void;
  goBack(): void;

  // Workspace
  requestWorkspaceStop(id: string): void;
  startWorkspace(id: string): Promise<void>;
  stopWorkspace(id: string): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;

  // Lifecycle
  dispose(): void;
}

@injectable()
export class ManagementService
  extends Disposable
  implements IManagementService
{
  // ── State ──
  private _templates: Template[] = [];
  private _credentials: Credential[] = [];
  private _models: ManagementModel[] = [];
  private _modelProviders: ManagementModelProvider[] = [];
  private _modelsState: "error" | "idle" | "loading" | "ready" = "idle";
  private _modelsError = "";
  private _provisioners: ManagementProvisioner[] = [];
  private _jobs: ManagementJob[] = [];
  private _builds: ManagementBuild[] = [];

  private _editingTemplate: Template | null = null;
  private _editingCredential: Credential | null = null;
  private _editingModelProvider: ManagementModelProvider | null = null;
  private _editingModel: ManagementModel | null = null;
  private _modelProviderID = "";
  private _credentialKind: Credential["kind"] = "token";
  private _templateKind: TemplateKind = "git";
  private _sheet: ManagementSheet = null;
  private _dirty = false;
  private _open = false;

  private _managementViewID = "settings";
  private _managementQuery = "";
  private _managementHistory: string[] = [];

  private _pendingCredentialDeleteID = "";
  private _pendingTemplateDeleteID = "";
  private _pendingWorkspaceID = "";
  private reloadGeneration = 0;
  private runtimeReloadGeneration = 0;

  // ── Emitters ──
  private readonly changeEmitter = this._register(new Emitter<void>());
  private readonly templatesEmitter = this._register(
    new Emitter<readonly Template[]>(),
  );
  private readonly credentialsEmitter = this._register(
    new Emitter<readonly Credential[]>(),
  );
  private readonly editingEmitter = this._register(new Emitter<void>());
  private readonly sheetEmitter = this._register(
    new Emitter<ManagementSheet>(),
  );

  readonly onDidChange = this.changeEmitter.event;
  readonly onDidChangeTemplates = this.templatesEmitter.event;
  readonly onDidChangeCredentials = this.credentialsEmitter.event;
  readonly onDidChangeEditing = this.editingEmitter.event;
  readonly onDidChangeSheet = this.sheetEmitter.event;
  private readonly openContext: IContextKey<boolean> | undefined;
  private readonly dirtyContext: IContextKey<boolean> | undefined;

  // ── Getters ──
  get templates(): readonly Template[] {
    return this._templates;
  }
  get credentials(): readonly Credential[] {
    return this._credentials;
  }
  get models(): readonly ManagementModel[] {
    return this._models;
  }
  get modelProviders(): readonly ManagementModelProvider[] {
    return this._modelProviders;
  }
  get modelsState() {
    return this._modelsState;
  }
  get modelsError(): string {
    return this._modelsError;
  }
  get provisioners(): readonly ManagementProvisioner[] {
    return this._provisioners;
  }
  get jobs(): readonly ManagementJob[] {
    return this._jobs;
  }
  get builds(): readonly ManagementBuild[] {
    return this._builds;
  }

  get editingTemplate(): Template | null {
    return this._editingTemplate;
  }
  get editingCredential(): Credential | null {
    return this._editingCredential;
  }
  get editingModelProvider(): ManagementModelProvider | null {
    return this._editingModelProvider;
  }
  get editingModel(): ManagementModel | null {
    return this._editingModel;
  }
  get modelProviderID(): string {
    return this._modelProviderID;
  }
  get credentialKind(): Credential["kind"] {
    return this._credentialKind;
  }
  get templateKind(): TemplateKind {
    return this._templateKind;
  }
  get sheet(): ManagementSheet {
    return this._sheet;
  }
  get dirty(): boolean {
    return this._dirty;
  }
  get open(): boolean {
    return this._open;
  }

  get managementViewID(): string {
    return this._managementViewID;
  }
  get managementQuery(): string {
    return this._managementQuery;
  }
  get managementHistory(): readonly string[] {
    return this._managementHistory;
  }

  get pendingCredentialDeleteID(): string {
    return this._pendingCredentialDeleteID;
  }
  get pendingTemplateDeleteID(): string {
    return this._pendingTemplateDeleteID;
  }
  get pendingWorkspaceID(): string {
    return this._pendingWorkspaceID;
  }

  constructor(
    @inject(IManagementProvider)
    private readonly provider: IManagementProvider,
    @optional() @inject(IContextKeyService) contextKeys?: IContextKeyService,
  ) {
    super();
    this.openContext =
      contextKeys && ManagementContext.open.bindTo(contextKeys);
    this.dirtyContext =
      contextKeys && ManagementContext.dirty.bindTo(contextKeys);
  }

  private fireChange(): void {
    this.openContext?.set(this._open);
    this.dirtyContext?.set(this._dirty);
    this.changeEmitter.fire();
  }

  openManagement(): void {
    this._open = true;
    this.fireChange();
  }
  openWorkspaceCreate(): void {
    this._open = true;
    this._managementViewID = "workspaces";
    this._sheet = "workspace-create";
    this._dirty = false;
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }
  openBuildLogs(workspaceID: string): void {
    this._pendingWorkspaceID = workspaceID;
    this._sheet = "build-logs";
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }
  close(): void {
    this._open = false;
    this.closeSheet();
    this.fireChange();
  }

  // ── Reload ──
  async reload(): Promise<void> {
    const generation = ++this.reloadGeneration;
    this._modelsState = "loading";
    this._modelsError = "";
    this.fireChange();
    let templates: Template[];
    let credentials: Credential[];
    let models: ManagementModel[];
    let modelProviders: ManagementModelProvider[];
    try {
      [templates, credentials, models, modelProviders] = await Promise.all([
        this.provider.listTemplates(),
        this.provider.listCredentials(),
        this.provider.listModels(),
        this.provider.listModelProviders(),
      ]);
    } catch (error) {
      if (generation === this.reloadGeneration) {
        this._modelsState = "error";
        this._modelsError =
          error instanceof Error ? error.message : "Unable to load models";
        this.fireChange();
      }
      throw error;
    }
    if (generation !== this.reloadGeneration) return;
    this._templates = templates;
    this._credentials = credentials;
    this._models = models;
    this._modelProviders = modelProviders;
    this._modelsState = "ready";
    this.templatesEmitter.fire(this._templates);
    this.credentialsEmitter.fire(this._credentials);
    this.fireChange();
  }

  async reloadRuntime(): Promise<void> {
    const generation = ++this.runtimeReloadGeneration;
    const provisioners = await this.provider.listProvisioners();
    if (generation !== this.runtimeReloadGeneration) return;
    this._provisioners = provisioners;
    this._jobs = [];
    this._builds = [];
    this.fireChange();
  }

  // ── Template ──
  addTemplate(): void {
    this._editingTemplate = null;
    this._sheet = "template-source";
    this._dirty = false;
    this.editingEmitter.fire();
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  chooseTemplateKind(kind: TemplateKind): void {
    this._templateKind = kind;
    this._sheet = "template";
    this._dirty = false;
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  editTemplate(id: string): void {
    const template = this._templates.find((t) => t.id === id);
    if (!template) return;
    this._editingTemplate = template;
    this._templateKind = template.source.kind as TemplateKind;
    this._sheet = "template";
    this._dirty = false;
    this.editingEmitter.fire();
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  async saveTemplate(
    name: string,
    description: string,
    source: Record<string, unknown>,
  ): Promise<void> {
    await this.provider.saveTemplate({ name, description, source } as any);
    await this.reload();
    this._sheet = null;
    this._dirty = false;
    this._editingTemplate = null;
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  async deleteTemplate(): Promise<void> {
    if (!this._pendingTemplateDeleteID) return;
    await this.provider.deleteTemplate(this._pendingTemplateDeleteID);
    await this.reload();
    this._sheet = null;
    this._pendingTemplateDeleteID = "";
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  requestDeleteTemplate(id: string): void {
    this._pendingTemplateDeleteID = id;
    this._sheet = "confirm-template-delete";
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  // ── Credential ──
  addCredential(): void {
    this._sheet = "credential";
    this._editingCredential = null;
    this._credentialKind = "token";
    this._dirty = false;
    this.editingEmitter.fire();
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  editCredential(id: string): void {
    const credential = this._credentials.find((c) => c.id === id);
    if (!credential) return;
    this._editingCredential = credential;
    this._credentialKind = credential.kind;
    this._sheet = "credential";
    this._dirty = false;
    this.editingEmitter.fire();
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  setCredentialKind(kind: Credential["kind"]): void {
    this._credentialKind = kind;
    this.editingEmitter.fire();
  }

  async saveCredential(
    name: string,
    kind: Credential["kind"],
    metadata: Record<string, string>,
    secret: Record<string, string>,
  ): Promise<void> {
    await this.provider.saveCredential({ name, kind, metadata, secret });
    await this.reload();
    this._sheet = null;
    this._dirty = false;
    this._editingCredential = null;
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  async deleteCredential(id: string): Promise<void> {
    await this.provider.deleteCredential(id);
    await this.reload();
    this._sheet = null;
    this._pendingCredentialDeleteID = "";
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  requestDeleteCredential(id: string): void {
    this._pendingCredentialDeleteID = id;
    this._sheet = "confirm-credential-delete";
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  // ── Models ──
  addModelProvider(): void {
    this._editingModelProvider = null;
    this._sheet = "model-provider";
    this._dirty = false;
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  editModelProvider(id: string): void {
    const provider = this._modelProviders.find((item) => item.id === id);
    if (!provider) return;
    this._editingModelProvider = provider;
    this._sheet = "model-provider";
    this._dirty = false;
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  addModel(providerID = ""): void {
    this._editingModel = null;
    this._modelProviderID = providerID || this._modelProviders[0]?.id || "";
    this._sheet = "model";
    this._dirty = false;
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  editModel(id: string): void {
    const model = this._models.find((item) => item.id === id);
    if (!model) return;
    this._editingModel = model;
    this._modelProviderID = model.providerId;
    this._sheet = "model";
    this._dirty = false;
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  async deleteModelProvider(id: string): Promise<void> {
    await this.provider.deleteModelProvider(id);
    await this.reload();
  }

  async deleteModel(id: string): Promise<void> {
    await this.provider.deleteModel(id);
    await this.reload();
  }

  async saveModelProvider(
    id: string,
    name: string,
    kind: ManagementModelProvider["kind"],
    apiBase: string,
    apiKey: string,
  ): Promise<void> {
    await this.provider.saveModelProvider(
      { id, name, kind, apiBase, apiKey },
      this._editingModelProvider?.id,
    );
    this._editingModelProvider = null;
    await this.reload();
    this._sheet = null;
    this._dirty = false;
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  async saveModel(
    providerId: string,
    name: string,
    upstreamModel: string,
    isDefault: boolean,
    capabilities: ManagementModel["capabilities"],
  ): Promise<void> {
    await this.provider.saveModel(
      {
        providerId,
        name,
        upstreamModel,
        isDefault,
        capabilities,
      },
      this._editingModel?.id,
    );
    this._editingModel = null;
    await this.reload();
    this._sheet = null;
    this._dirty = false;
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  // ── Sheet ──
  closeSheet(): void {
    this._dirty = false;
    this._sheet = null;
    this._editingCredential = null;
    this._editingTemplate = null;
    this._editingModel = null;
    this._editingModelProvider = null;
    this.editingEmitter.fire();
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }
  setDirty(dirty: boolean): void {
    if (this._dirty === dirty) return;
    this._dirty = dirty;
    this.dirtyContext?.set(dirty);
  }
  // ── Navigation ──
  selectManagementView(id: string): void {
    if (this._managementViewID === id) return;
    this._managementHistory = [
      ...this._managementHistory,
      this._managementViewID,
    ];
    this._managementViewID = id;
    this._managementQuery = "";
    this.fireChange();
  }

  searchManagement(query: string): void {
    this._managementQuery = query;
    this.fireChange();
  }

  goBack(): void {
    if (!this._managementHistory.length) return;
    this._managementViewID =
      this._managementHistory[this._managementHistory.length - 1];
    this._managementHistory = this._managementHistory.slice(0, -1);
    this.fireChange();
  }

  // ── Workspace ──
  requestWorkspaceStop(id: string): void {
    this._pendingWorkspaceID = id;
    this._sheet = "confirm-workspace-stop";
    this.sheetEmitter.fire(this._sheet);
    this.fireChange();
  }

  async startWorkspace(id: string): Promise<void> {
    await this.provider.startWorkspace(id);
    await this.reloadRuntime();
  }

  async stopWorkspace(id: string): Promise<void> {
    await this.provider.stopWorkspace(id);
    this._sheet = null;
    this._pendingWorkspaceID = "";
    this.sheetEmitter.fire(this._sheet);
    await this.reloadRuntime();
    this.fireChange();
  }

  async deleteWorkspace(id: string): Promise<void> {
    await this.provider.deleteWorkspace(id);
    await this.reloadRuntime();
    this.fireChange();
  }
}
