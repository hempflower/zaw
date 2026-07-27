import type { IAHPActionContributionRegistry } from "./ahp-action-contribution-registry";
import {
  isString,
  isWorkspaceChange,
  workspaceChangeFromAHP,
} from "./ahp-action-utils";

export function registerChangesetAHPActionContributions(
  registry: IAHPActionContributionRegistry,
) {
  return [
    registry.register({
      factory: ({ changes, changesetResources, update, workspaceID }) => {
        if (!Array.isArray(update.action.files)) return;
        changes[workspaceID] = update.action.files
          .map(workspaceChangeFromAHP)
          .filter(isWorkspaceChange);
        changesetResources[workspaceID] = update.channel;
      },
      id: "changeset.contentChanged",
      type: "changeset/contentChanged",
    }),
    registry.register({
      factory: ({ changes, update, workspaceID }) => {
        if (!Array.isArray(update.action.files)) return;
        const reviewed = update.action.reviewed === true;
        const fileIDs = new Set(update.action.files.filter(isString));
        for (const change of changes[workspaceID] ?? []) {
          if (fileIDs.has(change.id)) change.reviewed = reviewed;
        }
      },
      id: "changeset.filesReviewChanged",
      type: "changeset/filesReviewChanged",
    }),
  ];
}
