import { inject, injectable } from "inversify";

export const IWorkbenchStorage = Symbol.for("IWorkbenchStorage");
export const IWorkspaceUIStateService = Symbol.for("IWorkspaceUIStateService");

export type WorkspaceUIState = {
  activeDetailTabID?: string;
  activeTerminal?: string;
  sessionDetails?: Record<string, SessionDetailUIState>;
  sessionResource?: string;
  terminalOpen?: boolean;
  terminalPanelHeight?: number;
};

export type SessionDetailUIState = {
  activeView?: {
    content?: string;
    id: string;
    kind: "changes" | "files" | "preview";
    title: string;
  };
  auxiliaryVisible?: boolean;
};

export interface IWorkspaceUIStateService {
  load(workspaceID: string): WorkspaceUIState;
  loadSessionDetails(
    workspaceID: string,
    sessionResource: string,
  ): SessionDetailUIState;
  save(workspaceID: string, state: WorkspaceUIState): void;
  saveSessionDetails(
    workspaceID: string,
    sessionResource: string,
    state: SessionDetailUIState,
  ): void;
}

@injectable()
export class WorkspaceUIStateService implements IWorkspaceUIStateService {
  private readonly memory = new Map<string, WorkspaceUIState>();

  constructor(@inject(IWorkbenchStorage) private readonly storage?: Storage) {}

  load(workspaceID: string) {
    const memory = this.memory.get(workspaceID);
    if (memory) return structuredClone(memory);
    try {
      const value = this.storage?.getItem(this.key(workspaceID));
      return value ? (JSON.parse(value) as WorkspaceUIState) : {};
    } catch {
      return {};
    }
  }

  save(workspaceID: string, state: WorkspaceUIState) {
    const snapshot = structuredClone(state);
    this.memory.set(workspaceID, snapshot);
    try {
      this.storage?.setItem(this.key(workspaceID), JSON.stringify(snapshot));
    } catch {
      // In-memory restoration still works when browser storage is unavailable.
    }
  }

  loadSessionDetails(
    workspaceID: string,
    sessionResource: string,
  ): SessionDetailUIState {
    return structuredClone(
      this.load(workspaceID).sessionDetails?.[sessionResource] ?? {},
    );
  }

  saveSessionDetails(
    workspaceID: string,
    sessionResource: string,
    state: SessionDetailUIState,
  ): void {
    const workspace = this.load(workspaceID);
    this.save(workspaceID, {
      ...workspace,
      sessionDetails: {
        ...workspace.sessionDetails,
        [sessionResource]: structuredClone(state),
      },
    });
  }

  private key(workspaceID: string) {
    return `zaw.workspace-state.${workspaceID}`;
  }
}
