import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionCatalogService } from "./session-catalog-service";
import type { ISessionCatalogProvider } from "../../services/session-catalog";
import { ActiveSessionService } from "../../services/active-session";

describe("SessionCatalogService", () => {
  afterEach(() => vi.useRealTimers());

  it("polls with a fake clock without changing the active session", async () => {
    vi.useFakeTimers();
    const provider = {
      list: vi.fn().mockResolvedValue([
        {
          workspaceId: "one",
          resource: "ahp-session:/one",
          title: "One",
          agentHostOnline: true,
        },
      ]),
    } as unknown as ISessionCatalogProvider;
    const catalog = new SessionCatalogService(provider);
    const active = new ActiveSessionService();
    active.select({
      workspaceID: "selected",
      resource: "ahp-session:/selected",
    });
    catalog.start();
    await Promise.resolve();
    expect(provider.list).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(provider.list).toHaveBeenCalledTimes(2);
    expect(catalog.sessions.one).toEqual(["ahp-session:/one"]);
    expect(active.current()).toEqual({
      workspaceID: "selected",
      resource: "ahp-session:/selected",
    });
    catalog.dispose();
  });

  it("persists local pin, archive, and read state separately from provider data", () => {
    const values = new Map<string, string>();
    const storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    } as Storage;
    const provider = { list: vi.fn() } as unknown as ISessionCatalogProvider;
    const identity = { workspaceID: "one", resource: "ahp-session:/one" };
    const first = new SessionCatalogService(provider, storage);
    first.togglePinned(identity);
    first.toggleArchived(identity);
    first.markRead(identity, false);

    const restored = new SessionCatalogService(provider, storage);

    expect(restored.isPinned(identity)).toBe(true);
    expect(restored.isArchived(identity)).toBe(true);
    expect(restored.isRead(identity)).toBe(false);
    restored.markRead(identity);
    expect(restored.isRead(identity)).toBe(true);
  });

  it("does not let a stale provider response overwrite a newer refresh", async () => {
    let resolveFirst!: (items: never[]) => void;
    const first = new Promise<never[]>((resolve) => {
      resolveFirst = resolve;
    });
    const provider = {
      list: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce([
          {
            agentHostOnline: true,
            resource: "ahp-session:/new",
            title: "New",
            workspaceId: "one",
          },
        ]),
    } as unknown as ISessionCatalogProvider;
    const catalog = new SessionCatalogService(provider);

    const staleRefresh = catalog.refresh();
    await catalog.refresh();
    resolveFirst([
      {
        agentHostOnline: true,
        resource: "ahp-session:/old",
        title: "Old",
        workspaceId: "one",
      } as never,
    ]);

    expect(await staleRefresh).toBe(false);
    expect(catalog.sessions.one).toEqual(["ahp-session:/new"]);
  });

  it("merges concurrent refreshes without clearing siblings or local state", async () => {
    let resolveFirst!: (items: never[]) => void;
    const first = new Promise<never[]>((resolve) => {
      resolveFirst = resolve;
    });
    const provider = {
      list: vi.fn((providerName?: string) =>
        providerName === "alpha"
          ? first
          : Promise.resolve([
              {
                agentHostOnline: true,
                provider: "beta",
                resource: "ahp-session:/beta-new",
                title: "Beta New",
                workspaceId: "one",
              },
            ]),
      ),
    } as unknown as ISessionCatalogProvider;
    const catalog = new SessionCatalogService(provider);
    catalog.apply([
      {
        agentHostOnline: true,
        provider: "alpha",
        resource: "ahp-session:/alpha-old",
        title: "Alpha Old",
        workspaceId: "one",
      },
      {
        agentHostOnline: true,
        provider: "beta",
        resource: "ahp-session:/beta-old",
        title: "Beta Old",
        workspaceId: "one",
      },
    ] as never[]);
    const alphaIdentity = {
      resource: "ahp-session:/alpha-old",
      workspaceID: "one",
    };
    catalog.togglePinned(alphaIdentity);

    const alphaRefresh = catalog.refreshProvider("alpha");
    await catalog.refreshProvider("beta");
    resolveFirst([
      {
        agentHostOnline: true,
        provider: "alpha",
        resource: "ahp-session:/alpha-new",
        title: "Alpha New",
        workspaceId: "one",
      } as never,
    ]);
    await alphaRefresh;

    expect(catalog.items.map((entry) => entry.resource).sort()).toEqual([
      "ahp-session:/alpha-new",
      "ahp-session:/beta-new",
    ]);
    expect(catalog.isPinned(alphaIdentity)).toBe(true);
  });
});
