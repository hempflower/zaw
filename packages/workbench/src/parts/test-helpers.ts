export const noop = () => undefined;

export function root() {
  return document.createElement("div");
}

export function workspace(id: string, name: string) {
  return {
    agentHostState: "online" as const,
    createdAt: "2026-07-27T00:00:00Z",
    currentBuildId: "build-one",
    desiredState: "running" as const,
    id,
    name,
    observedState: "running" as const,
    parameters: {},
    sourceSnapshot: {
      kind: "git" as const,
      url: "https://example.invalid/repository.git",
    },
    templateId: "template-one",
  };
}
