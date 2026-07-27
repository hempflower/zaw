import { sessionIdentityKey } from "./active-session";
import type { IAHPActionContributionRegistry } from "./ahp-action-contribution-registry";

export function registerSessionAHPActionContributions(
  registry: IAHPActionContributionRegistry,
) {
  return [
    registry.register({
      factory: ({ sessionTitles, sessions, update, workspaceID }) => {
        const session = update.action.summary as
          | { resource?: string; title?: string }
          | undefined;
        if (!session?.resource) return;
        sessions[workspaceID] = [
          ...(sessions[workspaceID] ?? []),
          session.resource,
        ];
        sessionTitles[
          sessionIdentityKey({ workspaceID, resource: session.resource })
        ] = session.title ?? "New Session";
      },
      id: "session.added",
      type: "root/sessionAdded",
    }),
    registry.register({
      factory: ({ sessionTitles, sessions, update, workspaceID }) => {
        if (typeof update.action.session !== "string") return;
        sessions[workspaceID] = (sessions[workspaceID] ?? []).filter(
          (session) => session !== update.action.session,
        );
        delete sessionTitles[
          sessionIdentityKey({ workspaceID, resource: update.action.session })
        ];
      },
      id: "session.removed",
      type: "root/sessionRemoved",
    }),
    registry.register({
      factory: ({ sessionTitles, update, workspaceID }) => {
        if (typeof update.action.title !== "string") return;
        sessionTitles[
          sessionIdentityKey({ workspaceID, resource: update.channel })
        ] = update.action.title;
      },
      id: "session.titleChanged",
      type: "session/titleChanged",
    }),
  ];
}
