import { inject, injectable } from "inversify";

export const IWorkbenchStorage = Symbol.for("IWorkbenchStorage");
export const IWorkspaceUIStateService = Symbol.for("IWorkspaceUIStateService");

export type WorkspaceUIState = {
  activeDetailTabID?: string;
  activeTerminal?: string;
  sessionResource?: string;
  terminalOpen?: boolean;
  terminalPanelHeight?: number;
};

export interface IWorkspaceUIStateService {
  load(workspaceID: string): WorkspaceUIState;
  save(workspaceID: string, state: WorkspaceUIState): void;
}

@injectable()
export class WorkspaceUIStateService implements IWorkspaceUIStateService {
  private readonly memory = new Map<string, WorkspaceUIState>();

  constructor(@inject(IWorkbenchStorage) private readonly storage?: Storage) {}

  load(workspaceID: string) {
    const memory = this.memory.get(workspaceID);
    if (memory) return { ...memory };
    try {
      const value = this.storage?.getItem(this.key(workspaceID));
      return value ? (JSON.parse(value) as WorkspaceUIState) : {};
    } catch {
      return {};
    }
  }

  save(workspaceID: string, state: WorkspaceUIState) {
    const snapshot = { ...state };
    this.memory.set(workspaceID, snapshot);
    try {
      this.storage?.setItem(this.key(workspaceID), JSON.stringify(snapshot));
    } catch {
      // In-memory restoration still works when browser storage is unavailable.
    }
  }

  private key(workspaceID: string) {
    return `zaw.workspace-state.${workspaceID}`;
  }
}
