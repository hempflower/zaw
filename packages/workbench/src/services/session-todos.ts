import { Disposable, Emitter, type Event } from "@zaw/ui";
import { injectable } from "inversify";
import type { SessionIdentity } from "./active-session";
import { sessionIdentityKey } from "./active-session";

export const ISessionTodoService = Symbol.for("ISessionTodoService");

export type SessionTodo = Readonly<{
  id: string;
  status: "pending" | "in_progress" | "completed";
  title: string;
}>;

export interface ISessionTodoService {
  readonly onDidChange: Event<SessionIdentity>;
  items(identity: SessionIdentity): readonly SessionTodo[];
  replaceFromMeta(identity: SessionIdentity, meta: unknown): void;
}

@injectable()
export class SessionTodoService
  extends Disposable
  implements ISessionTodoService
{
  private readonly values = new Map<string, readonly SessionTodo[]>();
  private readonly emitter = this._register(new Emitter<SessionIdentity>());
  readonly onDidChange = this.emitter.event;

  items(identity: SessionIdentity): readonly SessionTodo[] {
    return this.values.get(sessionIdentityKey(identity)) ?? [];
  }

  replaceFromMeta(identity: SessionIdentity, meta: unknown): void {
    const items = parseTodos(meta);
    const key = sessionIdentityKey(identity);
    if (sameTodos(this.values.get(key) ?? [], items)) return;
    this.values.set(key, items);
    this.emitter.fire(identity);
  }
}

function parseTodos(meta: unknown): SessionTodo[] {
  const metadata = recordValue(meta);
  const state = recordValue(metadata?.zaw_todos);
  if (state?.version !== 1 || !Array.isArray(state.items)) return [];
  const result: SessionTodo[] = [];
  for (const value of state.items) {
    const item = recordValue(value);
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.title !== "string" ||
      (item.status !== "pending" &&
        item.status !== "in_progress" &&
        item.status !== "completed")
    )
      return [];
    result.push({ id: item.id, status: item.status, title: item.title });
  }
  return result;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function sameTodos(
  left: readonly SessionTodo[],
  right: readonly SessionTodo[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.id === right[index]?.id &&
        item.title === right[index]?.title &&
        item.status === right[index]?.status,
    )
  );
}
