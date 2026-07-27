import { inject, injectable } from "inversify";
import type { SessionIdentity } from "./active-session";
import { sessionIdentityKey } from "./active-session";
import { IWorkbenchStorage } from "./workspace-ui-state";

export const IChatSessionService = Symbol.for("IChatSessionService");

export type ApprovalMode = "ask" | "allow";

export type ChatAttachment = {
  type: "embeddedResource";
  label: string;
  data: string;
  contentType: string;
  displayKind: "document" | "image";
};

export type ChatComposition = {
  agent: string;
  approvalMode: ApprovalMode;
  attachments: ChatAttachment[];
  draft: string;
  model: string;
};

export interface IChatSessionService {
  composition(identity: SessionIdentity): ChatComposition;
  update(
    identity: SessionIdentity,
    changes: Partial<ChatComposition>,
  ): ChatComposition;
  clearAfterSend(identity: SessionIdentity): void;
  activeTurn(identity: SessionIdentity): string | undefined;
  setActiveTurn(identity: SessionIdentity, turnID?: string): void;
}

const emptyComposition = (): ChatComposition => ({
  agent: "copilot",
  approvalMode: "ask",
  attachments: [],
  draft: "",
  model: "",
});

@injectable()
export class ChatSessionService implements IChatSessionService {
  private readonly compositions = new Map<string, ChatComposition>();
  private readonly activeTurns = new Map<string, string>();

  constructor(
    @inject(IWorkbenchStorage) private readonly persistence?: Storage,
  ) {}

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
    return next;
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
  }

  private restore(key: string): ChatComposition {
    try {
      const value = this.persistence?.getItem(`zaw.chat.${key}`);
      if (!value) return emptyComposition();
      const restored = JSON.parse(value) as Partial<ChatComposition>;
      return {
        ...emptyComposition(),
        agent: typeof restored.agent === "string" ? restored.agent : "copilot",
        approvalMode: restored.approvalMode === "allow" ? "allow" : "ask",
        draft: typeof restored.draft === "string" ? restored.draft : "",
        model: typeof restored.model === "string" ? restored.model : "",
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
        draft: composition.draft,
        model: composition.model,
      }),
    );
  }
}
