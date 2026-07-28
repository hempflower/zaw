import { Disposable } from "@zaw/ui";
import { inject, injectable } from "inversify";
import type { ICommandService } from "../platform/commands/commands";
import {
  IContextKeyService,
  type IContextKey,
} from "../platform/context-key/context-key";
import { NavigationContext } from "../workbench/context-keys";
import {
  IActiveSessionService,
  sessionIdentityKey,
  type SessionIdentity,
} from "./active-session";
import { ICommandService as ICommandServiceID } from "../platform/commands/commands";

export const IWorkbenchNavigationService = Symbol.for(
  "IWorkbenchNavigationService",
);

export interface IWorkbenchNavigationService {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  back(): Promise<void>;
  forward(): Promise<void>;
}

/** Session-aware workbench navigation history used by the titlebar actions. */
@injectable()
export class WorkbenchNavigationService
  extends Disposable
  implements IWorkbenchNavigationService
{
  private readonly entries: Array<SessionIdentity | null>;
  private index = 0;
  private expectedNavigation: string | null | undefined;
  private readonly canBackContext: IContextKey<boolean>;
  private readonly canForwardContext: IContextKey<boolean>;

  constructor(
    @inject(IActiveSessionService)
    private readonly active: IActiveSessionService,
    @inject(ICommandServiceID) private readonly commands: ICommandService,
    @inject(IContextKeyService) context: IContextKeyService,
  ) {
    super();
    this.entries = [this.copy(this.active.current())];
    this.canBackContext = NavigationContext.canGoBack.bindTo(context);
    this.canForwardContext = NavigationContext.canGoForward.bindTo(context);
    this._register(
      this.active.onDidChange((identity) => this.record(identity)),
    );
    this.syncContext();
  }

  get canGoBack(): boolean {
    return this.index > 0;
  }

  get canGoForward(): boolean {
    return this.index < this.entries.length - 1;
  }

  back(): Promise<void> {
    return this.go(-1);
  }

  forward(): Promise<void> {
    return this.go(1);
  }

  private async go(offset: -1 | 1): Promise<void> {
    const nextIndex = this.index + offset;
    if (nextIndex < 0 || nextIndex >= this.entries.length) return;
    const previousIndex = this.index;
    const target = this.entries[nextIndex];
    this.index = nextIndex;
    this.expectedNavigation = this.key(target);
    this.syncContext();
    try {
      if (target)
        await this.commands.executeCommand(
          "zaw.session.open",
          this.copy(target),
        );
      else this.active.clear();
      if (this.expectedNavigation !== undefined)
        this.expectedNavigation = undefined;
    } catch (error) {
      this.index = previousIndex;
      this.expectedNavigation = undefined;
      this.syncContext();
      throw error;
    }
  }

  private record(identity: SessionIdentity | null): void {
    const key = this.key(identity);
    if (
      this.expectedNavigation !== undefined &&
      key === this.expectedNavigation
    ) {
      this.expectedNavigation = undefined;
      this.syncContext();
      return;
    }
    if (this.key(this.entries[this.index]) === key) return;
    this.entries.splice(this.index + 1);
    this.entries.push(this.copy(identity));
    if (this.entries.length > 50) this.entries.shift();
    this.index = this.entries.length - 1;
    this.expectedNavigation = undefined;
    this.syncContext();
  }

  private syncContext(): void {
    this.canBackContext.set(this.canGoBack);
    this.canForwardContext.set(this.canGoForward);
  }

  private key(identity: SessionIdentity | null): string | null {
    return identity ? sessionIdentityKey(identity) : null;
  }

  private copy(identity: SessionIdentity | null): SessionIdentity | null {
    return identity ? { ...identity } : null;
  }
}
