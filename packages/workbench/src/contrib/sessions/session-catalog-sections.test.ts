import { describe, expect, it } from "vitest";
import type { SessionCatalogItem } from "../../services/session-catalog";
import {
  calculateSessionSections,
  groupSessionCatalog,
  sessionDateSection,
} from "./session-catalog-sections";

const item = (modifiedAt: string): SessionCatalogItem => ({
  agentHostOnline: true,
  createdAt: modifiedAt,
  modifiedAt,
  observedAt: modifiedAt,
  provider: "fixture",
  resource: `ahp-session:/${modifiedAt}`,
  stale: false,
  status: 0,
  title: modifiedAt,
  workspaceId: "workspace",
});

describe("session catalog sections", () => {
  const now = new Date(2026, 6, 28, 12).getTime();

  it("classifies pin, archive, and calendar date groups deterministically", () => {
    expect(
      sessionDateSection(item("2026-07-28T08:00:00"), {
        archived: false,
        now,
        pinned: false,
      }),
    ).toBe("today");
    expect(
      sessionDateSection(item("2026-07-27T08:00:00"), {
        archived: false,
        now,
        pinned: false,
      }),
    ).toBe("yesterday");
    expect(
      sessionDateSection(item("2026-07-24T08:00:00"), {
        archived: false,
        now,
        pinned: false,
      }),
    ).toBe("week");
    expect(
      sessionDateSection(item("2026-07-28T08:00:00"), {
        archived: false,
        now,
        pinned: true,
      }),
    ).toBe("pinned");
    expect(
      sessionDateSection(item("2026-07-28T08:00:00"), {
        archived: true,
        now,
        pinned: true,
      }),
    ).toBe("archived");
  });

  it("orders sections before repository and recency", () => {
    const entries = calculateSessionSections(
      [item("2026-07-20T08:00:00"), item("2026-07-28T08:00:00")],
      { isArchived: () => false, isPinned: () => false, now },
    );
    expect(entries.map((entry) => entry.section)).toEqual(["today", "older"]);
  });

  it("matches capped More and repository Show More section shapes", () => {
    const items = Array.from({ length: 7 }, (_, index) => ({
      ...item(`2026-07-${String(28 - index).padStart(2, "0")}T08:00:00`),
      repository: index === 6 ? "other/repository" : "owner/zaw.git",
      resource: `ahp-session:/${index}`,
    }));
    const pinned = new Set([items[0].resource]);
    const archived = new Set([items[6].resource]);
    const options = {
      isArchived: (candidate: SessionCatalogItem) =>
        archived.has(candidate.resource),
      isPinned: (candidate: SessionCatalogItem) =>
        pinned.has(candidate.resource),
      now,
    };

    const capped = groupSessionCatalog(items, {
      ...options,
      grouping: "capped",
    });
    expect(capped.slice(0, 4).map((node) => node.kind)).toEqual([
      "session",
      "session",
      "session",
      "session",
    ]);
    expect(capped.at(-1)).toMatchObject({
      kind: "section",
      label: "More",
      section: "more",
      sessions: { length: 3 },
    });

    const repositories = groupSessionCatalog(items, {
      ...options,
      grouping: "repository",
      repositoryLimit: 3,
    });
    expect(repositories[0]).toMatchObject({
      item: { resource: items[0].resource },
      kind: "session",
    });
    expect(repositories[1]).toMatchObject({
      children: [
        { kind: "session" },
        { kind: "session" },
        { kind: "session" },
        { kind: "show-more", remainingCount: 2 },
      ],
      kind: "section",
      label: "zaw",
      section: "repository",
    });
    expect(repositories.at(-1)).toMatchObject({
      kind: "section",
      section: "archived",
    });
  });
});
