import { inject, injectable, optional } from "inversify";
import {
  IActiveSessionService,
  type SessionIdentity,
} from "../../services/active-session";
import { IChatSessionService } from "../../services/chat-session";
import { IWorkspaceAttachmentService } from "../../services/workspace-attachment";
import { ISessionCatalogService } from "./session-catalog-service";
import {
  IDetailViewService,
  type IDetailViewService as DetailViewService,
} from "../workspace/detail-view-service";
import {
  IWorkspaceService,
  isWorkspaceRunning,
  type IWorkspaceService as WorkspaceService,
} from "../workspace/workspace-service";

export const ISessionService = Symbol.for("ISessionService");

export interface ISessionService {
  create(
    workspaceID: string,
    title: string,
    provider?: string,
  ): Promise<SessionIdentity>;
  attach(identity: SessionIdentity): Promise<void>;
  send(identity: SessionIdentity): Promise<void>;
  cancel(identity: SessionIdentity): Promise<void>;
  confirmToolCall(
    identity: SessionIdentity,
    chat: string,
    toolCallID: string,
    approved: boolean,
  ): void;
}

@injectable()
export class SessionService implements ISessionService {
  constructor(
    @inject(IWorkspaceAttachmentService)
    private readonly attachments: IWorkspaceAttachmentService,
    @inject(IChatSessionService) private readonly chat: IChatSessionService,
    @inject(IActiveSessionService)
    private readonly active: IActiveSessionService,
    @inject(ISessionCatalogService)
    private readonly catalog: ISessionCatalogService,
    @optional()
    @inject(IDetailViewService)
    private readonly details?: DetailViewService,
    @optional()
    @inject(IWorkspaceService)
    private readonly workspaces?: WorkspaceService,
  ) {}

  async create(
    workspaceID: string,
    title: string,
    provider?: string,
  ): Promise<SessionIdentity> {
    this.assertWorkspaceRunning(workspaceID);
    const host = await this.attachments.attach(workspaceID);
    const created = await host.createSession(title, provider);
    const identity = { workspaceID, resource: created.resource };
    this.details?.commitNewSession(identity);
    this.catalog.add(identity, title);
    this.active.select(identity);
    return identity;
  }

  async attach(identity: SessionIdentity): Promise<void> {
    const host =
      this.attachments.attached(identity.workspaceID) ??
      (await this.attachments.attach(identity.workspaceID));
    await host.attachSession(identity.resource);
    this.active.select(identity);
  }

  async send(identity: SessionIdentity): Promise<void> {
    this.assertWorkspaceRunning(identity.workspaceID);
    const host =
      this.attachments.attached(identity.workspaceID) ??
      (await this.attachments.attach(identity.workspaceID));
    const composition = this.chat.composition(identity);
    if (!composition.draft.trim() && composition.attachments.length === 0)
      return;
    await host.promptSession(identity.resource, {
      agent: composition.agent,
      approvalMode: composition.approvalMode,
      attachments: composition.attachments,
      model: composition.model,
      mode: composition.mode ?? "agent",
      reasoningEffort: composition.reasoningEffort,
      text: composition.draft,
    });
    this.chat.clearAfterSend(identity);
  }

  private assertWorkspaceRunning(workspaceID: string): void {
    if (!this.workspaces) return;
    const workspace = this.workspaces.workspaces.find(
      (candidate) => candidate.id === workspaceID,
    );
    if (!isWorkspaceRunning(workspace))
      throw new Error("Workspace must be running");
  }

  async cancel(identity: SessionIdentity): Promise<void> {
    const turn = this.chat.activeTurn(identity);
    const host = this.attachments.attached(identity.workspaceID);
    if (turn && host) await host.cancelTurn(identity.resource, turn);
  }

  confirmToolCall(
    identity: SessionIdentity,
    chat: string,
    toolCallID: string,
    approved: boolean,
  ): void {
    const host = this.attachments.attached(identity.workspaceID);
    const turn = this.chat.activeTurn(identity);
    if (host && turn) host.confirmToolCall(chat, turn, toolCallID, approved);
  }
}
