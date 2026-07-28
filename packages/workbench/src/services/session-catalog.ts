export const ISessionCatalogProvider = Symbol.for("ISessionCatalogProvider");

export type SessionCatalogItem = {
  workspaceId: string;
  resource: string;
  provider: string;
  title: string;
  status: number;
  activity?: string;
  repository?: string;
  workingDirectory?: string;
  createdAt: string;
  modifiedAt: string;
  observedAt: string;
  agentHostOnline: boolean;
  stale: boolean;
  approval?: {
    label: string;
  };
  changes?: {
    additions?: number;
    deletions?: number;
    files?: number;
  };
};

export type SessionCatalogPage = {
  items: SessionCatalogItem[];
  nextCursor?: string;
};

export interface ISessionCatalogProvider {
  list(provider?: string): Promise<SessionCatalogItem[]>;
}
