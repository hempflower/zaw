export type DetailTabKind = "changes" | "files" | "preview";

export type DetailTabViewModel = {
  id: string;
  title: string;
  kind: DetailTabKind;
  content?: string;
};

export type FileViewModel = {
  name: string;
  type: "directory" | "file";
  uri: string;
};

export type TerminalViewModel = {
  resource: string;
  title: string;
  output: string;
};

export type WorkspaceChangeViewModel = {
  id: string;
  path: string;
  reviewed: boolean;
  status: string;
};
