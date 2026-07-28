import { Disposable, Emitter, type Event } from "@zaw/ui";
import { inject, injectable, optional } from "inversify";
import type { IAgentHost } from "../../services/agent-host";
import { IWorkspaceAttachmentService } from "../../services/workspace-attachment";
import {
  IContextKeyService,
  type IContextKey,
} from "../../platform/context-key/context-key";
import { TerminalContext } from "../../workbench/context-keys";
import { ITerminalGroupService } from "./terminal-group-service";

export const ITerminalService = Symbol.for("ITerminalService");

export interface TerminalState {
  resource: string;
  title: string;
  output: string;
}

export interface ITerminalService {
  readonly terminals: readonly TerminalState[];
  readonly activeTerminal: string | null;
  readonly panelHeight: number;
  readonly onDidChange: Event<void>;

  create(): Promise<void>;
  disposeTerminal(resource: string): Promise<void>;
  select(resource: string): void;
  setPanelHeight(height: number): void;
  input(resource: string, data: string): void;
  resize(resource: string, cols: number, rows: number): void;
  reattach(workspaceID: string, client: IAgentHost): Promise<void>;
  appendOutput(resource: string, data: string): void;
}

@injectable()
export class TerminalService extends Disposable implements ITerminalService {
  private _terminals: TerminalState[] = [];
  private _activeTerminal: string | null = null;
  private _panelHeight = 300;
  private reattachGeneration = 0;
  private readonly changeEmitter = this._register(new Emitter<void>());
  private readonly activeContext: IContextKey<boolean> | undefined;

  readonly onDidChange = this.changeEmitter.event;

  get terminals(): readonly TerminalState[] {
    return this._terminals;
  }
  get activeTerminal(): string | null {
    return this._activeTerminal;
  }
  get panelHeight(): number {
    return this._panelHeight;
  }

  constructor(
    @inject(IWorkspaceAttachmentService)
    private readonly attachmentService: IWorkspaceAttachmentService,
    @inject(ITerminalGroupService)
    private readonly group: ITerminalGroupService,
    @optional() @inject(IContextKeyService) contextKeys?: IContextKeyService,
  ) {
    super();
    this.activeContext =
      contextKeys && TerminalContext.active.bindTo(contextKeys);
  }

  private fireChange(): void {
    this.changeEmitter.fire();
  }

  async create(): Promise<void> {
    const workspaceID = this.attachmentService.attachedWorkspaceID();
    if (!workspaceID) return;
    const client = this.attachmentService.attached(workspaceID);
    if (!client) return;
    const terminal = await client.createTerminal(
      `ahp-terminal:/${crypto.randomUUID()}`,
      "Terminal",
    );
    this._terminals = [
      ...this._terminals,
      {
        ...terminal,
        title: terminal.title || "Terminal",
        output: terminal.output || "",
      },
    ];
    this._activeTerminal = terminal.resource;
    this.group.openPanel();
    this.activeContext?.set(true);
    this.fireChange();
  }

  async disposeTerminal(resource: string): Promise<void> {
    const workspaceID = this.attachmentService.attachedWorkspaceID();
    if (!workspaceID) return;
    await this.attachmentService
      .attached(workspaceID)
      ?.disposeTerminal(resource);
    this._terminals = this._terminals.filter((t) => t.resource !== resource);
    if (this._activeTerminal === resource) {
      this._activeTerminal = this._terminals[0]?.resource ?? null;
    }
    this.activeContext?.set(Boolean(this._activeTerminal));
    this.fireChange();
  }

  select(resource: string): void {
    if (!this._terminals.some((terminal) => terminal.resource === resource))
      return;
    this._activeTerminal = resource;
    this.activeContext?.set(true);
    this.fireChange();
  }

  setPanelHeight(height: number): void {
    this._panelHeight = Math.max(120, height);
    this.fireChange();
  }

  input(resource: string, data: string): void {
    if (
      !data ||
      !this._terminals.some((terminal) => terminal.resource === resource)
    )
      return;
    const workspaceID = this.attachmentService.attachedWorkspaceID();
    this.attachmentService
      .attached(workspaceID ?? "")
      ?.terminalInput(resource, data);
  }

  resize(resource: string, cols: number, rows: number): void {
    if (!this._terminals.some((terminal) => terminal.resource === resource))
      return;
    const workspaceID = this.attachmentService.attachedWorkspaceID();
    this.attachmentService
      .attached(workspaceID ?? "")
      ?.terminalResize(
        resource,
        Math.max(1, Math.floor(cols)),
        Math.max(1, Math.floor(rows)),
      );
  }

  async reattach(workspaceID: string, client: IAgentHost): Promise<void> {
    const generation = ++this.reattachGeneration;
    const terminals = await Promise.all(
      client.listTerminals().map(async (terminal) => {
        try {
          return await client.attachTerminal(terminal.resource);
        } catch {
          return terminal;
        }
      }),
    );
    if (generation !== this.reattachGeneration) return;
    this._terminals = terminals;
    if (
      this._activeTerminal &&
      !terminals.some((t) => t.resource === this._activeTerminal)
    ) {
      this._activeTerminal = null;
    }
    if (this.group.open && !this._activeTerminal) {
      this._activeTerminal = terminals[0]?.resource ?? null;
    }
    this.fireChange();
  }

  appendOutput(resource: string, data: string): void {
    if (!data) return;
    this._terminals = this._terminals.map((terminal) =>
      terminal.resource === resource
        ? { ...terminal, output: terminal.output + data }
        : terminal,
    );
    this.fireChange();
  }
}
