import type { Workspace } from "@zaw/protocol";
import { Disposable, Emitter, type Event } from "@zaw/ui";
import { inject, injectable, optional } from "inversify";
import {
  IContextKeyService,
  type IContextKey,
} from "../../platform/context-key/context-key";
import { WorkspaceContext } from "../../workbench/context-keys";
import { ITerminalService } from "../terminal/terminal-service";
import { IWorkspaceResourceService } from "./workspace-resource-service";
import { IWorkspaceAttachmentService } from "../../services/workspace-attachment";
import { IWorkspaceProvider } from "../../services/workspace";
import type { CreateWorkspaceInput } from "../../services/workspace";

export const IWorkspaceService = Symbol.for("IWorkspaceService");

export function isWorkspaceRunning(workspace: Workspace | undefined): boolean {
  return (
    workspace?.desiredState === "running" &&
    workspace.observedState === "running" &&
    workspace.agentHostState === "online"
  );
}

export function workspaceLifecycleState(
  workspace: Workspace | undefined,
): "running" | "stopped" | "transitioning" {
  if (!workspace) return "transitioning";
  if (isWorkspaceRunning(workspace)) return "running";
  if (
    workspace.desiredState === "stopped" &&
    workspace.observedState === "stopped"
  )
    return "stopped";
  return "transitioning";
}

export interface IWorkspaceService {
  readonly workspaces: readonly Workspace[];
  readonly selectedWorkspaceID: string | null;
  readonly onDidChange: Event<void>;
  create(input: CreateWorkspaceInput): Promise<{ buildId: string; id: string }>;
  loadBuildLogs(workspaceID: string): Promise<string | null>;
  reload(): Promise<void>;
  select(workspaceID: string, sessionResource?: string): Promise<void>;
}

@injectable()
export class WorkspaceService extends Disposable implements IWorkspaceService {
  private _workspaces: Workspace[] = [];
  private _selectedWorkspaceID: string | null = null;
  private readonly emitter = this._register(new Emitter<void>());
  private readonly activeContext: IContextKey<boolean> | undefined;
  private readonly onlineContext: IContextKey<boolean> | undefined;
  readonly onDidChange = this.emitter.event;
  get workspaces(): readonly Workspace[] {
    return this._workspaces;
  }
  get selectedWorkspaceID(): string | null {
    return this._selectedWorkspaceID;
  }

  constructor(
    @inject(IWorkspaceProvider) private readonly provider: IWorkspaceProvider,
    @inject(IWorkspaceAttachmentService)
    private readonly attachment: IWorkspaceAttachmentService,
    @inject(IWorkspaceResourceService)
    private readonly resources: IWorkspaceResourceService,
    @inject(ITerminalService) private readonly terminals: ITerminalService,
    @optional() @inject(IContextKeyService) contextKeys?: IContextKeyService,
  ) {
    super();
    this.activeContext =
      contextKeys && WorkspaceContext.active.bindTo(contextKeys);
    this.onlineContext =
      contextKeys && WorkspaceContext.online.bindTo(contextKeys);
    this._register({
      dispose: this.attachment.onClose((workspaceID) => {
        if (workspaceID !== this._selectedWorkspaceID) return;
        this.onlineContext?.set(false);
        this.emitter.fire();
      }),
    });
  }

  async reload(): Promise<void> {
    this._workspaces = await this.provider.list();
    this.emitter.fire();
  }

  async create(
    input: CreateWorkspaceInput,
  ): Promise<{ buildId: string; id: string }> {
    const created = await this.provider.create(input);
    await this.reload();
    return created;
  }

  async loadBuildLogs(workspaceID: string): Promise<string | null> {
    const workspace = this._workspaces.find((item) => item.id === workspaceID);
    if (!workspace?.currentBuildId) return null;
    return (await this.provider.buildLogs(workspace.currentBuildId)).logs;
  }

  async select(workspaceID: string, sessionResource?: string): Promise<void> {
    const host = await this.attachment.attach(workspaceID);
    this._selectedWorkspaceID = workspaceID;
    this.activeContext?.set(true);
    this.onlineContext?.set(true);
    // Publish the selection before resources settle so Views can render their
    // loading/error state against the correct workspace identity.
    this.emitter.fire();
    await Promise.all([
      this.resources.loadWorkspace(workspaceID, host, sessionResource),
      this.terminals.reattach(workspaceID, host),
    ]);
    this.emitter.fire();
  }
}
