// @vitest-environment happy-dom

import { Emitter } from "@zaw/ui";
import { describe, expect, it } from "vitest";
import type { IActionRegistry } from "../../platform/actions/actions";
import type { ICommandService } from "../../platform/commands/commands";
import type { IActiveSessionService } from "../../services/active-session";
import type { SessionCatalogItem } from "../../services/session-catalog";
import type { IWorkspaceService } from "../workspace/workspace-service";
import type { ISessionCatalogService } from "./session-catalog-service";
import { SessionCatalogPane, approvalRowHeight } from "./session-catalog-view";

const createItem = (title: string, activity: string): SessionCatalogItem => ({
  activity,
  agentHostOnline: true,
  changes: { additions: 2, deletions: 1, files: 1 },
  createdAt: "2026-07-28T08:00:00Z",
  modifiedAt: "2026-07-28T09:00:00Z",
  observedAt: "2026-07-28T09:00:00Z",
  provider: "Copilot",
  repository: "zaw",
  resource: "ahp-session:/one",
  stale: false,
  status: 0,
  title,
  workspaceId: "one",
});

describe("SessionCatalogPane", () => {
  it("uses the source approval row height formula capped at three lines", () => {
    expect(approvalRowHeight("one")).toBe(32);
    expect(approvalRowHeight("one\ntwo\nthree\nfour")).toBe(68);
  });
  it("updates session and section details without replacing stable child nodes", () => {
    const changes = new Emitter<void>();
    const filterRequests = new Emitter<void>();
    let item = createItem("First title", "Starting");
    const catalog = {
      get items() {
        return [item];
      },
      sessions: { one: [item.resource] },
      get sessionTitles() {
        return { "one|ahp-session%3A%2Fone": item.title };
      },
      isArchived: () => false,
      isPinned: () => false,
      isRead: () => true,
      markRead: () => undefined,
      onDidChange: changes.event,
      onDidRequestFilter: filterRequests.event,
    } as unknown as ISessionCatalogService;
    const activeChanges = new Emitter<null>();
    const active = {
      current: () => null,
      isActive: () => false,
      onDidChange: activeChanges.event,
      select: () => undefined,
    } as unknown as IActiveSessionService;
    const workspaceChanges = new Emitter<void>();
    const workspaces = {
      onDidChange: workspaceChanges.event,
      select: async () => undefined,
      workspaces: [{ id: "one", name: "zaw" }],
    } as unknown as IWorkspaceService;
    const root = document.createElement("div");
    const pane = new SessionCatalogPane(root, catalog, workspaces, active);
    const title = root.querySelector<HTMLElement>(".agent-session-title")!;
    const details = root.querySelector<HTMLElement>(".agent-session-details")!;
    const detailChildren = [...details.children];
    const sectionTitle = root.querySelector<HTMLElement>(
      ".agent-session-section-title",
    )!;
    const observer = new MutationObserver(() => undefined);
    observer.observe(root, { childList: true, subtree: true });

    item = createItem("Updated title", "Complete");
    changes.fire();
    const removed = observer
      .takeRecords()
      .flatMap((record) => Array.from(record.removedNodes));

    expect(root.querySelector(".agent-session-title")).toBe(title);
    expect([...details.children]).toEqual(detailChildren);
    expect(root.querySelector(".agent-session-section-title")).toBe(
      sectionTitle,
    );
    expect(title.textContent).toBe("Updated title");
    expect(details.textContent).toContain("Complete");
    expect(details.textContent).toContain("+2");
    expect(details.textContent).toContain("−1");
    expect(removed.some((node) => node === title || node === details)).toBe(
      false,
    );
    observer.disconnect();
    pane.dispose();
  });

  it("holds catalog updates while a session hover is active", () => {
    const changes = new Emitter<void>();
    const filterRequests = new Emitter<void>();
    let item = createItem("Before hover", "Starting");
    const catalog = {
      get items() {
        return [item];
      },
      sessions: { one: [item.resource] },
      get sessionTitles() {
        return { "one|ahp-session%3A%2Fone": item.title };
      },
      isArchived: () => false,
      isPinned: () => false,
      isRead: () => true,
      markRead: () => undefined,
      onDidChange: changes.event,
      onDidRequestFilter: filterRequests.event,
    } as unknown as ISessionCatalogService;
    const root = document.createElement("div");
    const pane = new SessionCatalogPane(
      root,
      catalog,
      {
        onDidChange: new Emitter<void>().event,
        select: async () => undefined,
        workspaces: [{ id: "one", name: "zaw" }],
      } as unknown as IWorkspaceService,
      {
        current: () => null,
        isActive: () => false,
        onDidChange: new Emitter<null>().event,
      } as unknown as IActiveSessionService,
    );
    const row = root.querySelector<HTMLElement>(
      ".agent-session-select",
    )!.parentElement!;
    row.dispatchEvent(new MouseEvent("mouseenter"));
    item = createItem("Resolved hover details", "Complete");
    changes.fire();
    expect(root.querySelector(".agent-session-title")?.textContent).toBe(
      "Before hover",
    );
    row.dispatchEvent(new MouseEvent("mouseleave"));
    expect(root.querySelector(".agent-session-title")?.textContent).toBe(
      "Resolved hover details",
    );
    pane.dispose();
  });

  it("anchors the keyboard context menu, roves its items, and restores focus", async () => {
    const item = createItem("Context session", "Idle");
    const catalog = {
      items: [item],
      sessions: { one: [item.resource] },
      sessionTitles: { "one|ahp-session%3A%2Fone": item.title },
      isArchived: () => false,
      isPinned: () => false,
      isRead: () => true,
      markRead: () => undefined,
      onDidChange: new Emitter<void>().event,
      onDidRequestFilter: new Emitter<void>().event,
    } as unknown as ISessionCatalogService;
    const root = document.createElement("div");
    document.body.append(root);
    const pane = new SessionCatalogPane(
      root,
      catalog,
      {
        onDidChange: new Emitter<void>().event,
        select: async () => undefined,
        workspaces: [{ id: "one", name: "zaw" }],
      } as unknown as IWorkspaceService,
      {
        current: () => null,
        isActive: () => false,
        onDidChange: new Emitter<null>().event,
      } as unknown as IActiveSessionService,
      { executeCommand: async () => undefined } as ICommandService,
      undefined,
      {
        actions: (menu) =>
          menu === "context"
            ? [
                {
                  command: "zaw.session.togglePinned",
                  id: "zaw.action.session.pin",
                  menu: "context" as const,
                  title: "Pin session",
                },
                {
                  command: "zaw.session.toggleArchived",
                  id: "zaw.action.session.archive",
                  menu: "context" as const,
                  title: "Archive session",
                },
              ]
            : [],
        onDidChange: new Emitter<void>().event,
        registerAction: () => ({ dispose: () => undefined }),
      } as IActionRegistry,
    );
    const anchor = root.querySelector<HTMLButtonElement>(
      ".agent-session-select",
    )!;
    anchor.focus();
    anchor.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "F10",
        shiftKey: true,
      }),
    );
    await Promise.resolve();
    const items = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    expect(items).toHaveLength(2);
    expect(document.activeElement).toBe(items[0]);
    items[0].dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
    );
    expect(document.activeElement).toBe(items[1]);
    items[1].dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(anchor);
    pane.dispose();
    root.remove();
  });
});
