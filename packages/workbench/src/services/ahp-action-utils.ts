import type { AHPAction } from "./agent-host";
import type { SessionEvent } from "../views/session/session-event-view";
import { sessionIdentityKey } from "./active-session";

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function stringOrMarkdown(value: unknown) {
  if (typeof value === "string") return value;
  return stringValue(objectValue(value).markdown);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function toolActionValue(target: {
  chat: string;
  toolCallID: string;
  turnID: string;
  workspaceID: string;
}) {
  return encodeURIComponent(JSON.stringify(target));
}

export function chatSnapshotEvents(
  state: Record<string, unknown>,
  workspaceID: string,
  chat: string,
): SessionEvent[] {
  const turns = Array.isArray(state.turns) ? state.turns : [];
  const activeTurn = state.activeTurn ? [state.activeTurn] : [];
  return [...turns, ...activeTurn].flatMap((rawTurn) => {
    const turn = objectValue(rawTurn);
    const message = objectValue(turn.message);
    const events: SessionEvent[] = [];
    const text = stringValue(message.text);
    if (text) events.push({ kind: "message", role: "user", text });
    const parts = Array.isArray(turn.responseParts) ? turn.responseParts : [];
    for (const rawPart of parts) {
      const part = objectValue(rawPart);
      if (part.kind === "markdown" && stringValue(part.content)) {
        events.push({
          kind: "message",
          role: "agent",
          text: stringValue(part.content),
        });
      }
      if (part.kind === "toolCall") {
        const toolCall = objectValue(part.toolCall);
        const toolCallID = stringValue(toolCall.toolCallId);
        if (!toolCallID) continue;
        events.push({
          detail:
            stringValue(toolCall.toolInput) ||
            JSON.stringify(toolCall.result ?? ""),
          kind: "tool",
          state: stringValue(toolCall.status),
          title:
            stringValue(toolCall.displayName) ||
            stringValue(toolCall.toolName) ||
            "Agent tool",
          toolCallID,
        });
        if (toolCall.status === "pending-confirmation") {
          events.push({
            actionValue: toolActionValue({
              chat,
              toolCallID,
              turnID: stringValue(turn.id),
              workspaceID,
            }),
            detail:
              stringOrMarkdown(toolCall.invocationMessage) ||
              stringValue(toolCall.toolInput),
            kind: "approval",
            state: "pending",
            title:
              stringOrMarkdown(toolCall.confirmationTitle) ||
              "Agent approval requested",
            toolCallID,
          });
        }
      }
    }
    if (turn.error)
      events.push({ kind: "error", text: JSON.stringify(turn.error) });
    return events;
  });
}

export function workspaceChangeFromAHP(value: unknown) {
  const file = objectValue(value);
  const edit = objectValue(file.edit);
  const before = objectValue(edit.before);
  const after = objectValue(edit.after);
  const resource = stringValue(after.uri) || stringValue(before.uri);
  const id = stringValue(file.id);
  if (!id || !resource) return undefined;
  return {
    id,
    path: id,
    resource,
    reviewed: file.reviewed === true,
    status:
      Object.keys(before).length === 0
        ? "A"
        : Object.keys(after).length === 0
          ? "D"
          : "M",
  };
}

export function isWorkspaceChange<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export function activeChatKey(
  context: {
    identityForChat: (
      workspaceID: string,
      chat: string,
    ) => { workspaceID: string; resource: string } | undefined;
  },
  workspaceID: string,
  update: AHPAction,
) {
  const identity = context.identityForChat(workspaceID, update.channel);
  return identity ? sessionIdentityKey(identity) : undefined;
}
