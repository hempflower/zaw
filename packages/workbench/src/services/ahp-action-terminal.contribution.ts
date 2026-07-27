import type { IAHPActionContributionRegistry } from "./ahp-action-contribution-registry";

export function registerTerminalAHPActionContributions(
  registry: IAHPActionContributionRegistry,
) {
  return [
    registry.register({
      factory: ({ terminals, update, workspaceID }) => {
        if (typeof update.action.data !== "string") return;
        terminals[workspaceID] = (terminals[workspaceID] ?? []).map(
          (terminal) =>
            terminal.resource === update.channel
              ? { ...terminal, output: terminal.output + update.action.data }
              : terminal,
        );
      },
      id: "terminal.data",
      type: "terminal/data",
    }),
    registry.register({
      factory: ({ terminals, update, workspaceID }) => {
        terminals[workspaceID] = (terminals[workspaceID] ?? []).map(
          (terminal) =>
            terminal.resource === update.channel
              ? { ...terminal, output: `${terminal.output}\n[terminal exited]` }
              : terminal,
        );
      },
      id: "terminal.exited",
      type: "terminal/exited",
    }),
    registry.register({
      factory: ({ reattachTerminals, workspaceID }) =>
        reattachTerminals(workspaceID),
      id: "terminal.rootChanged",
      type: "root/terminalsChanged",
    }),
  ];
}
