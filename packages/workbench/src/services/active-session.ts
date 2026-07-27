import { injectable } from "inversify";

export const IActiveSessionService = Symbol.for("IActiveSessionService");

export type SessionIdentity = {
  workspaceID: string;
  resource: string;
};

export interface IActiveSessionService {
  current(): SessionIdentity | null;
  clear(): void;
  select(identity: SessionIdentity): void;
  isActive(identity: SessionIdentity): boolean;
}

@injectable()
export class ActiveSessionService implements IActiveSessionService {
  private selected: SessionIdentity | null = null;

  current() {
    return this.selected ? { ...this.selected } : null;
  }

  clear() {
    this.selected = null;
  }

  select(identity: SessionIdentity) {
    this.selected = { ...identity };
  }

  isActive(identity: SessionIdentity) {
    return (
      this.selected?.workspaceID === identity.workspaceID &&
      this.selected.resource === identity.resource
    );
  }
}

export function sessionIdentityKey(identity: SessionIdentity) {
  return `${encodeURIComponent(identity.workspaceID)}|${encodeURIComponent(
    identity.resource,
  )}`;
}

export function parseSessionIdentityKey(value: string): SessionIdentity | null {
  const separator = value.indexOf("|");
  if (separator < 1 || separator === value.length - 1) return null;
  try {
    return {
      workspaceID: decodeURIComponent(value.slice(0, separator)),
      resource: decodeURIComponent(value.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}
