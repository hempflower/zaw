import type { AHPAction } from "./agent-host";
import { injectable } from "inversify";
import type { IChatSessionService } from "./chat-session";
import type { IWorkspaceAttachmentService } from "./workspace-attachment";
import { ContributionRegistry } from "./contribution-registry";
import type { IDisposable } from "@zaw/ui";
import type { SessionEvent } from "../views/session/session-event-view";

export const IAHPActionContributionRegistry = Symbol.for(
  "IAHPActionContributionRegistry",
);

export type AHPActionHandlerContext = {
  applyToolApproval: (
    identity: { workspaceID: string; resource: string },
    update: AHPAction,
    state: "approved" | "denied" | "pending",
  ) => void;
  applyToolCall: (
    identity: { workspaceID: string; resource: string },
    update: AHPAction,
    state: string,
  ) => void;
  attachmentService: IWorkspaceAttachmentService;
  changes: Record<
    string,
    Array<{
      id: string;
      path: string;
      reviewed: boolean;
      resource: string;
      status: string;
    }>
  >;
  changesetResources: Record<string, string>;
  chatSessionService: IChatSessionService;
  identityForChat: (
    workspaceID: string,
    chat: string,
  ) => { workspaceID: string; resource: string } | undefined;
  messages: Record<string, SessionEvent[]>;
  reattachTerminals: (workspaceID: string) => void;
  sessionTitles: Record<string, string>;
  sessions: Record<string, string[]>;
  terminals: Record<
    string,
    Array<{ output: string; resource: string; title: string }>
  >;
};

export type AHPActionInvocationContext = AHPActionHandlerContext & {
  update: AHPAction;
  workspaceID: string;
};

export type AHPActionContributionDescriptor = {
  factory: (context: AHPActionInvocationContext) => void;
  id: string;
  order?: number;
  type: string;
  when?: () => boolean;
};

export interface IAHPActionContributionRegistry {
  all(): AHPActionContributionDescriptor[];
  dispatch(
    workspaceID: string,
    update: AHPAction,
    context: AHPActionHandlerContext,
  ): void;
  get(id: string): AHPActionContributionDescriptor | undefined;
  register(descriptor: AHPActionContributionDescriptor): IDisposable;
}

@injectable()
export class AHPActionContributionRegistry
  extends ContributionRegistry<string, AHPActionContributionDescriptor>
  implements IAHPActionContributionRegistry
{
  dispatch(
    workspaceID: string,
    update: AHPAction,
    context: AHPActionHandlerContext,
  ) {
    const type = update.action.type;
    for (const descriptor of this.all()) {
      if (descriptor.type === type) {
        descriptor.factory(contextWithUpdate(context, workspaceID, update));
      }
    }
  }
}

function contextWithUpdate(
  context: AHPActionHandlerContext,
  workspaceID: string,
  update: AHPAction,
): AHPActionInvocationContext {
  return { ...context, update, workspaceID };
}
