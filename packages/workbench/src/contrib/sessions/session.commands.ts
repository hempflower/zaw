import type { IDisposable } from "@zaw/ui";
import type { ICommandRegistry } from "../../platform/commands/commands";
import { IActiveSessionService } from "../../services/active-session";
import { IChatSessionService } from "../../services/chat-session";
import type { ChatComposition } from "../../services/chat-session";
import { IWorkspaceService } from "../workspace/workspace-service";
import { ISessionService } from "./session-service";
import { ISessionCatalogService } from "./session-catalog-service";
import type { ComposerActionContext } from "./agent-composer";

export function registerSessionCommands(
  commands: ICommandRegistry,
): IDisposable[] {
  return [
    commands.registerCommand(
      "zaw.session.new",
      (accessor) =>
        accessor.get<IActiveSessionService>(IActiveSessionService).clear(),
      { category: "Session" },
    ),
    commands.registerCommand(
      "zaw.session.create",
      async (accessor, title = "New session", initialInput) => {
        const workspace =
          accessor.get<IWorkspaceService>(
            IWorkspaceService,
          ).selectedWorkspaceID;
        if (!workspace) return;
        const service = accessor.get<ISessionService>(ISessionService);
        const identity = await service.create(
          workspace,
          typeof title === "string" ? title : "New session",
          isInitialComposition(initialInput) ? initialInput.agent : undefined,
        );
        if (isInitialComposition(initialInput)) {
          const chat = accessor.get<IChatSessionService>(IChatSessionService);
          chat.update(identity, initialInput);
          if (initialInput.draft.trim() || initialInput.attachments.length > 0)
            await service.send(identity);
        }
      },
      {
        category: "Session",
        validate: (title, initialInput) =>
          (title === undefined || typeof title === "string") &&
          (initialInput === undefined || isInitialComposition(initialInput)),
      },
    ),
    commands.registerCommand<[SessionIdentity]>(
      "zaw.session.open",
      async (accessor, identity) => {
        accessor
          .get<IActiveSessionService>(IActiveSessionService)
          .select(identity);
        await accessor
          .get<IWorkspaceService>(IWorkspaceService)
          .select(identity.workspaceID, identity.resource);
        await accessor.get<ISessionService>(ISessionService).attach(identity);
      },
      { category: "Session", validate: isSessionIdentity },
    ),
    commands.registerCommand(
      "zaw.session.send",
      async (accessor) => {
        const active = accessor
          .get<IActiveSessionService>(IActiveSessionService)
          .current();
        if (active)
          await accessor.get<ISessionService>(ISessionService).send(active);
      },
      { category: "Session" },
    ),
    commands.registerCommand(
      "zaw.session.cancel",
      async (accessor) => {
        const active = accessor
          .get<IActiveSessionService>(IActiveSessionService)
          .current();
        if (active)
          await accessor.get<ISessionService>(ISessionService).cancel(active);
      },
      { category: "Session" },
    ),
    commands.registerCommand<[string, string, boolean]>(
      "zaw.session.confirmToolCall",
      (accessor, chat, toolCallID, approved) => {
        const active = accessor
          .get<IActiveSessionService>(IActiveSessionService)
          .current();
        if (!active) return;
        accessor
          .get<ISessionService>(ISessionService)
          .confirmToolCall(active, chat, toolCallID, approved);
      },
      {
        category: "Session",
        validate: (chat, toolCallID, approved) =>
          typeof chat === "string" &&
          typeof toolCallID === "string" &&
          typeof approved === "boolean",
      },
    ),
    commands.registerCommand<[SessionActionTarget]>(
      "zaw.session.togglePinned",
      (accessor, target) => {
        const catalog = accessor.get<ISessionCatalogService>(
          ISessionCatalogService,
        );
        for (const identity of sessionTargets(target))
          catalog.togglePinned(identity);
      },
      { category: "Session", validate: isSessionActionTarget },
    ),
    commands.registerCommand<[SessionActionTarget]>(
      "zaw.session.toggleArchived",
      (accessor, target) => {
        const catalog = accessor.get<ISessionCatalogService>(
          ISessionCatalogService,
        );
        for (const identity of sessionTargets(target))
          catalog.toggleArchived(identity);
      },
      { category: "Session", validate: isSessionActionTarget },
    ),
    commands.registerCommand<[SessionActionTarget, boolean?]>(
      "zaw.session.markRead",
      (accessor, target, read = true) => {
        const catalog = accessor.get<ISessionCatalogService>(
          ISessionCatalogService,
        );
        for (const identity of sessionTargets(target))
          catalog.markRead(identity, read);
      },
      {
        category: "Session",
        validate: (target, read) =>
          isSessionActionTarget(target) &&
          (read === undefined || typeof read === "boolean"),
      },
    ),
    commands.registerCommand(
      "zaw.session.filter",
      (accessor) =>
        accessor
          .get<ISessionCatalogService>(ISessionCatalogService)
          .requestFilter(),
      { category: "Session" },
    ),
    commands.registerCommand<[ComposerActionContext]>(
      "zaw.composer.attach",
      (_accessor, context) => context.attach(),
      { category: "Chat", validate: isComposerActionContext },
    ),
    commands.registerCommand<[ComposerActionContext, string]>(
      "zaw.composer.selectMode",
      (_accessor, context, value) =>
        context.selectMode(value as "agent" | "ask"),
      {
        category: "Chat",
        validate: (context, value) =>
          isComposerActionContext(context) &&
          (value === "agent" || value === "ask"),
      },
    ),
    commands.registerCommand<[ComposerActionContext, string]>(
      "zaw.composer.selectModel",
      (_accessor, context, value) => context.selectModel(value),
      {
        category: "Chat",
        validate: (context, value) =>
          isComposerActionContext(context) && typeof value === "string",
      },
    ),
    commands.registerCommand<[ComposerActionContext, string]>(
      "zaw.composer.selectReasoningEffort",
      (_accessor, context, value) => context.selectReasoningEffort(value),
      {
        category: "Chat",
        validate: (context, value) =>
          isComposerActionContext(context) && typeof value === "string",
      },
    ),
    commands.registerCommand<[ComposerActionContext]>(
      "zaw.composer.submit",
      (_accessor, context) => context.submit(),
      { category: "Chat", validate: isComposerActionContext },
    ),
  ];
}

type SessionIdentity = { resource: string; workspaceID: string };
export type SessionActionContext = {
  session: SessionIdentity;
  sessions: SessionIdentity[];
};
type SessionActionTarget = SessionIdentity | SessionActionContext;

function sessionTargets(target: SessionActionTarget): SessionIdentity[] {
  return "sessions" in target ? target.sessions : [target];
}

function isSessionActionTarget(value: unknown): value is SessionActionTarget {
  if (isSessionIdentity(value)) return true;
  if (!value || typeof value !== "object") return false;
  const context = value as Record<string, unknown>;
  return (
    isSessionIdentity(context.session) &&
    Array.isArray(context.sessions) &&
    context.sessions.length > 0 &&
    context.sessions.every(isSessionIdentity)
  );
}

function isSessionIdentity(value: unknown): value is SessionIdentity {
  if (!value || typeof value !== "object") return false;
  const identity = value as Record<string, unknown>;
  return (
    typeof identity.resource === "string" &&
    typeof identity.workspaceID === "string"
  );
}

function isInitialComposition(value: unknown): value is ChatComposition {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.draft === "string" &&
    typeof input.model === "string" &&
    typeof input.reasoningEffort === "string" &&
    typeof input.agent === "string" &&
    Array.isArray(input.attachments) &&
    ["allow", "ask", "autopilot"].includes(String(input.approvalMode))
  );
}

function isComposerActionContext(
  value: unknown,
): value is ComposerActionContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Record<string, unknown>;
  return (
    typeof context.attach === "function" &&
    typeof context.selectModel === "function" &&
    typeof context.selectReasoningEffort === "function" &&
    typeof context.submit === "function"
  );
}
