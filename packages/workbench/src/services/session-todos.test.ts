import { describe, expect, it, vi } from "vitest";
import { SessionTodoService } from "./session-todos";

const identity = {
  workspaceID: "workspace-one",
  resource: "ahp-session:/one",
};

describe("SessionTodoService", () => {
  it("projects zaw_todos metadata without persistence", () => {
    const service = new SessionTodoService();
    const changed = vi.fn();
    service.onDidChange(changed);

    service.replaceFromMeta(identity, {
      unrelated: { kept: true },
      zaw_todos: {
        version: 1,
        items: [
          { id: "one", title: "Inspect events", status: "in_progress" },
          { id: "two", title: "Render plan", status: "pending" },
        ],
      },
    });

    expect(service.items(identity)).toEqual([
      { id: "one", title: "Inspect events", status: "in_progress" },
      { id: "two", title: "Render plan", status: "pending" },
    ]);
    expect(changed).toHaveBeenCalledOnce();
  });

  it("clears the projection when a replacement meta omits zaw_todos", () => {
    const service = new SessionTodoService();
    service.replaceFromMeta(identity, {
      zaw_todos: {
        version: 1,
        items: [{ id: "one", title: "Done", status: "completed" }],
      },
    });

    service.replaceFromMeta(identity, { unrelated: true });

    expect(service.items(identity)).toEqual([]);
  });

  it("ignores malformed todo state as an empty projection", () => {
    const service = new SessionTodoService();
    service.replaceFromMeta(identity, {
      zaw_todos: {
        version: 1,
        items: [{ id: "one", title: "Invalid", status: "blocked" }],
      },
    });

    expect(service.items(identity)).toEqual([]);
  });
});
