import { sessionIdentityKey } from "./active-session";
import type { IAHPActionContributionRegistry } from "./ahp-action-contribution-registry";
import {
  chatSnapshotEvents,
  objectValue,
  stringValue,
} from "./ahp-action-utils";

export function registerChatAHPActionContributions(
  registry: IAHPActionContributionRegistry,
) {
  return [
    registry.register({
      factory: ({
        chatSessionService,
        identityForChat,
        messages,
        update,
        workspaceID,
      }) => {
        const identity = identityForChat(workspaceID, update.channel);
        if (!identity) return;
        const state = objectValue(update.action.state);
        messages[sessionIdentityKey(identity)] = chatSnapshotEvents(
          state,
          identity.workspaceID,
          update.channel,
        );
        const activeTurn = objectValue(state.activeTurn);
        chatSessionService.setActiveTurn(
          identity,
          stringValue(activeTurn.id) || undefined,
        );
        const draft = objectValue(state.draft);
        if (Object.keys(draft).length === 0) return;
        const model = objectValue(draft.model);
        const agent = objectValue(draft.agent);
        chatSessionService.update(identity, {
          agent: stringValue(agent.uri) || "copilot",
          draft: stringValue(draft.text),
          model: stringValue(model.id),
        });
      },
      id: "chat.snapshot",
      type: "chat/snapshot",
    }),
    registry.register({
      factory: ({
        chatSessionService,
        identityForChat,
        messages,
        update,
        workspaceID,
      }) => {
        const identity = identityForChat(workspaceID, update.channel);
        if (!identity) return;
        chatSessionService.setActiveTurn(
          identity,
          stringValue(update.action.turnId) || undefined,
        );
        const message = objectValue(update.action.message);
        const text = stringValue(message.text);
        if (!text) return;
        const events = messages[sessionIdentityKey(identity)] ?? [];
        events.push({ kind: "message", role: "user", text });
        messages[sessionIdentityKey(identity)] = events;
      },
      id: "chat.turnStarted",
      type: "chat/turnStarted",
    }),
    registry.register({
      factory: ({ identityForChat, messages, update, workspaceID }) => {
        const identity = identityForChat(workspaceID, update.channel);
        if (!identity || typeof update.action.content !== "string") return;
        const key = sessionIdentityKey(identity);
        const events = messages[key] ?? [];
        const previous = events.at(-1);
        if (previous?.kind === "message" && previous.role === "agent")
          previous.text += update.action.content;
        else
          events.push({
            kind: "message",
            role: "agent",
            text: update.action.content,
          });
        messages[key] = events;
      },
      id: "chat.delta",
      type: "chat/delta",
    }),
    ...toolHandlers(registry),
    registry.register({
      factory: ({
        chatSessionService,
        identityForChat,
        messages,
        update,
        workspaceID,
      }) => {
        const identity = identityForChat(workspaceID, update.channel);
        if (!identity) return;
        const key = sessionIdentityKey(identity);
        const events = messages[key] ?? [];
        events.push({
          kind: "error",
          text: JSON.stringify(update.action.error),
        });
        messages[key] = events;
        chatSessionService.setActiveTurn(identity);
      },
      id: "chat.error",
      type: "chat/error",
    }),
    ...["chat/turnComplete", "chat/turnCancelled"].map((type) =>
      registry.register({
        factory: ({
          chatSessionService,
          identityForChat,
          update,
          workspaceID,
        }) => {
          const identity = identityForChat(workspaceID, update.channel);
          if (identity) chatSessionService.setActiveTurn(identity);
        },
        id: type.replace("/", "."),
        type,
      }),
    ),
  ];
}

function toolHandlers(registry: IAHPActionContributionRegistry) {
  return [
    registry.register({
      factory: ({ applyToolCall, identityForChat, update, workspaceID }) => {
        const identity = identityForChat(workspaceID, update.channel);
        if (identity) applyToolCall(identity, update, "streaming");
      },
      id: "chat.toolCallStart",
      type: "chat/toolCallStart",
    }),
    registry.register({
      factory: ({
        applyToolApproval,
        applyToolCall,
        attachmentService,
        chatSessionService,
        identityForChat,
        update,
        workspaceID,
      }) => {
        const identity = identityForChat(workspaceID, update.channel);
        if (!identity) return;
        applyToolCall(identity, update, "pending-confirmation");
        applyToolApproval(identity, update, "pending");
        if (chatSessionService.composition(identity).approvalMode !== "allow")
          return;
        attachmentService
          .attached(workspaceID)
          ?.confirmToolCall(
            update.channel,
            stringValue(update.action.turnId),
            stringValue(update.action.toolCallId),
            true,
          );
      },
      id: "chat.toolCallReady",
      type: "chat/toolCallReady",
    }),
    registry.register({
      factory: ({
        applyToolApproval,
        applyToolCall,
        identityForChat,
        update,
        workspaceID,
      }) => {
        const identity = identityForChat(workspaceID, update.channel);
        if (!identity) return;
        const approved = update.action.approved === true;
        applyToolApproval(identity, update, approved ? "approved" : "denied");
        applyToolCall(identity, update, approved ? "running" : "cancelled");
      },
      id: "chat.toolCallConfirmed",
      type: "chat/toolCallConfirmed",
    }),
    registry.register({
      factory: ({ applyToolCall, identityForChat, update, workspaceID }) => {
        const identity = identityForChat(workspaceID, update.channel);
        if (identity) applyToolCall(identity, update, "completed");
      },
      id: "chat.toolCallComplete",
      type: "chat/toolCallComplete",
    }),
  ];
}
