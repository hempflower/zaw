import { Emitter, type Event } from "@zaw/ui";
import { inject, injectable, optional } from "inversify";
import {
  IContextKeyService,
  type IContextKey,
} from "../../platform/context-key/context-key";
import { TerminalContext } from "../../workbench/context-keys";
import { IWorkbenchLayoutService, Part } from "../../workbench/layout/layout";

export const ITerminalGroupService = Symbol.for("ITerminalGroupService");

export interface ITerminalGroupService {
  readonly collapsed: boolean;
  readonly onDidChange: Event<void>;
  readonly open: boolean;
  openPanel(): void;
  toggleCollapse(): void;
  toggleOpen(): void;
}

/** Owns panel placement state; terminal resources remain in ITerminalService. */
@injectable()
export class TerminalGroupService implements ITerminalGroupService {
  private _open = false;
  private _collapsed = false;
  private readonly emitter = new Emitter<void>();
  private readonly openContext: IContextKey<boolean> | undefined;
  readonly onDidChange = this.emitter.event;

  get open(): boolean {
    return this._open;
  }
  get collapsed(): boolean {
    return this._collapsed;
  }

  constructor(
    @optional() @inject(IContextKeyService) contextKeys?: IContextKeyService,
    @optional()
    @inject(IWorkbenchLayoutService)
    private readonly layout?: IWorkbenchLayoutService,
  ) {
    this.openContext = contextKeys && TerminalContext.open.bindTo(contextKeys);
  }

  openPanel(): void {
    if (this._open) return;
    this._open = true;
    this.layout?.setVisible(Part.Panel, true);
    this.openContext?.set(true);
    this.emitter.fire();
  }

  toggleOpen(): void {
    this._open = !this._open;
    this.layout?.setVisible(Part.Panel, this._open);
    this.openContext?.set(this._open);
    this.emitter.fire();
  }

  toggleCollapse(): void {
    this._collapsed = !this._collapsed;
    this.emitter.fire();
  }
}
