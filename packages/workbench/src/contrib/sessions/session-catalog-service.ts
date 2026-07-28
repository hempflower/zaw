import { Disposable, Emitter, type Event } from "@zaw/ui";
import { inject, injectable, optional } from "inversify";
import {
  ISessionCatalogProvider,
  type SessionCatalogItem,
} from "../../services/session-catalog";
import { sessionIdentityKey } from "../../services/active-session";
import type { SessionIdentity } from "../../services/active-session";
import { IWorkbenchStorage } from "../../services/workspace-ui-state";

export const ISessionCatalogService = Symbol.for("ISessionCatalogService");

export interface ISessionCatalogService {
  readonly items: readonly SessionCatalogItem[];
  readonly sessions: Record<string, string[]>;
  readonly sessionTitles: Record<string, string>;
  readonly connectionState: Record<
    string,
    "connected" | "offline" | "reconnecting"
  >;
  readonly onDidChange: Event<void>;
  readonly onDidRequestFilter: Event<void>;

  start(): void;
  stop(): void;
  refresh(): Promise<boolean>;
  refreshProvider(provider: string): Promise<boolean>;
  apply(items: SessionCatalogItem[]): boolean;
  applyProvider(provider: string, items: SessionCatalogItem[]): boolean;
  add(identity: { workspaceID: string; resource: string }, title: string): void;
  isArchived(identity: SessionIdentity): boolean;
  isPinned(identity: SessionIdentity): boolean;
  isRead(identity: SessionIdentity): boolean;
  markRead(identity: SessionIdentity, read?: boolean): void;
  requestFilter(): void;
  toggleArchived(identity: SessionIdentity): void;
  togglePinned(identity: SessionIdentity): void;
}

@injectable()
export class SessionCatalogService
  extends Disposable
  implements ISessionCatalogService
{
  private _items: readonly SessionCatalogItem[] = [];
  private _sessions: Record<string, string[]> = {};
  private _sessionTitles: Record<string, string> = {};
  private _connectionState: Record<
    string,
    "connected" | "offline" | "reconnecting"
  > = {};
  private catalogTimer: ReturnType<typeof setInterval> | null = null;
  private refreshSerial = 0;
  private latestAllRefresh = 0;
  private readonly latestProviderRefresh = new Map<string, number>();
  private readonly changeEmitter = this._register(new Emitter<void>());
  private readonly filterEmitter = this._register(new Emitter<void>());
  private readonly archived = new Set<string>();
  private readonly pinned = new Set<string>();
  private readonly unread = new Set<string>();

  readonly onDidChange = this.changeEmitter.event;
  readonly onDidRequestFilter = this.filterEmitter.event;

  get sessions() {
    return this._sessions;
  }
  get items() {
    return this._items;
  }
  get sessionTitles() {
    return this._sessionTitles;
  }
  get connectionState() {
    return this._connectionState;
  }

  constructor(
    @inject(ISessionCatalogProvider)
    private readonly provider: ISessionCatalogProvider,
    @optional() @inject(IWorkbenchStorage) private readonly storage?: Storage,
  ) {
    super();
    this.restoreLocalState();
    this._register({ dispose: () => this.stop() });
  }

  start(): void {
    if (this.catalogTimer) return;
    void this.refresh();
    this.catalogTimer = setInterval(() => {
      void this.refresh();
    }, 5_000);
  }

  stop(): void {
    if (this.catalogTimer) {
      clearInterval(this.catalogTimer);
      this.catalogTimer = null;
    }
  }

  async refresh(): Promise<boolean> {
    const serial = ++this.refreshSerial;
    this.latestAllRefresh = serial;
    try {
      const items = await this.provider.list();
      if (
        this.latestAllRefresh !== serial ||
        [...this.latestProviderRefresh.values()].some(
          (providerSerial) => providerSerial > serial,
        )
      )
        return false;
      return this.apply(items);
    } catch {
      return false;
    }
  }

  async refreshProvider(provider: string): Promise<boolean> {
    const serial = ++this.refreshSerial;
    this.latestProviderRefresh.set(provider, serial);
    try {
      const items = await this.provider.list(provider);
      if (
        this.latestProviderRefresh.get(provider) !== serial ||
        this.latestAllRefresh > serial
      )
        return false;
      return this.applyProvider(
        provider,
        items.filter((item) => item.provider === provider),
      );
    } catch {
      return false;
    }
  }

  applyProvider(provider: string, items: SessionCatalogItem[]): boolean {
    return this.apply([
      ...this._items.filter((item) => item.provider !== provider),
      ...items.filter((item) => item.provider === provider),
    ]);
  }

  apply(items: SessionCatalogItem[]): boolean {
    const previousItems = JSON.stringify(this._items);
    const previousSessions = JSON.stringify(this._sessions);
    const previousTitles = JSON.stringify(this._sessionTitles);
    const previousConnectionState = JSON.stringify(this._connectionState);
    const sessions: Record<string, string[]> = {};
    const titles: Record<string, string> = {};
    const connectionState: Record<
      string,
      "connected" | "offline" | "reconnecting"
    > = {};

    for (const item of items) {
      sessions[item.workspaceId] = [
        ...(sessions[item.workspaceId] ?? []),
        item.resource,
      ];
      titles[
        sessionIdentityKey({
          workspaceID: item.workspaceId,
          resource: item.resource,
        })
      ] = item.title;
      if (item.agentHostOnline && !connectionState[item.workspaceId]) {
        connectionState[item.workspaceId] = "connected";
      }
      if (!item.agentHostOnline) {
        connectionState[item.workspaceId] = "offline";
      }
    }

    this._items = items;
    this._sessions = sessions;
    this._sessionTitles = titles;
    this._connectionState = connectionState;

    const changed =
      previousItems !== JSON.stringify(items) ||
      previousSessions !== JSON.stringify(sessions) ||
      previousTitles !== JSON.stringify(titles) ||
      previousConnectionState !== JSON.stringify(connectionState);

    if (changed) this.changeEmitter.fire();
    return changed;
  }

  add(
    identity: { workspaceID: string; resource: string },
    title: string,
  ): void {
    const current = this._sessions[identity.workspaceID] ?? [];
    if (!current.includes(identity.resource)) {
      this._sessions = {
        ...this._sessions,
        [identity.workspaceID]: [...current, identity.resource],
      };
    }
    this._sessionTitles = {
      ...this._sessionTitles,
      [sessionIdentityKey(identity)]: title,
    };
    this.changeEmitter.fire();
  }

  isArchived(identity: SessionIdentity): boolean {
    return this.archived.has(sessionIdentityKey(identity));
  }

  isPinned(identity: SessionIdentity): boolean {
    return this.pinned.has(sessionIdentityKey(identity));
  }

  isRead(identity: SessionIdentity): boolean {
    return !this.unread.has(sessionIdentityKey(identity));
  }

  markRead(identity: SessionIdentity, read = true): void {
    const key = sessionIdentityKey(identity);
    const changed = read ? this.unread.delete(key) : !this.unread.has(key);
    if (!read) this.unread.add(key);
    if (changed) this.localStateChanged();
  }

  requestFilter(): void {
    this.filterEmitter.fire();
  }

  toggleArchived(identity: SessionIdentity): void {
    this.toggle(this.archived, sessionIdentityKey(identity));
  }

  togglePinned(identity: SessionIdentity): void {
    this.toggle(this.pinned, sessionIdentityKey(identity));
  }

  private toggle(values: Set<string>, key: string): void {
    if (!values.delete(key)) values.add(key);
    this.localStateChanged();
  }

  private localStateChanged(): void {
    try {
      this.storage?.setItem(
        "zaw.session-catalog.local-state",
        JSON.stringify({
          archived: [...this.archived],
          pinned: [...this.pinned],
          unread: [...this.unread],
        }),
      );
    } catch {
      // In-memory state remains authoritative for this window.
    }
    this.changeEmitter.fire();
  }

  private restoreLocalState(): void {
    try {
      const raw = this.storage?.getItem("zaw.session-catalog.local-state");
      if (!raw) return;
      const state = JSON.parse(raw) as Record<string, unknown>;
      for (const value of Array.isArray(state.archived) ? state.archived : [])
        if (typeof value === "string") this.archived.add(value);
      for (const value of Array.isArray(state.pinned) ? state.pinned : [])
        if (typeof value === "string") this.pinned.add(value);
      for (const value of Array.isArray(state.unread) ? state.unread : [])
        if (typeof value === "string") this.unread.add(value);
    } catch {
      // Ignore malformed or unavailable persisted UI state.
    }
  }
}
