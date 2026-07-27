// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { SessionEmptyStateView } from "./session-empty-state";

describe("SessionEmptyStateView", () => {
  it("renders a centered new-session composer with an online workspace", () => {
    const state = document.createElement("div");
    new SessionEmptyStateView(state, {
      draft: "Build a dashboard",
      models: [{ id: "model-one", name: "Model One" }],
      selectedModelID: "model-one",
      selectedWorkspaceID: "workspace-one",
      workspaces: [
        {
          agentHostState: "online",
          createdAt: "2026-07-27T00:00:00Z",
          currentBuildId: "build-one",
          desiredState: "running",
          id: "workspace-one",
          name: "Workspace One",
          observedState: "running",
          parameters: {},
          sourceSnapshot: {
            kind: "git",
            url: "https://example.invalid/repository.git",
          },
          templateId: "template-one",
        },
      ],
    });

    expect(state.querySelector(".new-session-state")).toBeTruthy();
    expect(state.textContent).toContain("Workspace One");
    expect(state.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "Build a dashboard",
    );
    expect(state.querySelectorAll(".zaw-dropdown-borderless")).toHaveLength(3);
    expect(state.querySelector(".new-session-agent-picker")).toBeTruthy();
    expect(state.querySelector(".new-session-model-picker")).toBeTruthy();
    expect(state.textContent).toContain("Model One");
    expect(state.textContent).toContain("Ask for approval");
    expect(state.textContent?.indexOf("New Workspace")).toBeLessThan(
      state.textContent?.lastIndexOf("Workspace One") ?? 0,
    );
    expect(
      state.querySelector('button[aria-label="Create session"]'),
    ).toBeTruthy();
  });
});
