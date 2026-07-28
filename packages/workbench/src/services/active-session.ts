import { Emitter, type Event } from "@zaw/ui";
import { inject, injectable, optional } from "inversify";
import {
  IContextKeyService,
  type IContextKey,
} from "../platform/context-key/context-key";
import { WorkspaceContext } from "../workbench/context-keys";

export const IActiveSessionService = Symbol.for("IActiveSessionService");

export type SessionIdentity = {
  workspaceID: string;
  resource: string;
};

export interface IActiveSessionService {
  readonly onDidChange: Event<SessionIdentity | null>;
  current(): SessionIdentity | null;
  clear(): void;
  select(identity: SessionIdentity): void;
  isActive(identity: SessionIdentity): boolean;
}

@injectable()
export class ActiveSessionService implements IActiveSessionService {
  private selected: SessionIdentity | null = null;
  private readonly emitter = new Emitter<SessionIdentity | null>();
  readonly onDidChange = this.emitter.event;
  private readonly activeContext: IContextKey<boolean> | undefined;

  constructor(
    @optional() @inject(IContextKeyService) contextKeys?: IContextKeyService,
  ) {
    this.activeContext =
      contextKeys && WorkspaceContext.sessionActive.bindTo(contextKeys);
  }

  current() {
    return this.selected ? { ...this.selected } : null;
  }

  clear() {
    if (!this.selected) return;
    this.selected = null;
    this.activeContext?.set(false);
    this.emitter.fire(null);
  }

  select(identity: SessionIdentity) {
    if (this.isActive(identity)) return;
    this.selected = { ...identity };
    this.activeContext?.set(true);
    this.emitter.fire(this.current());
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
