import { inject, injectable } from "inversify";
import type { AHPAction, IAgentHost, IAgentHostProvider } from "./agent-host";
import { IAgentHostProvider as IAgentHostProviderID } from "./agent-host";

export const IWorkspaceAttachmentService = Symbol.for(
  "IWorkspaceAttachmentService",
);

export class StaleWorkspaceAttachmentError extends Error {
  constructor() {
    super("Workspace attachment was superseded");
  }
}

export interface IWorkspaceAttachmentService {
  attach(workspaceID: string): Promise<IAgentHost>;
  attached(workspaceID?: string): IAgentHost | null;
  attachedWorkspaceID(): string | null;
  detach(): void;
  onAction(
    listener: (workspaceID: string, action: AHPAction) => void,
  ): () => void;
  onClose(listener: (workspaceID: string) => void): () => void;
}

@injectable()
export class WorkspaceAttachmentService implements IWorkspaceAttachmentService {
  private current: { workspaceID: string; host: IAgentHost } | null = null;
  private generation = 0;
  private readonly actionListeners = new Set<
    (workspaceID: string, action: AHPAction) => void
  >();
  private readonly closeListeners = new Set<(workspaceID: string) => void>();

  constructor(
    @inject(IAgentHostProviderID)
    private readonly provider: IAgentHostProvider,
  ) {}

  async attach(workspaceID: string) {
    if (
      this.current?.workspaceID === workspaceID &&
      !this.current.host.isClosed()
    ) {
      return this.current.host;
    }
    const generation = ++this.generation;
    this.closeCurrent();
    const host = await this.provider.connect(workspaceID);
    if (generation !== this.generation) {
      host.close();
      throw new StaleWorkspaceAttachmentError();
    }
    this.current = { workspaceID, host };
    host.onAction((action) => {
      if (this.isCurrent(generation, host)) {
        for (const listener of this.actionListeners) {
          listener(workspaceID, action);
        }
      }
    });
    host.onClose(() => {
      if (!this.isCurrent(generation, host)) return;
      this.current = null;
      for (const listener of this.closeListeners) listener(workspaceID);
    });
    return host;
  }

  attached(workspaceID?: string) {
    if (!this.current || this.current.host.isClosed()) return null;
    if (workspaceID && this.current.workspaceID !== workspaceID) return null;
    return this.current.host;
  }

  attachedWorkspaceID() {
    return this.current?.workspaceID ?? null;
  }

  detach() {
    this.generation++;
    this.closeCurrent();
  }

  onAction(listener: (workspaceID: string, action: AHPAction) => void) {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  onClose(listener: (workspaceID: string) => void) {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  private closeCurrent() {
    const previous = this.current;
    this.current = null;
    previous?.host.close();
  }

  private isCurrent(generation: number, host: IAgentHost) {
    return generation === this.generation && this.current?.host === host;
  }
}
