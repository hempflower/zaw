import { Disposable, Emitter, type Event } from "@zaw/ui";
import { inject, injectable, optional } from "inversify";
import type { SessionIdentity } from "./active-session";
import { IActiveSessionService, sessionIdentityKey } from "./active-session";
import type { ChatEvent } from "./chat-events";
import { IWorkbenchStorage } from "./workspace-ui-state";
import {
  IContextKeyService,
  type IContextKey,
} from "../platform/context-key/context-key";
import { WorkspaceContext } from "../workbench/context-keys";

export const IChatSessionService = Symbol.for("IChatSessionService");

export type ApprovalMode = "allow" | "ask" | "autopilot";

export type ChatAttachment = {
  type: "embeddedResource";
  label: string;
  data: string;
  contentType: string;
  displayKind: "document" | "image";
};

export type ChatComposition = {
  agent: string;
  mode?: "agent" | "ask" | "plan";
  approvalMode: ApprovalMode;
  attachments: ChatAttachment[];
  draft: string;
  model: string;
  reasoningEffort: string;
};

export interface IChatSessionService {
  readonly onDidChange: Event<SessionIdentity>;
  composition(identity: SessionIdentity): ChatComposition;
  events(identity: SessionIdentity): readonly ChatEvent[];
  update(
    identity: SessionIdentity,
    changes: Partial<ChatComposition>,
  ): ChatComposition;
  clearAfterSend(identity: SessionIdentity): void;
  activeTurn(identity: SessionIdentity): string | undefined;
  setActiveTurn(identity: SessionIdentity, turnID?: string): void;
  appendEvent(identity: SessionIdentity, event: ChatEvent): void;
  appendMessageDelta(
    identity: SessionIdentity,
    partID: string,
    content: string,
  ): void;
  replaceEvents(identity: SessionIdentity, events: readonly ChatEvent[]): void;
}

const emptyComposition = (): ChatComposition => ({
  agent: "",
  mode: "agent",
  approvalMode: "ask",
  attachments: [],
  draft: "",
  model: "",
  reasoningEffort: "",
});

@injectable()
export class ChatSessionService
  extends Disposable
  implements IChatSessionService
{
  private readonly compositions = new Map<string, ChatComposition>();
  private readonly activeTurns = new Map<string, string>();
  private readonly messages = new Map<string, ChatEvent[]>();
  private readonly emitter = this._register(new Emitter<SessionIdentity>());
  private readonly approvalContext: IContextKey<boolean> | undefined;
  private readonly turnContext: IContextKey<boolean> | undefined;
  readonly onDidChange = this.emitter.event;

  constructor(
    @inject(IWorkbenchStorage) private readonly persistence?: Storage,
    @optional() @inject(IContextKeyService) contextKeys?: IContextKeyService,
    @optional()
    @inject(IActiveSessionService)
    private readonly active?: IActiveSessionService,
  ) {
    super();
    this.approvalContext =
      contextKeys && WorkspaceContext.toolApprovalPending.bindTo(contextKeys);
    this.turnContext =
      contextKeys && WorkspaceContext.turnActive.bindTo(contextKeys);
    if (this.active) {
      this._register(this.active.onDidChange(() => this.syncContext()));
    }
  }

  composition(identity: SessionIdentity): ChatComposition {
    const key = sessionIdentityKey(identity);
    const existing = this.compositions.get(key);
    if (existing) return existing;
    const restored = this.restore(key);
    this.compositions.set(key, restored);
    return restored;
  }

  update(
    identity: SessionIdentity,
    changes: Partial<ChatComposition>,
  ): ChatComposition {
    const key = sessionIdentityKey(identity);
    const next = { ...this.composition(identity), ...changes };
    this.compositions.set(key, next);
    this.persist(key, next);
    this.emitter.fire(identity);
    this.syncContext(identity);
    return next;
  }

  events(identity: SessionIdentity): readonly ChatEvent[] {
    return this.messages.get(sessionIdentityKey(identity)) ?? [];
  }

  clearAfterSend(identity: SessionIdentity) {
    this.update(identity, { attachments: [], draft: "" });
  }

  activeTurn(identity: SessionIdentity): string | undefined {
    return this.activeTurns.get(sessionIdentityKey(identity));
  }

  setActiveTurn(identity: SessionIdentity, turnID?: string) {
    const key = sessionIdentityKey(identity);
    if (turnID) this.activeTurns.set(key, turnID);
    else this.activeTurns.delete(key);
    this.emitter.fire(identity);
    this.syncContext(identity);
  }

  appendEvent(identity: SessionIdentity, event: ChatEvent): void {
    const key = sessionIdentityKey(identity);
    const events = [...(this.messages.get(key) ?? [])];
    const eventID = event.kind === "message" ? event.id : undefined;
    const index = eventID
      ? events.findIndex(
          (candidate) =>
            candidate.kind === "message" && candidate.id === eventID,
        )
      : -1;
    if (index >= 0) events[index] = event;
    else events.push(event);
    this.messages.set(key, events);
    this.emitter.fire(identity);
    this.syncContext(identity);
  }

  appendMessageDelta(
    identity: SessionIdentity,
    partID: string,
    content: string,
  ): void {
    const key = sessionIdentityKey(identity);
    const events = [...(this.messages.get(key) ?? [])];
    const index = events.findIndex(
      (event) =>
        event.kind === "message" &&
        event.role === "agent" &&
        event.id === partID,
    );
    if (index < 0) {
      events.push({
        id: partID,
        kind: "message",
        role: "agent",
        text: content,
      });
    } else {
      const event = events[index] as Extract<ChatEvent, { kind: "message" }>;
      events[index] = { ...event, text: `${event.text}${content}` };
    }
    this.messages.set(key, events);
    this.emitter.fire(identity);
    this.syncContext(identity);
  }

  replaceEvents(identity: SessionIdentity, events: readonly ChatEvent[]): void {
    this.messages.set(sessionIdentityKey(identity), [...events]);
    this.emitter.fire(identity);
    this.syncContext(identity);
  }

  private syncContext(changed?: SessionIdentity): void {
    const current = this.active?.current();
    if (
      !current ||
      (changed && sessionIdentityKey(changed) !== sessionIdentityKey(current))
    )
      return;
    this.turnContext?.set(Boolean(this.activeTurn(current)));
    this.approvalContext?.set(
      this.events(current).some(
        (event) => event.kind === "approval" && event.state === "pending",
      ),
    );
  }

  private restore(key: string): ChatComposition {
    try {
      const value = this.persistence?.getItem(`zaw.chat.${key}`);
      if (!value) return emptyComposition();
      const restored = JSON.parse(value) as Partial<ChatComposition>;
      return {
        ...emptyComposition(),
        agent: typeof restored.agent === "string" ? restored.agent : "",
        approvalMode:
          typeof restored.approvalMode === "string" &&
          ["allow", "ask", "autopilot"].includes(restored.approvalMode)
            ? (restored.approvalMode as ApprovalMode)
            : "ask",
        attachments: Array.isArray(restored.attachments)
          ? restored.attachments.filter(isChatAttachment)
          : [],
        draft: typeof restored.draft === "string" ? restored.draft : "",
        model: typeof restored.model === "string" ? restored.model : "",
        mode:
          restored.mode === "ask" || restored.mode === "plan"
            ? restored.mode
            : "agent",
        reasoningEffort:
          typeof restored.reasoningEffort === "string"
            ? restored.reasoningEffort
            : "",
      };
    } catch {
      return emptyComposition();
    }
  }

  private persist(key: string, composition: ChatComposition) {
    this.persistence?.setItem(
      `zaw.chat.${key}`,
      JSON.stringify({
        agent: composition.agent,
        approvalMode: composition.approvalMode,
        attachments: composition.attachments,
        draft: composition.draft,
        model: composition.model,
        mode: composition.mode ?? "agent",
      }),
    );
  }
}

function isChatAttachment(value: unknown): value is ChatAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Record<string, unknown>;
  return (
    attachment.type === "embeddedResource" &&
    typeof attachment.label === "string" &&
    typeof attachment.data === "string" &&
    typeof attachment.contentType === "string" &&
    (attachment.displayKind === "document" ||
      attachment.displayKind === "image")
  );
}
