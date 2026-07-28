import { Disposable, Emitter, type Event } from "@zaw/ui";
import { inject, injectable } from "inversify";
import type { IAgentHost } from "../../services/agent-host";
import { IWorkspaceAttachmentService } from "../../services/workspace-attachment";
import { IDetailViewService } from "./detail-view-service";

export const IWorkspaceResourceService = Symbol.for(
  "IWorkspaceResourceService",
);

export interface WorkspaceChange {
  diff: string;
  id: string;
  path: string;
  resource: string;
  reviewed: boolean;
  status: string;
}

export interface WorkspaceFile {
  name: string;
  type: "directory" | "file";
  uri: string;
}

export interface IWorkspaceResourceService {
  readonly changes: Record<string, WorkspaceChange[]>;
  readonly files: Record<string, WorkspaceFile[]>;
  readonly fileChildren: Record<string, Record<string, WorkspaceFile[]>>;
  readonly pendingRevertPath: string;
  readonly workspaceErrors: Record<string, string>;
  readonly workspaceStates: Record<
    string,
    "error" | "idle" | "loading" | "ready"
  >;
  readonly onDidChange: Event<void>;

  loadWorkspace(
    workspaceID: string,
    client: IAgentHost,
    sessionResource?: string,
  ): Promise<void>;
  refresh(): Promise<void>;
  openFile(uri: string): Promise<void>;
  openDirectory(uri: string): Promise<void>;
  openChange(path: string): void;
  stageChange(path: string): Promise<void>;
  revertChange(): Promise<void>;
  requestRevert(path: string): void;
  reviewChange(path: string): void;
  replaceChanges(
    workspaceID: string,
    changesetResource: string,
    changes: readonly WorkspaceChange[],
  ): void;
}

@injectable()
export class WorkspaceResourceService
  extends Disposable
  implements IWorkspaceResourceService
{
  private _changes: Record<string, WorkspaceChange[]> = {};
  private _files: Record<string, WorkspaceFile[]> = {};
  private _fileChildren: Record<string, Record<string, WorkspaceFile[]>> = {};
  private _pendingRevertPath = "";
  private _workspaceErrors: Record<string, string> = {};
  private _workspaceStates: Record<
    string,
    "error" | "idle" | "loading" | "ready"
  > = {};
  private changesetResources: Record<string, string> = {};
  private readonly generations = new Map<string, number>();
  private readonly changeEmitter = this._register(new Emitter<void>());

  readonly onDidChange = this.changeEmitter.event;

  get changes() {
    return this._changes;
  }
  get files() {
    return this._files;
  }
  get fileChildren() {
    return this._fileChildren;
  }
  get pendingRevertPath() {
    return this._pendingRevertPath;
  }
  get workspaceErrors() {
    return this._workspaceErrors;
  }
  get workspaceStates() {
    return this._workspaceStates;
  }

  constructor(
    @inject(IWorkspaceAttachmentService)
    private readonly attachmentService: IWorkspaceAttachmentService,
    @inject(IDetailViewService) private readonly details: IDetailViewService,
  ) {
    super();
  }

  private fireChange(): void {
    this.changeEmitter.fire();
  }

  async loadWorkspace(
    workspaceID: string,
    client: IAgentHost,
    sessionResource?: string,
  ): Promise<void> {
    const generationKey = `${workspaceID}|root`;
    const generation = (this.generations.get(generationKey) ?? 0) + 1;
    this.generations.set(generationKey, generation);
    this._workspaceStates[workspaceID] = "loading";
    this._workspaceErrors[workspaceID] = "";
    this.fireChange();
    let changeset;
    let files;
    try {
      [changeset, files] = await Promise.all([
        sessionResource
          ? client.loadChangeset(sessionResource)
          : Promise.resolve({ files: [], operations: [], resource: "" }),
        client.listResources(),
      ]);
    } catch (error) {
      if (this.generations.get(generationKey) === generation) {
        this._workspaceStates[workspaceID] = "error";
        this._workspaceErrors[workspaceID] =
          error instanceof Error
            ? error.message
            : "Unable to load workspace resources";
        this.fireChange();
      }
      throw error;
    }
    if (this.generations.get(generationKey) !== generation) return;
    this._changes[workspaceID] = changeset.files;
    this.changesetResources[workspaceID] = changeset.resource;
    this._files[workspaceID] = files.map((entry) => ({
      ...entry,
      uri: client.resourceURI(
        entry.type === "directory" ? `${entry.name}/` : entry.name,
      ),
    }));
    this._fileChildren[workspaceID] = {
      ...(this._fileChildren[workspaceID] ?? {}),
      "": this._files[workspaceID],
    };
    this._workspaceStates[workspaceID] = "ready";
    this.fireChange();
  }

  async refresh(): Promise<void> {
    const workspaceID = this.attachmentService.attachedWorkspaceID();
    if (!workspaceID) return;
    const client = this.attachmentService.attached(workspaceID);
    if (!client) return;
    await this.loadWorkspace(workspaceID, client);
  }

  async openFile(uri: string): Promise<void> {
    const workspaceID = this.attachmentService.attachedWorkspaceID();
    if (!workspaceID) return;
    const client = this.attachmentService.attached(workspaceID);
    if (!client) return;
    const content = await client.readResource(uri);
    this.details.openPreview(uri, uri.split("/").pop() ?? uri, content);
  }

  async openDirectory(uri: string): Promise<void> {
    const workspaceID = this.attachmentService.attachedWorkspaceID();
    if (!workspaceID) return;
    const client = this.attachmentService.attached(workspaceID);
    if (!client) return;
    const generationKey = `${workspaceID}|directory|${uri}`;
    const generation = (this.generations.get(generationKey) ?? 0) + 1;
    this.generations.set(generationKey, generation);
    const entries = await client.listResources(uri);
    if (this.generations.get(generationKey) !== generation) return;
    const children = entries.map((entry) => ({
      ...entry,
      uri: client.resourceURI(
        entry.type === "directory" ? `${entry.name}/` : entry.name,
        uri,
      ),
    }));
    this._fileChildren[workspaceID] = {
      ...(this._fileChildren[workspaceID] ?? {}),
      [uri]: children,
    };
    this.fireChange();
  }

  openChange(path: string): void {
    const workspaceID = this.attachmentService.attachedWorkspaceID();
    if (!workspaceID) return;
    const change = (this._changes[workspaceID] ?? []).find(
      (c) => c.path === path,
    );
    if (!change) return;
    this.details.openPreview(`diff:${path}`, path, change.diff);
  }

  async stageChange(path: string): Promise<void> {
    const workspaceID = this.attachmentService.attachedWorkspaceID();
    if (!workspaceID) return;
    const changeset = this.changesetResources[workspaceID];
    const change = (this._changes[workspaceID] ?? []).find(
      (c) => c.path === path,
    );
    if (!changeset || !change) return;
    const client = this.attachmentService.attached(workspaceID);
    if (!client) return;
    await client.invokeChangesetOperation(changeset, "stage", change.resource);
    await this.refresh();
  }

  async revertChange(): Promise<void> {
    const workspaceID = this.attachmentService.attachedWorkspaceID();
    if (!workspaceID || !this._pendingRevertPath) return;
    const changeset = this.changesetResources[workspaceID];
    const change = (this._changes[workspaceID] ?? []).find(
      (c) => c.path === this._pendingRevertPath,
    );
    if (!changeset || !change) return;
    const client = this.attachmentService.attached(workspaceID);
    if (!client) return;
    await client.invokeChangesetOperation(changeset, "revert", change.resource);
    this._pendingRevertPath = "";
    await this.refresh();
  }

  requestRevert(path: string): void {
    this._pendingRevertPath = path;
    this.fireChange();
  }

  reviewChange(path: string): void {
    const workspaceID = this.attachmentService.attachedWorkspaceID();
    if (!workspaceID) return;
    const changeset = this.changesetResources[workspaceID];
    const change = (this._changes[workspaceID] ?? []).find(
      (c) => c.path === path,
    );
    if (!changeset || !change) return;
    this.attachmentService
      .attached(workspaceID)
      ?.setChangesReviewed(changeset, [change.id], !change.reviewed);
    change.reviewed = !change.reviewed;
    this.fireChange();
  }

  replaceChanges(
    workspaceID: string,
    changesetResource: string,
    changes: readonly WorkspaceChange[],
  ): void {
    this._changes[workspaceID] = [...changes];
    this.changesetResources[workspaceID] = changesetResource;
    this.fireChange();
  }
}
