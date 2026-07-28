import { Disposable, IconActionButton, createElement } from "@zaw/ui";
import type { ChatEvent } from "../../services/chat-events";
import {
  renderSessionEvent,
  renderToolGroup,
  type SessionEventRenderOptions,
  updateSessionEvent,
  updateToolGroup,
} from "./session-event-renderer";

type ToolEvent = Extract<ChatEvent, { kind: "tool" }>;
type ConversationItem =
  | ChatEvent
  | { kind: "toolGroup"; events: readonly ToolEvent[] };

function projectConversationItems(
  events: readonly ChatEvent[],
): ConversationItem[] {
  const items: ConversationItem[] = [];
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event.kind !== "tool") {
      items.push(event);
      continue;
    }
    const tools: ToolEvent[] = [event];
    while (events[index + 1]?.kind === "tool") {
      tools.push(events[++index] as ToolEvent);
    }
    items.push(tools.length > 1 ? { kind: "toolGroup", events: tools } : event);
  }
  return items;
}

/** Owns one stable conversation item root and its incremental update contract. */
export class ConversationItemRenderer {
  constructor(private readonly options: SessionEventRenderOptions) {}

  render(item: ConversationItem): HTMLElement {
    return item.kind === "toolGroup"
      ? renderToolGroup(item.events)
      : renderSessionEvent(item, this.options);
  }

  update(element: HTMLElement, item: ConversationItem): boolean {
    if (item.kind === "toolGroup") return updateToolGroup(element, item.events);
    return updateSessionEvent(element, item);
  }
}

/** Stable transcript viewport with VS Code-style conditional scroll-to-bottom affordance. */
export class ConversationTranscript extends Disposable {
  readonly element = createElement("div", {
    ariaLabel: "Conversation",
    className: "agent-conversation-transcript",
    role: "log",
  });
  readonly content = createElement("div", {
    className: "agent-conversation-content",
  });
  readonly scrollDownHost = createElement("span", {
    className: "agent-chat-scroll-down",
  });
  private readonly renderer: ConversationItemRenderer;
  private renderedItems: readonly ConversationItem[] = [];
  private autoScroll = true;

  constructor(options: SessionEventRenderOptions = {}) {
    super();
    this.element.tabIndex = -1;
    this.renderer = new ConversationItemRenderer(options);
    const scrollDown = this._register(
      new IconActionButton(this.scrollDownHost, {
        ariaLabel: "Scroll to bottom",
        icon: "arrow-down",
      }),
    );
    this._register(scrollDown.onDidClick(() => this.scrollToBottom()));
    this.scrollDownHost.hidden = true;
    this.element.addEventListener("scroll", () => this.updateScrollState());
    this.element.append(this.content);
  }

  update(events: readonly ChatEvent[]): void {
    const items = projectConversationItems(events);
    const existing = Array.from(
      this.content.querySelectorAll<HTMLElement>(":scope > .session-event"),
    );
    const commonLength = Math.min(this.renderedItems.length, items.length);
    for (let index = 0; index < commonLength; index++) {
      if (this.renderedItems[index] === items[index]) continue;
      const element = existing[index];
      if (!element || !this.renderer.update(element, items[index])) {
        const replacement = this.renderer.render(items[index]);
        element?.replaceWith(replacement);
        existing[index] = replacement;
      }
    }
    for (let index = commonLength; index < items.length; index++)
      this.content.append(this.renderer.render(items[index]));
    for (let index = items.length; index < existing.length; index++)
      existing[index].remove();
    if (!events.length && !this.content.childElementCount) {
      this.content.append(
        createElement("p", {
          className: "agent-conversation-empty",
          textContent: "Start a conversation with your agent.",
        }),
      );
    } else {
      this.content.querySelector(".agent-conversation-empty")?.remove();
    }
    this.renderedItems = items;
    if (this.autoScroll)
      requestAnimationFrame(() => this.scrollToBottom(false));
    else this.updateScrollDownVisibility();
  }

  private updateScrollState(): void {
    this.autoScroll = this.remainingScrollDistance() < 48;
    this.updateScrollDownVisibility();
  }

  private updateScrollDownVisibility(): void {
    this.scrollDownHost.hidden =
      this.autoScroll || this.element.scrollHeight <= this.element.clientHeight;
  }

  private remainingScrollDistance(): number {
    return (
      this.element.scrollHeight -
      this.element.scrollTop -
      this.element.clientHeight
    );
  }

  private scrollToBottom(focus = true): void {
    this.element.scrollTop = this.element.scrollHeight;
    this.autoScroll = true;
    this.updateScrollDownVisibility();
    if (focus) this.element.focus({ preventScroll: true });
  }
}
