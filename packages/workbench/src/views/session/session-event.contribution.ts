import { Widget, createElement, type IDisposable } from "@zaw/ui";
import { ApprovalWidget } from "./approval-widget";
import { ToolCallWidget } from "./tool-call-widget";
import type {
  ISessionEventRendererRegistry,
  SessionEventRendererContext,
} from "./session-event-renderer-registry";
import type { SessionEvent } from "./session-event-view";

class MessageEventRenderer extends Widget {
  constructor(
    root: HTMLElement,
    event: Extract<SessionEvent, { kind: "message" }>,
  ) {
    super(root);
    this.root.replaceChildren(
      createElement("p", {
        className: `message-${event.role}`,
        textContent: event.text,
      }),
    );
  }
}

class ToolEventRenderer extends Widget {
  constructor(
    root: HTMLElement,
    event: Extract<SessionEvent, { kind: "tool" }>,
  ) {
    super(root);
    this._register(new ToolCallWidget(root, event));
  }
}

class ApprovalEventRenderer extends Widget {
  constructor(
    root: HTMLElement,
    event: Extract<SessionEvent, { kind: "approval" }>,
    context: SessionEventRendererContext,
  ) {
    super(root);
    const approval = this._register(new ApprovalWidget(root, { ...event }));
    approval.onDidConfirm(
      ({ value, approved }) => context.emitConfirmToolCall({ approved, value }),
      undefined,
      this.disposables,
    );
  }
}

class ErrorEventRenderer extends Widget {
  constructor(
    root: HTMLElement,
    event: Extract<SessionEvent, { kind: "error" }>,
  ) {
    super(root);
    const article = createElement("article", {
      className: "session-event error-event",
    });
    article.append(
      createElement("span", { className: "codicon codicon-error" }),
      document.createTextNode(event.text),
    );
    this.root.replaceChildren(article);
  }
}

export function registerBuiltinSessionEventRenderers(
  registry: ISessionEventRendererRegistry,
): IDisposable[] {
  return [
    registry.register({
      factory: (root, event) =>
        new MessageEventRenderer(
          root,
          event as Extract<SessionEvent, { kind: "message" }>,
        ),
      id: "session-event.message",
      kind: "message",
      order: 10,
    }),
    registry.register({
      factory: (root, event) =>
        new ToolEventRenderer(
          root,
          event as Extract<SessionEvent, { kind: "tool" }>,
        ),
      id: "session-event.tool",
      kind: "tool",
      order: 20,
    }),
    registry.register({
      factory: (root, event, context) =>
        new ApprovalEventRenderer(
          root,
          event as Extract<SessionEvent, { kind: "approval" }>,
          context,
        ),
      id: "session-event.approval",
      kind: "approval",
      order: 30,
    }),
    registry.register({
      factory: (root, event) =>
        new ErrorEventRenderer(
          root,
          event as Extract<SessionEvent, { kind: "error" }>,
        ),
      id: "session-event.error",
      kind: "error",
      order: 40,
    }),
  ];
}
