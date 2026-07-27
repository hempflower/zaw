import { DisposableStore, Emitter, Widget } from "@zaw/ui";
import type { ISessionEventRendererRegistry } from "./session-event-renderer-registry";

export type SessionEvent =
  | { kind: "message"; role: "agent" | "user"; text: string }
  | {
      kind: "tool";
      toolCallID: string;
      title: string;
      detail: string;
      state: string;
    }
  | {
      kind: "approval";
      actionValue: string;
      toolCallID: string;
      title: string;
      detail: string;
      state: "approved" | "denied" | "pending";
    }
  | { kind: "error"; text: string };

export class SessionEventView extends Widget {
  private readonly rendererDisposables = this._register(new DisposableStore());
  private readonly _onDidConfirmToolCall = this._register(
    new Emitter<{ approved: boolean; value: string }>(),
  );
  readonly onDidConfirmToolCall = this._onDidConfirmToolCall.event;

  constructor(
    root: HTMLElement,
    private readonly event: SessionEvent,
    private readonly registry: ISessionEventRendererRegistry,
  ) {
    super(root);
    const descriptor = this.registry.rendererFor(this.event.kind);
    const renderer = descriptor?.factory(this.root, this.event, {
      emitConfirmToolCall: (action) => this._onDidConfirmToolCall.fire(action),
    });
    if (renderer) this.rendererDisposables.add(renderer);
  }
}
