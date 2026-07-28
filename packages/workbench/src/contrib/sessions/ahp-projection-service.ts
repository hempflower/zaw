import { inject, injectable } from "inversify";
import type { AHPAction } from "../../services/agent-host";
import type { SessionIdentity } from "../../services/active-session";
import type { ChatEvent } from "../../services/chat-events";
import { IChatSessionService } from "../../services/chat-session";
import { IWorkspaceAttachmentService } from "../../services/workspace-attachment";
import { IWorkspaceResourceService } from "../workspace/workspace-resource-service";
import { ITerminalService } from "../terminal/terminal-service";
import type { WorkspaceChange } from "../workspace/workspace-resource-service";

export const IAHPProjectionService = Symbol.for("IAHPProjectionService");
export interface IAHPProjectionService {
  project(workspaceID: string, action: AHPAction): void;
}

/** Adapts protocol notifications into domain-service state; it never touches DOM. */
@injectable()
export class AHPProjectionService implements IAHPProjectionService {
  private readonly activeTurns = new Map<string, string>();
  private readonly responseSegments = new Map<string, number>();

  constructor(
    @inject(ITerminalService) private readonly terminals: ITerminalService,
    @inject(IWorkspaceResourceService)
    private readonly resources: IWorkspaceResourceService,
    @inject(IChatSessionService) private readonly chat: IChatSessionService,
    @inject(IWorkspaceAttachmentService)
    private readonly attachments: IWorkspaceAttachmentService,
  ) {}
  project(workspaceID: string, action: AHPAction): void {
    if (
      action.action.type === "terminal/data" &&
      typeof action.action.data === "string"
    ) {
      this.terminals.appendOutput(action.channel, action.action.data);
    }
    if (
      action.action.type === "changeset/contentChanged" &&
      Array.isArray(action.action.files)
    ) {
      this.resources.replaceChanges(
        workspaceID,
        action.channel,
        toWorkspaceChanges(action.action.files),
      );
    }
    const session = this.attachments
      .attached(workspaceID)
      ?.sessionForChat(action.channel);
    if (!session) return;
    const identity = { workspaceID, resource: session };
    if (action.action.type === "chat/snapshot") {
      this.projectChatSnapshot(
        identity,
        action.channel,
        recordValue(action.action.state),
      );
      return;
    }
    if (
      action.action.type === "chat/delta" &&
      typeof action.action.content === "string"
    ) {
      const partID = stringValue(action.action.partId);
      if (partID)
        this.chat.appendMessageDelta(
          identity,
          this.scopedPartID(workspaceID, action.channel, partID),
          action.action.content,
        );
    }
    if (action.action.type === "chat/responsePart") {
      const part = recordValue(action.action.part);
      if (part?.kind === "markdown") {
        const partID = stringValue(part.id);
        if (partID)
          this.chat.appendMessageDelta(
            identity,
            this.scopedPartID(workspaceID, action.channel, partID),
            stringValue(part.content),
          );
      }
    }
    if (
      action.action.type === "chat/turnStarted" &&
      typeof action.action.turnId === "string"
    ) {
      const turnID = action.action.turnId;
      const key = this.turnKey(workspaceID, action.channel);
      this.activeTurns.set(key, turnID);
      this.responseSegments.set(key, 0);
      const message = recordValue(action.action.message);
      const text = stringValue(message?.text);
      if (text)
        this.chat.appendEvent(identity, {
          id: `${turnID}:user`,
          kind: "message",
          role: "user",
          text,
        });
      this.chat.setActiveTurn(identity, action.action.turnId);
    }
    if (
      action.action.type === "chat/turnComplete" ||
      action.action.type === "chat/turnCancelled"
    ) {
      const key = this.turnKey(workspaceID, action.channel);
      this.activeTurns.delete(key);
      this.responseSegments.delete(key);
      this.chat.setActiveTurn(identity);
    }
    if (action.action.type === "chat/error") {
      const error = recordValue(action.action.error);
      this.chat.appendEvent(identity, {
        kind: "error",
        text:
          stringValue(error?.message) ||
          stringValue(action.action.error) ||
          JSON.stringify(action.action.error),
      });
      this.chat.setActiveTurn(identity);
    }
    if (action.action.type === "chat/toolCallStart")
      this.bumpResponseSegment(workspaceID, action.channel);
    this.projectToolAction(identity, action.channel, action.action);
  }

  private turnKey(workspaceID: string, channel: string): string {
    return `${workspaceID}\u0000${channel}`;
  }

  private scopedPartID(
    workspaceID: string,
    channel: string,
    partID: string,
  ): string {
    const turnID = this.activeTurns.get(this.turnKey(workspaceID, channel));
    const segment = this.responseSegments.get(
      this.turnKey(workspaceID, channel),
    );
    return turnID
      ? `${turnID}:${partID}${segment ? `:segment-${segment}` : ""}`
      : partID;
  }

  private bumpResponseSegment(workspaceID: string, channel: string): void {
    const key = this.turnKey(workspaceID, channel);
    this.responseSegments.set(key, (this.responseSegments.get(key) ?? 0) + 1);
  }

  private projectChatSnapshot(
    identity: SessionIdentity,
    channel: string,
    state: Record<string, unknown> | undefined,
  ): void {
    if (!state) return;
    const events: ChatEvent[] = [];
    const turns = Array.isArray(state.turns) ? state.turns : [];
    for (const turnValue of turns) {
      const turn = recordValue(turnValue);
      if (turn) events.push(...eventsForTurn(turn, channel));
    }
    const activeTurn = recordValue(state.activeTurn);
    if (activeTurn) {
      const turnID = stringValue(activeTurn.id);
      events.push(...eventsForTurn(activeTurn, channel));
      if (turnID)
        this.activeTurns.set(
          this.turnKey(identity.workspaceID, channel),
          turnID,
        );
      this.chat.setActiveTurn(identity, turnID || undefined);
    } else {
      const key = this.turnKey(identity.workspaceID, channel);
      this.activeTurns.delete(key);
      this.responseSegments.delete(key);
      this.chat.setActiveTurn(identity);
    }
    this.chat.replaceEvents(identity, events);
    const draft = recordValue(state.draft);
    if (draft) {
      this.chat.update(identity, {
        draft: stringValue(draft.text),
        model: selectionID(draft.model),
        agent: selectionID(draft.agent),
      });
    }
  }

  private projectToolAction(
    identity: SessionIdentity,
    channel: string,
    action: Record<string, unknown>,
  ): void {
    const toolCallID = stringValue(action.toolCallId);
    if (!toolCallID) return;
    const previous = this.chat
      .events(identity)
      .find(
        (event): event is ToolEvent =>
          isToolEvent(event) && event.toolCallID === toolCallID,
      );
    const previousTitle = previous?.title ?? "Tool call";
    const previousSummary = previous?.summary ?? "";
    const previousDetail = previous?.detail ?? "";
    let event: Extract<ChatEvent, { kind: "approval" | "tool" }> | undefined;
    if (action.type === "chat/toolCallStart") {
      event = {
        detail: displayText(action.intention),
        kind: "tool",
        state: "streaming",
        summary: displayText(action.intention),
        title: stringValue(action.displayName) || stringValue(action.toolName),
        toolCallID,
      };
    } else if (action.type === "chat/toolCallDelta") {
      event = {
        detail: `${previousDetail}${stringValue(action.content)}`,
        kind: "tool",
        state: "streaming",
        summary: previousSummary,
        title: previousTitle,
        toolCallID,
      };
    } else if (action.type === "chat/toolCallReady") {
      const detail = toolInvocationDetail(
        stringValue(action.toolInput),
        displayText(action.invocationMessage),
        previousDetail,
      );
      const summary =
        toolCallSummary(previousTitle, stringValue(action.toolInput)) ||
        previousSummary;
      if (typeof action.confirmed === "string") {
        event = {
          detail,
          kind: "tool",
          state: "running",
          summary,
          title: previousTitle,
          toolCallID,
        };
      } else {
        event = {
          actionValue: channel,
          detail,
          kind: "approval",
          state: "pending",
          summary,
          title: displayText(action.confirmationTitle) || previousTitle,
          toolCallID,
        };
      }
    } else if (action.type === "chat/toolCallConfirmed") {
      event = {
        actionValue: channel,
        detail: previousDetail,
        kind: "approval",
        state: action.approved === true ? "approved" : "denied",
        summary: previousSummary,
        title: previousTitle,
        toolCallID,
      };
    } else if (action.type === "chat/toolCallComplete") {
      const result = recordValue(action.result);
      event = {
        detail: toolResultDetail(result) || previousDetail,
        kind: "tool",
        state: result?.success === false ? "failed" : "completed",
        summary: previousSummary,
        title: previousTitle,
        toolCallID,
      };
    } else if (action.type === "chat/toolCallContentChanged") {
      event = {
        detail: JSON.stringify(action.content, null, 2),
        kind: "tool",
        state: "running",
        summary: previousSummary,
        title: previousTitle,
        toolCallID,
      };
    }
    if (event) this.upsertToolEvent(identity, event);
  }

  private upsertToolEvent(
    identity: SessionIdentity,
    event: Extract<ChatEvent, { kind: "approval" | "tool" }>,
  ): void {
    const events = [...this.chat.events(identity)];
    const index = events.findIndex(
      (candidate) =>
        (candidate.kind === "tool" || candidate.kind === "approval") &&
        candidate.toolCallID === event.toolCallID,
    );
    if (index < 0) events.push(event);
    else events[index] = event;
    this.chat.replaceEvents(identity, events);
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function displayText(value: unknown): string {
  if (typeof value === "string") return value;
  return stringValue(recordValue(value)?.markdown);
}

function toolInvocationDetail(...candidates: string[]): string {
  for (const candidate of candidates) {
    const value = candidate.trim();
    if (!value) continue;
    const permission = permissionRequestDetail(value);
    if (permission) return permission;
    if (!looksLikeJSONObject(value)) return value;
  }
  return "This action requires approval.";
}

function permissionRequestDetail(value: string): string {
  if (!looksLikeJSONObject(value)) return "";
  try {
    const request = recordValue(JSON.parse(value));
    if (!request) return "";
    const command =
      stringValue(request.fullCommandText) ||
      stringValue(request.command) ||
      firstCommandIdentifier(request.commands);
    const intention =
      stringValue(request.intention) || stringValue(request.description);
    const path = stringValue(request.path) || stringValue(request.filePath);
    const url = stringValue(request.url);
    const lines = [
      command ? `$ ${command}` : "",
      intention,
      !command && path ? path : "",
      !command && !path ? url : "",
    ].filter((line, index, lines) => line && lines.indexOf(line) === index);
    if (lines.length > 0) return lines.join("\n");
    const kind = stringValue(request.kind);
    return kind ? `${kind} requires approval.` : "";
  } catch {
    return "";
  }
}

function looksLikeJSONObject(value: string): boolean {
  return value.startsWith("{") && value.endsWith("}");
}

function firstCommandIdentifier(value: unknown): string {
  if (!Array.isArray(value)) return "";
  for (const command of value) {
    const identifier = stringValue(recordValue(command)?.identifier);
    if (identifier) return identifier;
  }
  return "";
}

function toolResultDetail(result: Record<string, unknown> | undefined): string {
  if (!result) return "";
  const failure = errorMessage(result.error);
  const content = toolResultContent(result.content);
  const pastTense = displayText(result.pastTenseMessage);
  return result.success === false
    ? failure || content || pastTense
    : pastTense || content || failure;
}

function errorMessage(value: unknown): string {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "";
    try {
      return errorMessage(JSON.parse(text)) || text;
    } catch {
      return text;
    }
  }
  const error = recordValue(value);
  if (!error) return "";
  return (
    stringValue(error.message) ||
    stringValue(error.error) ||
    stringValue(recordValue(error.cause)?.message)
  );
}

function toolResultContent(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const content = recordValue(entry);
      return stringValue(content?.text) || stringValue(content?.content);
    })
    .filter(Boolean)
    .join("\n");
}

function toolCallSummary(toolName: string, rawInput: string): string {
  const normalized = toolName.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
  const input = parseToolInput(rawInput);
  if (!input) {
    return /bash|shell|terminal|command|execute|run/.test(normalized)
      ? rawInput.trim()
      : "";
  }
  const command = firstString(input, [
    "command",
    "fullCommandText",
    "cmd",
    "script",
  ]);
  if (command && /bash|shell|terminal|command|execute|run/.test(normalized))
    return command;

  const path = firstString(input, [
    "path",
    "filePath",
    "file_path",
    "filename",
    "targetPath",
    "target_file",
  ]);
  if (path && /edit|replace|patch|write|create|insert|file/.test(normalized)) {
    const delta = editLineDelta(input);
    return `${fileName(path)}${delta ? ` ${delta}` : ""}`;
  }
  if (path && /read|view|open|cat/.test(normalized)) return fileName(path);

  const url = firstString(input, ["url", "uri", "href"]);
  if (url && /web|fetch|http|url|browser/.test(normalized)) return url;

  const query = firstString(input, [
    "query",
    "pattern",
    "searchTerm",
    "search_term",
    "keyword",
    "keywords",
    "regex",
  ]);
  if (query && /search|grep|find|glob|keyword|web/.test(normalized))
    return query;

  return command || (path ? fileName(path) : "") || url || query;
}

function parseToolInput(value: string): Record<string, unknown> | undefined {
  const input = value.trim();
  if (!input.startsWith("{") || !input.endsWith("}")) return undefined;
  try {
    return recordValue(JSON.parse(input));
  } catch {
    return undefined;
  }
}

function firstString(
  input: Record<string, unknown>,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const strings = value.filter(
        (entry): entry is string => typeof entry === "string" && Boolean(entry),
      );
      if (strings.length > 0) return strings.join(", ");
    }
  }
  return "";
}

function editLineDelta(input: Record<string, unknown>): string {
  const before = firstString(input, [
    "old_string",
    "oldString",
    "oldText",
    "before",
  ]);
  const after = firstString(input, [
    "new_string",
    "newString",
    "newText",
    "after",
  ]);
  if (!before && !after) {
    const patch = firstString(input, ["patch", "diff"]);
    if (!patch) return "";
    const added = patch
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const removed = patch
      .split("\n")
      .filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    return formatLineDelta(added, removed);
  }
  return formatLineDelta(lineCount(after), lineCount(before));
}

function lineCount(value: string): number {
  return value ? value.split("\n").length : 0;
}

function formatLineDelta(added: number, removed: number): string {
  return [added ? `+${added}` : "", removed ? `-${removed}` : ""]
    .filter(Boolean)
    .join(" ");
}

function fileName(path: string): string {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

function selectionID(value: unknown): string {
  const selection = recordValue(value);
  return (
    stringValue(selection?.id) ||
    stringValue(selection?.identifier) ||
    stringValue(value)
  );
}

function eventsForTurn(
  turn: Record<string, unknown>,
  channel: string,
): ChatEvent[] {
  const events: ChatEvent[] = [];
  const turnID = stringValue(turn.id);
  const message = recordValue(turn.message);
  const messageText = stringValue(message?.text);
  if (messageText)
    events.push({
      id: turnID ? `${turnID}:user` : undefined,
      kind: "message",
      role: "user",
      text: messageText,
    });
  const responseParts = Array.isArray(turn.responseParts)
    ? turn.responseParts
    : [];
  let markdown = "";
  let markdownID = "";
  const flushMarkdown = () => {
    if (!markdown) return;
    events.push({
      id: markdownID || undefined,
      kind: "message",
      role: "agent",
      text: markdown,
    });
    markdown = "";
    markdownID = "";
  };
  for (const partValue of responseParts) {
    const part = recordValue(partValue);
    if (!part) continue;
    if (part.kind === "markdown") {
      const partID = stringValue(part.id);
      markdownID ||= turnID && partID ? `${turnID}:${partID}` : partID;
      markdown += stringValue(part.content);
      continue;
    }
    flushMarkdown();
    if (part.kind === "toolCall") {
      const tool = toolEventFromState(recordValue(part.toolCall), channel);
      if (tool) events.push(tool);
    } else if (part.kind === "systemNotification") {
      const text = displayText(part.content);
      if (text)
        events.push({
          kind: "notification",
          level:
            part.level === "error"
              ? "error"
              : part.level === "warning"
                ? "warning"
                : "info",
          text,
        });
    }
  }
  flushMarkdown();
  const error = recordValue(turn.error);
  const errorMessage = stringValue(error?.message);
  if (errorMessage) events.push({ kind: "error", text: errorMessage });
  return events;
}

function toolEventFromState(
  tool: Record<string, unknown> | undefined,
  channel: string,
): ToolEvent | undefined {
  if (!tool) return undefined;
  const toolCallID = stringValue(tool.toolCallId);
  if (!toolCallID) return undefined;
  const status = stringValue(tool.status) || "unknown";
  const meta = recordValue(tool._meta);
  const permissionRequest =
    toolCallID.startsWith("permission-") ||
    meta?.["zaw/permissionRequest"] === true;
  if (permissionRequest && status !== "pending-confirmation") return undefined;
  const title = stringValue(tool.displayName) || stringValue(tool.toolName);
  const result = recordValue(tool.result);
  const detail =
    status === "completed"
      ? toolResultDetail(result ?? tool)
      : toolInvocationDetail(
          stringValue(tool.toolInput),
          displayText(tool.invocationMessage),
        );
  const summary = toolCallSummary(title, stringValue(tool.toolInput));
  if (status === "pending-confirmation") {
    return {
      actionValue: channel,
      detail,
      kind: "approval",
      state: "pending",
      ...(summary ? { summary } : {}),
      title: displayText(tool.confirmationTitle) || title,
      toolCallID,
    };
  }
  if (status === "cancelled") return undefined;
  return {
    detail,
    kind: "tool",
    state:
      status === "completed" && (result ?? tool).success === false
        ? "failed"
        : status,
    title,
    summary,
    toolCallID,
  };
}

type ToolEvent = Extract<ChatEvent, { kind: "approval" | "tool" }>;

function isToolEvent(event: ChatEvent): event is ToolEvent {
  return event.kind === "tool" || event.kind === "approval";
}

function toWorkspaceChanges(files: readonly unknown[]): WorkspaceChange[] {
  return files.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id : "";
    if (!id) return [];
    return [
      {
        id,
        path: typeof value.path === "string" ? value.path : id,
        resource: typeof value.resource === "string" ? value.resource : id,
        diff: typeof value.diff === "string" ? value.diff : "",
        reviewed: value.reviewed === true,
        status: typeof value.status === "string" ? value.status : "M",
      },
    ];
  });
}
