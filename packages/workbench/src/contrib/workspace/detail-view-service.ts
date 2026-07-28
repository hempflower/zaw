import { Disposable, Emitter, type Event } from "@zaw/ui";
import { injectable } from "inversify";
import { inject, optional } from "inversify";
import {
  IActiveSessionService,
  type SessionIdentity,
} from "../../services/active-session";
import { IWorkspaceUIStateService } from "../../services/workspace-ui-state";
import {
  IContextKeyService,
  type IContextKey,
} from "../../platform/context-key/context-key";
import { WorkspaceContext } from "../../workbench/context-keys";
import { IWorkbenchLayoutService, Part } from "../../workbench/layout/layout";

export const IDetailViewService = Symbol.for("IDetailViewService");
export type DetailTab = Readonly<{
  id: string;
  title: string;
  kind: "changes" | "files" | "preview";
  content?: string;
}>;
export interface IDetailViewService {
  readonly activeTabID: string;
  readonly onDidChange: Event<void>;
  readonly tabs: readonly DetailTab[];
  close(id: string): void;
  commitNewSession(identity: SessionIdentity): void;
  openChanges(): void;
  openFiles(): void;
  openPreview(id: string, title: string, content: string): void;
  select(id: string): void;
}

@injectable()
export class DetailViewService
  extends Disposable
  implements IDetailViewService
{
  private _tabs: DetailTab[] = [{ id: "files", title: "Files", kind: "files" }];
  private _activeTabID = "files";
  private readonly emitter = this._register(new Emitter<void>());
  private readonly changesContext: IContextKey<boolean> | undefined;
  private readonly filesContext: IContextKey<boolean> | undefined;
  private readonly previewContext: IContextKey<boolean> | undefined;
  private currentSession: SessionIdentity | null;
  readonly onDidChange = this.emitter.event;
  constructor(
    @optional() @inject(IContextKeyService) contextKeys?: IContextKeyService,
    @optional()
    @inject(IActiveSessionService)
    private readonly activeSession?: IActiveSessionService,
    @optional()
    @inject(IWorkbenchLayoutService)
    private readonly layout?: IWorkbenchLayoutService,
    @optional()
    @inject(IWorkspaceUIStateService)
    private readonly uiState?: IWorkspaceUIStateService,
  ) {
    super();
    this.currentSession = activeSession?.current() ?? null;
    this.changesContext =
      contextKeys && WorkspaceContext.changesVisible.bindTo(contextKeys);
    this.filesContext =
      contextKeys && WorkspaceContext.filesVisible.bindTo(contextKeys);
    this.previewContext =
      contextKeys && WorkspaceContext.previewVisible.bindTo(contextKeys);
    this.syncContext();
    if (this.currentSession) this.restore(this.currentSession);
    if (activeSession)
      this._register(
        activeSession.onDidChange((identity) => {
          this.saveCurrentState();
          this.currentSession = identity;
          if (identity) this.restore(identity);
        }),
      );
    if (layout)
      this._register(
        layout.onDidTogglePart(({ part }) => {
          if (part === Part.AuxiliaryBar) this.saveCurrentState();
        }),
      );
  }
  get tabs(): readonly DetailTab[] {
    return this._tabs;
  }
  get activeTabID(): string {
    return this._activeTabID;
  }
  openChanges(): void {
    this.ensure({ id: "changes", title: "Changes", kind: "changes" });
  }
  openFiles(): void {
    this.ensure({ id: "files", title: "Files", kind: "files" });
  }
  openPreview(id: string, title: string, content: string): void {
    this.ensure({ id, title, kind: "preview", content });
  }
  select(id: string): void {
    if (this._tabs.some((tab) => tab.id === id) && this._activeTabID !== id) {
      this._activeTabID = id;
      this.commit();
    }
  }
  close(id: string): void {
    if (this._tabs.length === 1) return;
    const index = this._tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    this._tabs = this._tabs.filter((tab) => tab.id !== id);
    if (this._activeTabID === id)
      this._activeTabID = this._tabs[Math.max(0, index - 1)].id;
    this.commit();
  }
  commitNewSession(identity: SessionIdentity): void {
    this.uiState?.saveSessionDetails(identity.workspaceID, identity.resource, {
      activeView: { id: "changes", kind: "changes", title: "Changes" },
      auxiliaryVisible: this.layout?.isVisible(Part.AuxiliaryBar) ?? true,
    });
  }
  private ensure(tab: DetailTab): void {
    this._tabs = this._tabs.some((entry) => entry.id === tab.id)
      ? this._tabs.map((entry) => (entry.id === tab.id ? tab : entry))
      : [...this._tabs, tab];
    this._activeTabID = tab.id;
    this.layout?.setVisible(Part.AuxiliaryBar, true);
    this.commit();
  }
  private commit(): void {
    this.syncContext();
    this.saveCurrentState();
    this.emitter.fire();
  }
  private saveCurrentState(): void {
    const identity = this.currentSession;
    if (!identity || !this.uiState) return;
    const activeView = this._tabs.find((tab) => tab.id === this._activeTabID);
    this.uiState.saveSessionDetails(identity.workspaceID, identity.resource, {
      activeView: activeView ? { ...activeView } : undefined,
      auxiliaryVisible: this.layout?.isVisible(Part.AuxiliaryBar) ?? true,
    });
  }
  private restore(identity: SessionIdentity): void {
    const state = this.uiState?.loadSessionDetails(
      identity.workspaceID,
      identity.resource,
    );
    const active = state?.activeView ?? {
      id: "changes",
      kind: "changes" as const,
      title: "Changes",
    };
    const files: DetailTab = { id: "files", title: "Files", kind: "files" };
    this._tabs = active.id !== files.id ? [files, { ...active }] : [files];
    this._activeTabID = active.id;
    this.syncContext();
    this.layout?.setVisible(
      Part.AuxiliaryBar,
      state?.auxiliaryVisible ?? false,
    );
    this.emitter.fire();
  }
  private syncContext(): void {
    const active = this._tabs.find((tab) => tab.id === this._activeTabID);
    this.changesContext?.set(active?.kind === "changes");
    this.filesContext?.set(active?.kind === "files");
    this.previewContext?.set(active?.kind === "preview");
    this.layout?.setEditorVisible(active?.kind === "preview");
  }
}
