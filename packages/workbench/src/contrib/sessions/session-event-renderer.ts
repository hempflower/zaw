import { ButtonWidget, PrimaryButtonWidget, createElement } from "@zaw/ui";
import type { ChatEvent } from "../../services/chat-events";
import { renderMarkdown } from "./markdown-renderer";

export interface SessionEventRenderOptions {
  readonly confirmToolCall?: (
    chat: string,
    toolCallID: string,
    approved: boolean,
  ) => void;
}

/** Renders one immutable chat-domain event; collection ownership stays in ChatSessionService. */
export function renderSessionEvent(
  event: ChatEvent,
  options: SessionEventRenderOptions = {},
): HTMLElement {
  if (event.kind === "message") return renderMessage(event);
  if (event.kind === "tool") return renderTool(event);
  if (event.kind === "approval") return renderApproval(event, options);
  if (event.kind === "notification")
    return createElement("div", {
      ariaLabel: `${event.level}: ${event.text}`,
      className: `session-event notification state-${event.level}`,
      role: event.level === "error" ? "alert" : "status",
      textContent: event.text,
    });
  return createElement("div", {
    ariaLabel: `Error: ${event.text}`,
    className: "session-event error",
    role: "alert",
    textContent: event.text,
  });
}

/** Updates streamable content without replacing the event root DOM node. */
export function updateSessionEvent(
  element: HTMLElement,
  event: ChatEvent,
): boolean {
  if (
    event.kind === "notification" &&
    element.matches(".session-event.notification")
  ) {
    element.className = `session-event notification state-${event.level}`;
    element.setAttribute("aria-label", `${event.level}: ${event.text}`);
    element.setAttribute("role", event.level === "error" ? "alert" : "status");
    element.textContent = event.text;
    return true;
  }
  if (event.kind !== "message" || !element.matches(".session-event.message"))
    return false;
  element.className = `session-event message ${event.role}`;
  element.setAttribute(
    "aria-label",
    `${event.role === "user" ? "You" : "Agent"}: ${event.text}`,
  );
  const content = element.querySelector<HTMLElement>(".markdown-body");
  if (content) renderMarkdown(content, event.text);
  return Boolean(content);
}

function renderMessage(
  event: Extract<ChatEvent, { kind: "message" }>,
): HTMLElement {
  const row = createElement("article", {
    ariaLabel: `${event.role === "user" ? "You" : "Agent"}: ${event.text}`,
    className: `session-event message ${event.role}`,
  });
  const content = createElement("div", { className: "markdown-body" });
  renderMarkdown(content, event.text);
  row.append(content);
  return row;
}

export function renderToolGroup(
  events: readonly Extract<ChatEvent, { kind: "tool" }>[],
): HTMLElement {
  const running = events.some((event) =>
    ["pending", "running", "streaming"].includes(event.state),
  );
  const failed = events.filter((event) => event.state === "failed").length;
  const label = running
    ? `Running ${events.length} steps`
    : `Completed ${events.length} steps${failed ? `, ${failed} failed` : ""}`;
  const root = createElement("details", {
    ariaLabel: label,
    className: `session-event tool-event-group${running ? " state-running" : ""}`,
  });
  const summary = createElement("summary");
  summary.append(
    createElement("span", {
      className: `codicon codicon-${running ? "loading" : failed ? "error" : "check"} tool-icon`,
    }),
    createElement("span", {
      className: "tool-group-title",
      textContent: label,
    }),
    createElement("span", {
      className: "codicon codicon-chevron-right tool-expando",
    }),
  );
  const items = createElement("div", { className: "tool-group-items" });
  items.append(...events.map((event) => renderTool(event)));
  root.append(summary, items);
  return root;
}

export function updateToolGroup(
  element: HTMLElement,
  events: readonly Extract<ChatEvent, { kind: "tool" }>[],
): boolean {
  if (!element.matches(".session-event.tool-event-group")) return false;
  const open = (element as HTMLDetailsElement).open;
  const replacement = renderToolGroup(events) as HTMLDetailsElement;
  element.className = replacement.className;
  element.setAttribute(
    "aria-label",
    replacement.getAttribute("aria-label") ?? "",
  );
  element.replaceChildren(...Array.from(replacement.childNodes));
  (element as HTMLDetailsElement).open = open;
  return true;
}

function renderTool(event: Extract<ChatEvent, { kind: "tool" }>): HTMLElement {
  const root = createElement("details", {
    className: `session-event tool-event state-${event.state}`,
  });
  const summary = createElement("summary", {
    ariaLabel: `${event.title}, ${event.state}`,
  });
  const toolSummary = createElement("span", {
    className: "tool-summary",
    textContent: event.summary,
  });
  toolSummary.title = event.summary ?? "";
  summary.append(
    createElement("span", {
      className: `codicon codicon-${toolStateIcon(event.state)} tool-icon`,
    }),
    createElement("span", {
      className: "tool-title",
      textContent: event.title,
    }),
    toolSummary,
    createElement("span", {
      className: "tool-state",
      textContent: event.state,
    }),
    createElement("span", {
      className: "codicon codicon-chevron-right tool-expando",
    }),
  );
  root.append(
    summary,
    createElement("div", {
      className: "tool-detail",
      textContent: event.detail,
    }),
  );
  return root;
}

function renderApproval(
  event: Extract<ChatEvent, { kind: "approval" }>,
  options: SessionEventRenderOptions,
): HTMLElement {
  const container = createElement("div", {
    ariaLabel: `Chat confirmation dialog ${event.title} ${event.detail}`,
    className: `session-event approval-event state-${event.state}`,
    role: "group",
  });
  container.tabIndex = 0;
  const title = createElement("header", {
    className: "approval-title",
  });
  title.append(
    createElement("span", {
      className: "codicon codicon-shield approval-icon",
    }),
    createElement("span", { textContent: event.title }),
  );
  const message = createElement("div", { className: "approval-message" });
  for (const line of event.detail.split("\n").filter(Boolean)) {
    if (line.startsWith("$ ")) {
      const command = createElement("div", { className: "approval-command" });
      command.append(
        createElement("span", { className: "codicon codicon-terminal" }),
        createElement("code", { textContent: line.slice(2) }),
      );
      message.append(command);
    } else {
      message.append(
        createElement("div", {
          className: "approval-description",
          textContent: line,
        }),
      );
    }
  }
  container.append(title, message);
  const footer = createElement("footer", {
    className: "approval-buttons",
  });
  if (event.state === "pending") {
    const allowHost = createElement("span");
    const denyHost = createElement("span");
    const allow = new PrimaryButtonWidget(allowHost, {
      label: `Allow ${event.title}`,
      text: "Allow",
    });
    const deny = new ButtonWidget(denyHost, {
      label: `Deny ${event.title}`,
      text: "Deny",
    });
    allow.onDidClick(() =>
      options.confirmToolCall?.(event.actionValue, event.toolCallID, true),
    );
    deny.onDidClick(() =>
      options.confirmToolCall?.(event.actionValue, event.toolCallID, false),
    );
    footer.append(allowHost, denyHost);
  } else {
    footer.append(
      createElement("span", {
        className: "approval-state",
        textContent: event.state === "approved" ? "Allowed" : "Denied",
      }),
    );
  }
  container.append(footer);
  return container;
}

function toolStateIcon(state: string): string {
  if (state === "completed" || state === "approved") return "check";
  if (state === "failed" || state === "denied") return "error";
  if (state === "running" || state === "streaming") return "loading";
  return "tools";
}
