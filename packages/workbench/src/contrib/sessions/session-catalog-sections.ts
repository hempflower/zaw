import type { SessionCatalogItem } from "../../services/session-catalog";

export type SessionDateSection =
  | "pinned"
  | "today"
  | "yesterday"
  | "week"
  | "older"
  | "archived";

export type SessionSection = SessionDateSection | "more" | "repository";
export type SessionGrouping = "capped" | "date" | "repository";

export type SessionCatalogChild =
  | { readonly kind: "session"; readonly item: SessionCatalogItem }
  | {
      readonly kind: "show-more";
      readonly remainingCount: number;
      readonly sectionLabel: string;
    }
  | { readonly kind: "show-less"; readonly sectionLabel: string };

export type SessionCatalogNode =
  | { readonly kind: "session"; readonly item: SessionCatalogItem }
  | {
      readonly children: readonly SessionCatalogChild[];
      readonly kind: "section";
      readonly label: string;
      readonly section: SessionSection;
      readonly sessions: readonly SessionCatalogItem[];
    };

export interface SessionSectionEntry {
  readonly item: SessionCatalogItem;
  readonly repository: string;
  readonly section: SessionDateSection;
}

export const sessionSectionOrder: readonly SessionDateSection[] = [
  "pinned",
  "today",
  "yesterday",
  "week",
  "older",
  "archived",
];

const sectionLabels: Record<SessionSection, string> = {
  archived: "Archived",
  more: "More",
  older: "Older",
  pinned: "Pinned",
  repository: "Other",
  today: "Today",
  week: "Previous 7 Days",
  yesterday: "Yesterday",
};

export function sessionDateSection(
  item: SessionCatalogItem,
  options: {
    archived: boolean;
    now: number;
    pinned: boolean;
  },
): SessionDateSection {
  if (options.archived) return "archived";
  if (options.pinned) return "pinned";
  const modified = Date.parse(item.modifiedAt);
  if (!Number.isFinite(modified)) return "older";
  const startToday = startOfLocalDay(options.now);
  if (modified >= startToday) return "today";
  const ageInDays = (startToday - modified) / 86_400_000;
  if (ageInDays <= 1) return "yesterday";
  if (ageInDays <= 7) return "week";
  return "older";
}

export function calculateSessionSections(
  items: readonly SessionCatalogItem[],
  options: {
    isArchived: (item: SessionCatalogItem) => boolean;
    isPinned: (item: SessionCatalogItem) => boolean;
    now?: number;
  },
): SessionSectionEntry[] {
  const now = options.now ?? Date.now();
  return items
    .map((item) => ({
      item,
      repository: item.repository || item.workingDirectory || item.workspaceId,
      section: sessionDateSection(item, {
        archived: options.isArchived(item),
        now,
        pinned: options.isPinned(item),
      }),
    }))
    .sort((left, right) => {
      const section =
        sessionSectionOrder.indexOf(left.section) -
        sessionSectionOrder.indexOf(right.section);
      if (section) return section;
      const repository = left.repository.localeCompare(right.repository);
      if (repository) return repository;
      return (
        Date.parse(right.item.modifiedAt) - Date.parse(left.item.modifiedAt)
      );
    });
}

/**
 * Produces the same three root shapes as VS Code's AgentSessionsDataSource:
 * date sections, capped recent sessions with a More section, or repository
 * sections with capped Show More / Show Less children.
 */
export function groupSessionCatalog(
  items: readonly SessionCatalogItem[],
  options: {
    expandedRepositories?: ReadonlySet<string>;
    grouping: SessionGrouping;
    isArchived: (item: SessionCatalogItem) => boolean;
    isPinned: (item: SessionCatalogItem) => boolean;
    now?: number;
    repositoryLimit?: number;
  },
): SessionCatalogNode[] {
  const entries = calculateSessionSections(items, options);
  const sessionNode = (item: SessionCatalogItem) =>
    ({ kind: "session", item }) as const;
  const sectionNode = (
    section: SessionSection,
    label: string,
    sessions: readonly SessionCatalogItem[],
    children: readonly SessionCatalogChild[] = sessions.map(sessionNode),
  ): SessionCatalogNode => ({
    children,
    kind: "section",
    label,
    section,
    sessions,
  });

  if (options.grouping === "capped") {
    const active = entries.filter((entry) => entry.section !== "archived");
    const pinned = active.filter((entry) => options.isPinned(entry.item));
    const unpinned = active.filter((entry) => !options.isPinned(entry.item));
    const visible = unpinned.slice(0, 3);
    const remaining = [
      ...unpinned.slice(3),
      ...entries.filter((entry) => entry.section === "archived"),
    ].map((entry) => entry.item);
    const result: SessionCatalogNode[] = [
      ...pinned.map((entry) => sessionNode(entry.item)),
      ...visible.map((entry) => sessionNode(entry.item)),
    ];
    if (remaining.length)
      result.push(sectionNode("more", sectionLabels.more, remaining));
    return result;
  }

  if (options.grouping === "repository") {
    const result: SessionCatalogNode[] = entries
      .filter(
        (entry) => entry.section !== "archived" && options.isPinned(entry.item),
      )
      .map((entry) => sessionNode(entry.item));
    const repositories = new Map<string, SessionCatalogItem[]>();
    const archived: SessionCatalogItem[] = [];
    for (const entry of entries) {
      if (entry.section === "archived") {
        archived.push(entry.item);
        continue;
      }
      if (options.isPinned(entry.item)) continue;
      const repository = repositoryName(entry.item) ?? sectionLabels.repository;
      repositories.set(repository, [
        ...(repositories.get(repository) ?? []),
        entry.item,
      ]);
    }
    const limit = options.repositoryLimit ?? 5;
    for (const [label, sessions] of [...repositories].sort(([left], [right]) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    )) {
      const expanded = options.expandedRepositories?.has(label) ?? false;
      const visible = expanded ? sessions : sessions.slice(0, limit);
      const children: SessionCatalogChild[] = visible.map(sessionNode);
      if (sessions.length > limit) {
        children.push(
          expanded
            ? { kind: "show-less", sectionLabel: label }
            : {
                kind: "show-more",
                remainingCount: sessions.length - limit,
                sectionLabel: label,
              },
        );
      }
      result.push(sectionNode("repository", label, sessions, children));
    }
    if (archived.length)
      result.push(sectionNode("archived", sectionLabels.archived, archived));
    return result;
  }

  return sessionSectionOrder.flatMap((section) => {
    const sessions = entries
      .filter((entry) => entry.section === section)
      .map((entry) => entry.item);
    return sessions.length
      ? [sectionNode(section, sectionLabels[section], sessions)]
      : [];
  });
}

function repositoryName(item: SessionCatalogItem): string | undefined {
  const raw = item.repository || item.workingDirectory;
  if (!raw) return undefined;
  const normalized = raw.replace(/[\\/]+$/, "").replace(/\.git$/i, "");
  return normalized
    .split(/[\\/:]/)
    .filter(Boolean)
    .at(-1);
}

function startOfLocalDay(timestamp: number): number {
  const value = new Date(timestamp);
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  ).getTime();
}
