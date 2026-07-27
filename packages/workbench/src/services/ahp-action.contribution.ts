import type { IAHPActionContributionRegistry } from "./ahp-action-contribution-registry";
import { registerChangesetAHPActionContributions } from "./ahp-action-changeset.contribution";
import { registerChatAHPActionContributions } from "./ahp-action-chat.contribution";
import { registerSessionAHPActionContributions } from "./ahp-action-session.contribution";
import { registerTerminalAHPActionContributions } from "./ahp-action-terminal.contribution";

export function registerBuiltinAHPActionContributions(
  registry: IAHPActionContributionRegistry,
) {
  return [
    ...registerTerminalAHPActionContributions(registry),
    ...registerChangesetAHPActionContributions(registry),
    ...registerSessionAHPActionContributions(registry),
    ...registerChatAHPActionContributions(registry),
  ];
}
