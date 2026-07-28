import {
  Disposable,
  IconActionButton,
  VirtualList,
  createElement,
  moveRovingFocus,
  setRovingTabStop,
} from "@zaw/ui";
import { inject, injectable, optional } from "inversify";
import { ICommandService } from "../../platform/commands/commands";
import {
  IActionRegistry,
  type ActionDescriptor,
} from "../../platform/actions/actions";
import {
  IActiveSessionService,
  sessionIdentityKey,
  type SessionIdentity,
} from "../../services/active-session";
import type { SessionCatalogItem } from "../../services/session-catalog";
import {
  ISessionStatusRegistry,
  type ISessionStatusRegistry as SessionStatusRegistry,
} from "../../services/session-status";
import {
  ViewRoot,
  type IWorkbenchView,
} from "../../services/workbench-view-registry";
import { IWorkspaceService } from "../workspace/workspace-service";
import { ISessionCatalogService } from "./session-catalog-service";
import { IWorkbenchStorage } from "../../services/workspace-ui-state";
import { calculateSessionSections } from "./session-catalog-sections";
import type { SessionActionContext } from "./session.commands";

const ARCHIVED_STATUS = 64;
const IN_PROGRESS_STATUS = 8;

const ITEM_HEIGHT = 54;
const COMPACT_ITEM_HEIGHT = 52;
const SECTION_HEIGHT = 30;
const COMPACT_SECTION_HEIGHT = 26;

export function approvalRowHeight(label: string): number {
  return Math.min(label.split(/\r?\n/).length, 3) * 18 + 14;
}

type CatalogRow =
  | {
      count: number;
      key: string;
      kind: "section";
      workspaceID: string;
      workspaceName: string;
    }
  | {
      identity: SessionIdentity;
      item?: SessionCatalogItem;
      key: string;
      kind: "session";
      title: string;
      workspaceName: string;
    };

function hasStatus(status: number | undefined, flag: number): boolean {
  return status !== undefined && (status & flag) === flag;
}

function relativeTime(value: string | undefined): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return formatter.format(days, "day");
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(timestamp);
}

@injectable()
export class SessionCatalogPane extends Disposable implements IWorkbenchView {
  readonly id = "zaw.sessions.catalog";
  private readonly pane = createElement("aside", {
    ariaLabel: "Agent sessions",
    className: "agent-session-sidebar",
  });
  private readonly listHost = createElement("div", {
    className: "agent-session-list",
  });
  private readonly empty = createElement("p", {
    className: "agent-sidebar-empty",
    textContent: "No chats yet. Select a workspace to start an agent session.",
  });
  private readonly search = createElement("input", {
    ariaLabel: "Filter chats",
    className: "agent-session-search",
  }) as HTMLInputElement;
  private readonly collapsed = new Set<string>();
  private readonly list: VirtualList<CatalogRow>;
  private rows: CatalogRow[] = [];
  private selectedIndex = -1;
  private compact = false;
  private readonly selected = new Set<string>();
  private selectionAnchor = -1;
  private contextMenu: HTMLElement | undefined;
  private contextMenuAnchor: HTMLElement | undefined;
  private contextMenuCleanup: (() => void) | undefined;
  private hoveredSessionKey: string | undefined;
  private pendingCatalogUpdate = false;

  constructor(
    @inject(ViewRoot) root: HTMLElement,
    @inject(ISessionCatalogService)
    private readonly catalog: ISessionCatalogService,
    @inject(IWorkspaceService) private readonly workspaces: IWorkspaceService,
    @inject(IActiveSessionService)
    private readonly active: IActiveSessionService,
    @optional()
    @inject(ICommandService)
    private readonly commands?: ICommandService,
    @optional()
    @inject(IWorkbenchStorage)
    private readonly storage?: Storage,
    @optional()
    @inject(IActionRegistry)
    private readonly actionRegistry?: IActionRegistry,
    @optional()
    @inject(ISessionStatusRegistry)
    private readonly statuses?: SessionStatusRegistry,
  ) {
    super();
    this.restoreCollapsed();
    this._register({ dispose: () => this.closeContextMenu() });
    const header = createElement("header", {
      className: "agent-sidebar-header",
    });
    const title = createElement("h1", { textContent: "Chats" });
    const actions = createElement("div", {
      className: "agent-sidebar-actions",
    });
    const newSession = createElement("button", {
      className: "agent-new-session-action",
      textContent: "New",
    });
    newSession.type = "button";
    newSession.title = "New Session (Ctrl+L)";
    newSession.addEventListener(
      "click",
      () => void this.commands?.executeCommand("zaw.session.new"),
    );
    const searchActionHost = createElement("span");
    const searchDescriptor = this.actionRegistry
      ?.actions("view-title")
      .find((action) => action.id === "zaw.action.session.filter");
    const searchAction = this._register(
      new IconActionButton(searchActionHost, {
        icon: searchDescriptor?.icon ?? "search",
        ariaLabel: searchDescriptor?.title ?? "Filter Chats",
      }),
    );
    this._register(
      searchAction.onDidClick(() =>
        searchDescriptor
          ? void this.commands?.executeCommand(searchDescriptor.command)
          : this.toggleFilter(),
      ),
    );
    actions.append(newSession, searchActionHost);
    header.append(title, actions);
    this.search.hidden = true;
    this.search.placeholder = "Filter chats";
    this.search.addEventListener("input", () => this.updateRows());
    this.list = this._register(
      new VirtualList(
        this.listHost,
        {
          getHeight: (row) => {
            if (row.kind === "section")
              return this.compact ? COMPACT_SECTION_HEIGHT : SECTION_HEIGHT;
            return (
              (this.compact ? COMPACT_ITEM_HEIGHT : ITEM_HEIGHT) +
              (row.item?.approval
                ? approvalRowHeight(row.item.approval.label)
                : 0)
            );
          },
          getKey: (row) => row.key,
          render: (row) => this.renderRow(row),
          update: (element, row) => this.updateRow(element, row),
        },
        { ariaLabel: "Chats", keyboardNavigation: false },
      ),
    );
    this.list
      .getHTMLElement()
      .addEventListener("keydown", (event) => this.onKeyDown(event));
    this.pane.append(header, this.search, this.listHost, this.empty);
    root.replaceChildren(this.pane);
    this._register(
      this.catalog.onDidChange(() => {
        if (this.hoveredSessionKey) this.pendingCatalogUpdate = true;
        else this.updateRows();
      }),
    );
    this._register(this.workspaces.onDidChange(() => this.updateRows()));
    this._register(this.active.onDidChange(() => this.updateRows()));
    this._register(this.catalog.onDidRequestFilter(() => this.toggleFilter()));
    if (this.statuses)
      this._register(this.statuses.onDidChange(() => this.updateRows()));
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(([entry]) => {
        const compact = entry.contentRect.width <= 280;
        if (compact === this.compact) return;
        this.compact = compact;
        this.pane.classList.toggle("compact", compact);
        this.updateRows();
      });
      observer.observe(this.listHost);
      this._register({ dispose: () => observer.disconnect() });
    }
    let renderedMinute = Math.floor(Date.now() / 60_000);
    const relativeTimeTimer = setInterval(() => {
      const minute = Math.floor(Date.now() / 60_000);
      const hasRunningSession = this.catalog.items.some((item) =>
        hasStatus(item.status, IN_PROGRESS_STATUS),
      );
      if (!hasRunningSession && minute === renderedMinute) return;
      renderedMinute = minute;
      this.updateRows();
    }, 1_000);
    this._register({ dispose: () => clearInterval(relativeTimeTimer) });
    this.updateRows();
  }

  private updateRows(): void {
    const itemByIdentity = new Map(
      this.catalog.items.map((item) => [
        sessionIdentityKey({
          resource: item.resource,
          workspaceID: item.workspaceId,
        }),
        item,
      ]),
    );
    const filter = this.search.value.trim().toLocaleLowerCase();
    const rows: CatalogRow[] = [];
    for (const workspace of this.workspaces.workspaces) {
      const entries = (this.catalog.sessions[workspace.id] ?? [])
        .map((resource) => {
          const identity = { resource, workspaceID: workspace.id };
          const key = sessionIdentityKey(identity);
          const item = itemByIdentity.get(key);
          return {
            identity,
            item,
            key: `session:${key}`,
            kind: "session" as const,
            title: this.catalog.sessionTitles[key] ?? "Session",
            workspaceName: workspace.name,
          };
        })
        .filter((row) => {
          if (!filter) return true;
          return [
            row.title,
            row.item?.provider,
            row.item?.activity,
            workspace.name,
          ]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(filter));
        });
      const catalogOrder = new Map(
        calculateSessionSections(
          entries.flatMap((entry) => (entry.item ? [entry.item] : [])),
          {
            isArchived: (item) =>
              hasStatus(item.status, ARCHIVED_STATUS) ||
              this.catalog.isArchived({
                resource: item.resource,
                workspaceID: item.workspaceId,
              }),
            isPinned: (item) =>
              this.catalog.isPinned({
                resource: item.resource,
                workspaceID: item.workspaceId,
              }),
          },
        ).map((entry, index) => [
          sessionIdentityKey({
            resource: entry.item.resource,
            workspaceID: entry.item.workspaceId,
          }),
          index,
        ]),
      );
      entries.sort(
        (left, right) =>
          (catalogOrder.get(sessionIdentityKey(left.identity)) ??
            Number.MAX_SAFE_INTEGER) -
          (catalogOrder.get(sessionIdentityKey(right.identity)) ??
            Number.MAX_SAFE_INTEGER),
      );
      if (!entries.length) continue;
      rows.push({
        count: entries.length,
        key: `section:${workspace.id}`,
        kind: "section",
        workspaceID: workspace.id,
        workspaceName: workspace.name,
      });
      if (!this.collapsed.has(workspace.id)) rows.push(...entries);
    }
    this.rows = rows;
    const active = this.active.current();
    this.selectedIndex = active
      ? rows.findIndex(
          (row) =>
            row.kind === "session" &&
            sessionIdentityKey(row.identity) === sessionIdentityKey(active),
        )
      : -1;
    if (this.selectedIndex < 0 && rows.length > 0) this.selectedIndex = 0;
    this.list.setItems(rows);
    this.listHost.hidden = rows.length === 0;
    this.empty.hidden = rows.length !== 0;
  }

  private renderRow(row: CatalogRow): HTMLElement {
    const element = createElement("div");
    if (row.kind === "section") {
      const button = createElement("button", {
        className: "agent-session-section",
      });
      button.type = "button";
      button.addEventListener("click", () => {
        this.selectedIndex = this.rows.findIndex(
          (candidate) => candidate.key === row.key,
        );
        this.toggleSection(row.workspaceID);
      });
      button.append(
        createElement("span", { className: "agent-session-section-twisty" }),
        createElement("span", { className: "agent-session-section-title" }),
        createElement("span", { className: "agent-session-section-count" }),
      );
      const toolbarHost = createElement("span", {
        className: "agent-session-section-toolbar",
      });
      const toggle = this._register(
        new IconActionButton(toolbarHost, {
          ariaLabel: "Collapse section",
          icon: "collapse-all",
        }),
      );
      toggle.element.dataset.sectionAction = "toggle";
      toggle.element.tabIndex = -1;
      this._register(
        toggle.onDidClick((event) => {
          event.stopPropagation();
          const workspaceID = element.dataset.sectionWorkspace;
          if (workspaceID) this.toggleSection(workspaceID);
        }),
      );
      element.append(button, toolbarHost);
    } else {
      const button = createElement("button", {
        className: "agent-session-select",
      });
      button.type = "button";
      button.addEventListener("click", (event) =>
        this.handleSelection(row.identity, event),
      );
      button.append(
        createElement("span", { className: "agent-session-status-icon" }),
        this.createSessionMain(),
      );
      const pinned = createElement("span", {
        className: "codicon codicon-pinned agent-session-pinned-indicator",
      });
      const unread = createElement("span", {
        className: "agent-session-unread-indicator",
      });
      const actions = createElement("span", {
        className: "agent-session-row-actions",
      });
      for (const descriptor of this.sessionActions()) {
        const host = createElement("span");
        const action = this._register(
          new IconActionButton(host, {
            ariaLabel: descriptor.title,
            icon: descriptor.icon ?? "circle-outline",
          }),
        );
        action.element.dataset.command = descriptor.command;
        action.element.tabIndex = -1;
        this._register(
          action.onDidClick((event) => {
            event.stopPropagation();
            const identity = this.identityFor(element);
            if (!identity) return;
            this.runSessionAction(descriptor, identity);
          }),
        );
        actions.append(host);
      }
      element.draggable = true;
      element.addEventListener("dragstart", (event) => {
        const identity = this.identityFor(element);
        if (!identity || !event.dataTransfer) return;
        const context = this.actionContext(identity);
        event.dataTransfer.effectAllowed = "copyMove";
        event.dataTransfer.setData(
          "application/vnd.zaw.agent-sessions+json",
          JSON.stringify(context),
        );
        event.dataTransfer.setData("text/plain", identity.resource);
      });
      element.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const identity = this.identityFor(element);
        if (!identity) return;
        const key = sessionIdentityKey(identity);
        if (!this.selected.has(key)) {
          this.selected.clear();
          this.selected.add(key);
          this.updateRows();
        }
        this.showContextMenu(
          identity,
          element.querySelector<HTMLElement>(".agent-session-select") ??
            element,
          event.clientX,
          event.clientY,
        );
      });
      element.addEventListener("keydown", (event) => {
        if (
          event.target !== button ||
          (event.key !== "ContextMenu" &&
            !(event.shiftKey && event.key === "F10"))
        )
          return;
        const identity = this.identityFor(element);
        if (!identity) return;
        event.preventDefault();
        this.showContextMenu(identity, button);
      });
      element.addEventListener("mouseenter", () => {
        const identity = this.identityFor(element);
        this.hoveredSessionKey = identity
          ? sessionIdentityKey(identity)
          : undefined;
      });
      element.addEventListener("mouseleave", () => {
        const identity = this.identityFor(element);
        if (identity && this.hoveredSessionKey !== sessionIdentityKey(identity))
          return;
        this.hoveredSessionKey = undefined;
        if (!this.pendingCatalogUpdate) return;
        this.pendingCatalogUpdate = false;
        this.updateRows();
      });
      element.append(button, pinned, unread, actions);
    }
    return element;
  }

  private updateRow(element: HTMLElement, row: CatalogRow): void {
    element.id = this.rowElementID(row.key);
    if (row.kind === "section") {
      element.dataset.sectionWorkspace = row.workspaceID;
      const button = element.firstElementChild as HTMLButtonElement;
      button.tabIndex =
        this.rows.findIndex((candidate) => candidate.key === row.key) ===
        this.selectedIndex
          ? 0
          : -1;
      const twisty = button.querySelector<HTMLElement>(
        ".agent-session-section-twisty",
      )!;
      const direction = this.collapsed.has(row.workspaceID) ? "right" : "down";
      twisty.className = `agent-session-section-twisty codicon codicon-chevron-${direction}`;
      button.querySelector<HTMLElement>(
        ".agent-session-section-title",
      )!.textContent = row.workspaceName;
      button.querySelector<HTMLElement>(
        ".agent-session-section-count",
      )!.textContent = String(row.count);
      button.setAttribute(
        "aria-expanded",
        String(!this.collapsed.has(row.workspaceID)),
      );
      const toggle = element.querySelector<HTMLButtonElement>(
        '[data-section-action="toggle"]',
      );
      if (toggle)
        this.updateAction(
          toggle,
          this.collapsed.has(row.workspaceID)
            ? `Expand ${row.workspaceName}`
            : `Collapse ${row.workspaceName}`,
          this.collapsed.has(row.workspaceID) ? "expand-all" : "collapse-all",
        );
      return;
    }
    const button = element.firstElementChild as HTMLButtonElement;
    const state = this.statuses?.resolve(row.item) ?? {
      icon: "circle-outline",
      label: "Idle",
      state: "idle",
    };
    const active = this.active.isActive(row.identity);
    button.dataset.active = String(active);
    button.dataset.state = state.state;
    element.dataset.archived = String(this.isArchived(row));
    element.dataset.pinned = String(this.catalog.isPinned(row.identity));
    element.dataset.read = String(this.catalog.isRead(row.identity));
    element.dataset.identity = sessionIdentityKey(row.identity);
    element.dataset.selected = String(
      this.selected.has(sessionIdentityKey(row.identity)),
    );
    const status = button.querySelector<HTMLElement>(
      ".agent-session-status-icon",
    )!;
    status.className = `agent-session-status-icon codicon codicon-${state.icon}`;
    const main = button.querySelector<HTMLElement>(".agent-session-main")!;
    const title = main.querySelector<HTMLElement>(".agent-session-title")!;
    title.textContent = row.title;
    title.title = row.title;
    this.updateSessionDetails(main, row.item, state.label);
    button.setAttribute(
      "aria-label",
      [
        row.item?.provider,
        row.title,
        state.label,
        relativeTime(row.item?.createdAt),
      ]
        .filter(Boolean)
        .join(", "),
    );
    button.tabIndex =
      this.rows.findIndex((candidate) => candidate.key === row.key) ===
      this.selectedIndex
        ? 0
        : -1;
    button.setAttribute(
      "aria-pressed",
      String(this.selected.has(sessionIdentityKey(row.identity))),
    );
    const pinAction = element.querySelector<HTMLButtonElement>(
      '[data-command="zaw.session.togglePinned"]',
    );
    if (pinAction)
      this.updateAction(
        pinAction,
        this.catalog.isPinned(row.identity) ? "Unpin session" : "Pin session",
        this.catalog.isPinned(row.identity) ? "pinned" : "pin",
      );
    const archiveAction = element.querySelector<HTMLButtonElement>(
      '[data-command="zaw.session.toggleArchived"]',
    );
    if (archiveAction)
      this.updateAction(
        archiveAction,
        this.isArchived(row) ? "Unarchive session" : "Archive session",
        this.isArchived(row) ? "restore" : "archive",
      );
    const readAction = element.querySelector<HTMLButtonElement>(
      '[data-command="zaw.session.markRead"]',
    );
    if (readAction)
      this.updateAction(
        readAction,
        this.catalog.isRead(row.identity) ? "Mark unread" : "Mark read",
        this.catalog.isRead(row.identity) ? "circle-outline" : "circle-filled",
      );
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    )
      return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" || event.key === "End" ? -1 : 1;
    let index =
      event.key === "Home"
        ? -1
        : event.key === "End"
          ? this.rows.length
          : this.selectedIndex;
    index += direction;
    if (index < 0 || index >= this.rows.length) return;
    const row = this.rows[index];
    this.selectedIndex = index;
    if (row.kind === "session") this.select(row.identity);
    else {
      for (const candidate of this.list
        .getHTMLElement()
        .querySelectorAll<HTMLButtonElement>(
          ".agent-session-section, .agent-session-select",
        ))
        candidate.tabIndex = -1;
    }
    this.list.reveal(index);
    queueMicrotask(() => {
      const element = this.list
        .getHTMLElement()
        .querySelector<HTMLElement>(`#${this.rowElementID(row.key)}`);
      element
        ?.querySelector<HTMLElement>(
          row.kind === "session"
            ? ".agent-session-select"
            : ".agent-session-section",
        )
        ?.focus();
    });
  }

  private select(identity: SessionIdentity): void {
    this.catalog.markRead(identity);
    if (this.commands)
      void this.commands.executeCommand("zaw.session.open", identity);
    else {
      this.active.select(identity);
      void this.workspaces.select(identity.workspaceID);
    }
  }

  private handleSelection(identity: SessionIdentity, event: MouseEvent): void {
    const index = this.rows.findIndex(
      (row) =>
        row.kind === "session" &&
        sessionIdentityKey(row.identity) === sessionIdentityKey(identity),
    );
    const key = sessionIdentityKey(identity);
    if (event.shiftKey && this.selectionAnchor >= 0) {
      this.selected.clear();
      const [start, end] = [this.selectionAnchor, index].sort((a, b) => a - b);
      for (const row of this.rows.slice(start, end + 1))
        if (row.kind === "session")
          this.selected.add(sessionIdentityKey(row.identity));
      this.updateRows();
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (!this.selected.delete(key)) this.selected.add(key);
      this.selectionAnchor = index;
      this.updateRows();
      return;
    }
    this.selected.clear();
    this.selected.add(key);
    this.selectionAnchor = index;
    this.select(identity);
  }

  private sessionActions(): readonly ActionDescriptor[] {
    return (
      this.actionRegistry
        ?.actions("context")
        .filter((action) => action.id.startsWith("zaw.action.session.")) ?? []
    );
  }

  private actionContext(identity: SessionIdentity): SessionActionContext {
    const sessions = this.rows.flatMap((row) =>
      row.kind === "session" &&
      this.selected.has(sessionIdentityKey(row.identity))
        ? [row.identity]
        : [],
    );
    return {
      session: identity,
      sessions: sessions.length ? sessions : [identity],
    };
  }

  private runSessionAction(
    descriptor: ActionDescriptor,
    identity: SessionIdentity,
  ): void {
    const context = this.actionContext(identity);
    void this.commands?.executeCommand(
      descriptor.command,
      context,
      descriptor.command === "zaw.session.markRead"
        ? this.catalog.isRead(identity)
        : undefined,
    );
    this.closeContextMenu(true);
  }

  private showContextMenu(
    identity: SessionIdentity,
    anchor: HTMLElement,
    clientX?: number,
    clientY?: number,
  ): void {
    this.closeContextMenu();
    const menu = createElement("div", {
      ariaLabel: "Session actions",
      className: "agent-session-context-menu",
      role: "menu",
    });
    for (const descriptor of this.sessionActions()) {
      const action = createElement("button", {
        className: "agent-session-context-menu-item",
        role: "menuitem",
        textContent: this.actionLabel(descriptor, identity),
      });
      action.type = "button";
      action.addEventListener("click", () =>
        this.runSessionAction(descriptor, identity),
      );
      menu.append(action);
    }
    const anchorRect = anchor.getBoundingClientRect();
    menu.style.left = `${clientX || anchorRect.left}px`;
    menu.style.top = `${clientY || anchorRect.bottom}px`;
    this.pane.append(menu);
    const actions = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    setRovingTabStop(actions);
    const menuRect = menu.getBoundingClientRect();
    const left = Math.min(
      Number.parseFloat(menu.style.left),
      window.innerWidth - menuRect.width,
    );
    const top = Math.min(
      Number.parseFloat(menu.style.top),
      window.innerHeight - menuRect.height,
    );
    menu.style.left = `${Math.max(0, left)}px`;
    menu.style.top = `${Math.max(0, top)}px`;
    this.contextMenu = menu;
    this.contextMenuAnchor = anchor;
    const close = (event: Event) => {
      if (!menu.contains(event.target as Node)) this.closeContextMenu();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeContextMenu(true);
        return;
      }
      moveRovingFocus(event, actions, "vertical");
    };
    menu.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", close);
    this.contextMenuCleanup = () => {
      menu.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown", close);
    };
    queueMicrotask(() => {
      actions[0]?.focus();
    });
  }

  private closeContextMenu(restoreFocus = false): void {
    const anchor = this.contextMenuAnchor;
    this.contextMenuCleanup?.();
    this.contextMenuCleanup = undefined;
    this.contextMenu?.remove();
    this.contextMenu = undefined;
    this.contextMenuAnchor = undefined;
    if (restoreFocus && anchor?.isConnected) anchor.focus();
  }

  private actionLabel(
    descriptor: ActionDescriptor,
    identity: SessionIdentity,
  ): string {
    if (descriptor.command === "zaw.session.togglePinned")
      return this.catalog.isPinned(identity) ? "Unpin session" : "Pin session";
    if (descriptor.command === "zaw.session.toggleArchived")
      return this.catalog.isArchived(identity)
        ? "Unarchive session"
        : "Archive session";
    if (descriptor.command === "zaw.session.markRead")
      return this.catalog.isRead(identity) ? "Mark unread" : "Mark read";
    return descriptor.title;
  }

  private toggleFilter(): void {
    const visible = this.search.hidden;
    this.search.hidden = !visible;
    if (visible) this.search.focus();
    else {
      this.search.value = "";
      this.updateRows();
    }
  }

  private isArchived(row: Extract<CatalogRow, { kind: "session" }>): boolean {
    return (
      this.catalog.isArchived(row.identity) ||
      hasStatus(row.item?.status, ARCHIVED_STATUS)
    );
  }

  private identityFor(element: HTMLElement): SessionIdentity | undefined {
    const row = this.rows.find(
      (candidate) =>
        candidate.kind === "session" &&
        sessionIdentityKey(candidate.identity) === element.dataset.identity,
    );
    return row?.kind === "session" ? row.identity : undefined;
  }

  private toggleSection(workspaceID: string): void {
    if (!this.collapsed.delete(workspaceID)) this.collapsed.add(workspaceID);
    try {
      this.storage?.setItem(
        "zaw.session-catalog.collapsed",
        JSON.stringify([...this.collapsed]),
      );
    } catch {
      // Keep the in-memory collapse state.
    }
    this.updateRows();
  }

  private restoreCollapsed(): void {
    try {
      const raw = this.storage?.getItem("zaw.session-catalog.collapsed");
      if (!raw) return;
      const values = JSON.parse(raw) as unknown;
      if (!Array.isArray(values)) return;
      for (const value of values)
        if (typeof value === "string") this.collapsed.add(value);
    } catch {
      // Ignore malformed or unavailable persisted UI state.
    }
  }

  private rowElementID(key: string): string {
    return key.replace(/[^a-zA-Z0-9_-]/g, "-");
  }

  private updateAction(
    action: HTMLButtonElement,
    label: string,
    icon: string,
  ): void {
    action.setAttribute("aria-label", label);
    action.title = label;
    const glyph = action.querySelector<HTMLElement>(".zaw-action-glyph");
    if (!glyph) return;
    for (const className of [...glyph.classList])
      if (className.startsWith("codicon-") && className !== "codicon")
        glyph.classList.remove(className);
    glyph.classList.add(`codicon-${icon}`);
  }

  private createSessionMain(): HTMLElement {
    const main = createElement("span", { className: "agent-session-main" });
    const details = createElement("span", {
      className: "agent-session-details",
    });
    const diff = createElement("span", {
      className: "agent-session-detail-part agent-session-diff",
    });
    diff.append(
      createElement("span", { className: "agent-session-diff-added" }),
      createElement("span", { className: "agent-session-diff-removed" }),
    );
    details.append(
      createElement("span", {
        className: "agent-session-detail-part agent-session-badge",
      }),
      diff,
      createElement("span", {
        className: "agent-session-detail-part agent-session-description",
      }),
      createElement("span", {
        className: "agent-session-detail-part agent-session-time",
      }),
    );
    const approval = createElement("span", {
      className: "agent-session-approval-row",
    });
    approval.append(
      createElement("span", {
        className: "agent-session-approval-label",
      }),
      createElement("span", {
        className: "agent-session-approval-action",
        textContent: "Review",
      }),
    );
    main.append(
      createElement("span", { className: "agent-session-title" }),
      details,
      approval,
    );
    return main;
  }

  private updateSessionDetails(
    main: HTMLElement,
    item: SessionCatalogItem | undefined,
    stateLabel: string,
  ): void {
    const badge = main.querySelector<HTMLElement>(".agent-session-badge")!;
    const badgeText =
      item?.repository || item?.provider || item?.workingDirectory || "";
    badge.textContent = badgeText;
    badge.hidden = !badgeText;
    badge.title = badgeText;

    const additions = item?.changes?.additions ?? 0;
    const deletions = item?.changes?.deletions ?? 0;
    const diff = main.querySelector<HTMLElement>(".agent-session-diff")!;
    diff.hidden = additions === 0 && deletions === 0;
    diff.querySelector<HTMLElement>(".agent-session-diff-added")!.textContent =
      `+${additions}`;
    diff.querySelector<HTMLElement>(
      ".agent-session-diff-removed",
    )!.textContent = `−${deletions}`;

    const description = main.querySelector<HTMLElement>(
      ".agent-session-description",
    )!;
    const descriptionText = item?.activity || (item ? stateLabel : "");
    description.textContent = descriptionText;
    description.hidden = !descriptionText;
    description.title = descriptionText;

    const time = main.querySelector<HTMLElement>(".agent-session-time")!;
    const timeText = relativeTime(item?.modifiedAt);
    time.textContent = timeText;
    time.hidden = !timeText;

    const approval = main.querySelector<HTMLElement>(
      ".agent-session-approval-row",
    )!;
    const approvalLabel = item?.approval?.label ?? "";
    approval.hidden = !approvalLabel;
    approval.querySelector<HTMLElement>(
      ".agent-session-approval-label",
    )!.textContent = approvalLabel;
  }
}
