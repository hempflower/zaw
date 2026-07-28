import { Emitter, type Event } from "@zaw/ui";
import { injectable } from "inversify";

export const INotificationService = Symbol.for("INotificationService");
export type Notification = Readonly<{
  id: number;
  message: string;
  severity: "error" | "info" | "warning";
}>;
export interface INotificationService {
  readonly messages: readonly Notification[];
  readonly onDidChange: Event<void>;
  error(error: unknown): void;
  info(message: string): void;
  warn(message: string): void;
}

@injectable()
export class NotificationService implements INotificationService {
  private nextID = 0;
  private _messages: Notification[] = [];
  private readonly emitter = new Emitter<void>();
  readonly onDidChange = this.emitter.event;
  get messages(): readonly Notification[] {
    return this._messages;
  }
  error(error: unknown): void {
    this.push(
      "error",
      error instanceof Error ? error.message : "An unexpected error occurred",
    );
  }
  info(message: string): void {
    this.push("info", message);
  }
  warn(message: string): void {
    this.push("warning", message);
  }
  private push(severity: Notification["severity"], message: string): void {
    this._messages = [
      ...this._messages.slice(-4),
      { id: ++this.nextID, severity, message },
    ];
    this.emitter.fire();
  }
}
