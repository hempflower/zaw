import { Disposable, createElement } from "@zaw/ui";
import type { ChatEvent } from "../../services/chat-events";
import { AgentComposer } from "./agent-composer";
import { ConversationItemRenderer } from "./conversation-transcript";
import type { SessionEventRenderOptions } from "./session-event-renderer";

/** Session-bound composer specialization with the same stable editor contract. */
export class ActiveSessionComposer extends AgentComposer {}

/** Stable host for goal banners, notifications, todos and artifacts. */
export class ComposerPersistentLane {
  readonly element = createElement("div", {
    ariaLabel: "Session status",
    className: "agent-composer-persistent-lane",
    role: "status",
  });

  private readonly renderer = new ConversationItemRenderer({});
  private rendered: readonly ChatEvent[] = [];

  update(events: readonly ChatEvent[]): void {
    const existing = Array.from(this.element.children) as HTMLElement[];
    for (let index = 0; index < events.length; index++) {
      if (!existing[index])
        this.element.append(this.renderer.render(events[index]));
      else if (
        this.rendered[index] !== events[index] &&
        !this.renderer.update(existing[index], events[index])
      )
        existing[index].replaceWith(this.renderer.render(events[index]));
    }
    for (let index = events.length; index < existing.length; index++)
      existing[index].remove();
    this.rendered = [...events];
    this.element.hidden = events.length === 0;
  }
}

/** Owns pending plan/question/tool/approval interactions above the editor. */
export class InterruptionLane extends Disposable {
  readonly element = createElement("div", {
    ariaLabel: "Pending agent interaction",
    className: "agent-composer-interruption-lane",
    role: "region",
  });
  private readonly renderer: ConversationItemRenderer;
  private rendered: readonly ChatEvent[] = [];

  constructor(options: SessionEventRenderOptions) {
    super();
    this.renderer = new ConversationItemRenderer(options);
    this.element.hidden = true;
  }

  update(events: readonly ChatEvent[]): void {
    const existing = Array.from(this.element.children) as HTMLElement[];
    for (let index = 0; index < events.length; index++) {
      if (!existing[index])
        this.element.append(this.renderer.render(events[index]));
      else if (
        this.rendered[index] !== events[index] &&
        !this.renderer.update(existing[index], events[index])
      )
        existing[index].replaceWith(this.renderer.render(events[index]));
    }
    for (let index = events.length; index < existing.length; index++)
      existing[index].remove();
    this.rendered = [...events];
    this.element.hidden = events.length === 0;
  }
}

/** Hidden until the provider supplies real follow-up suggestions. */
export class FollowupSuggestions {
  readonly element = createElement("div", {
    ariaLabel: "Suggested follow-ups",
    className: "agent-followup-suggestions",
    role: "group",
  });

  constructor() {
    this.element.hidden = true;
  }
}
