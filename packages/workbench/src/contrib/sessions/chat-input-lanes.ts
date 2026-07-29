import { Disposable, ScrollView, createElement } from "@zaw/ui";
import type { ChatEvent } from "../../services/chat-events";
import type { SessionTodo } from "../../services/session-todos";
import { AgentComposer } from "./agent-composer";
import { ConversationItemRenderer } from "./conversation-transcript";
import type { SessionEventRenderOptions } from "./session-event-renderer";

/** Session-bound composer specialization with the same stable editor contract. */
export class ActiveSessionComposer extends AgentComposer {}

/** Compact session plan rendered immediately above the active composer. */
export class SessionTodoList extends Disposable {
  readonly element = createElement("section", {
    ariaLabel: "Session plan",
    className: "agent-composer-todos",
  });
  private readonly header = createElement("button", {
    ariaLabel: "Collapse session plan",
    className: "agent-composer-todos-header",
  }) as HTMLButtonElement;
  private readonly twisty = createElement("span", {
    className: "codicon codicon-chevron-down",
  });
  private readonly title = createElement("span", {
    className: "agent-composer-todos-title",
  });
  private readonly list = createElement("div", {
    className: "agent-composer-todos-list",
  });
  private readonly listContent = createElement("div", {
    className: "agent-composer-todos-list-content",
    role: "list",
  });
  private collapsed = false;

  constructor() {
    super();
    this.header.type = "button";
    this.header.setAttribute("aria-expanded", "true");
    this.header.append(
      this.twisty,
      createElement("span", { className: "codicon codicon-checklist" }),
      this.title,
    );
    this.header.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      this.list.hidden = this.collapsed;
      this.twisty.className = `codicon codicon-chevron-${this.collapsed ? "right" : "down"}`;
      this.header.setAttribute("aria-expanded", String(!this.collapsed));
      this.header.setAttribute(
        "aria-label",
        `${this.collapsed ? "Expand" : "Collapse"} session plan`,
      );
    });
    this.list.append(this.listContent);
    this.element.append(this.header, this.list);
    this._register(ScrollView.attach(this.list, { horizontal: false }));
    this.element.hidden = true;
  }

  update(items: readonly SessionTodo[]): void {
    const completed = items.filter(
      (item) => item.status === "completed",
    ).length;
    this.title.textContent = `Plan (${completed}/${items.length})`;
    this.listContent.replaceChildren(...items.map((item) => todoRow(item)));
    this.element.hidden = items.length === 0;
  }
}

function todoRow(item: SessionTodo): HTMLElement {
  const row = createElement("div", {
    ariaLabel: `${item.title}, ${todoStatusLabel(item.status)}`,
    className: "agent-composer-todo",
    role: "listitem",
  });
  row.dataset.status = item.status;
  row.append(
    createElement("span", {
      className: `agent-composer-todo-status codicon codicon-${todoStatusIcon(item.status)}`,
    }),
    createElement("span", {
      className: "agent-composer-todo-title",
      textContent: item.title,
    }),
  );
  return row;
}

function todoStatusIcon(status: SessionTodo["status"]): string {
  if (status === "completed") return "pass";
  if (status === "in_progress") return "record";
  return "circle-outline";
}

function todoStatusLabel(status: SessionTodo["status"]): string {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "in progress";
  return "pending";
}

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
