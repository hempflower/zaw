/** Protocol-neutral event model owned by the chat/session domain. */
export type ChatEvent =
  | { id?: string; kind: "message"; role: "agent" | "user"; text: string }
  | {
      kind: "tool";
      toolCallID: string;
      title: string;
      summary?: string;
      detail: string;
      state: string;
    }
  | {
      kind: "approval";
      actionValue: string;
      toolCallID: string;
      title: string;
      summary?: string;
      detail: string;
      state: "approved" | "denied" | "pending";
    }
  | {
      kind: "notification";
      level: "error" | "info" | "warning";
      text: string;
    }
  | { kind: "error"; text: string };
