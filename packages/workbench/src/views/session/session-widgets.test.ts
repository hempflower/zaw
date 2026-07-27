// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { ChatComposerWidget } from "./chat-composer";
import { SessionEmptyStateView } from "./session-empty-state";
import { SessionEventView } from "./session-event-view";

describe("Session Widgets", () => {
  it("renders actionable approval independently from tool state", () => {
    const toolRoot = document.createElement("div");
    new SessionEventView(toolRoot, {
      kind: "tool",
      toolCallID: "tool-one",
      title: "Run command",
      detail: "echo ready",
      state: "pending-confirmation",
    });
    const approvalRoot = document.createElement("div");
    new SessionEventView(approvalRoot, {
      kind: "approval",
      actionValue: "target",
      toolCallID: "tool-one",
      title: "Allow shell",
      detail: "echo ready",
      state: "pending",
    });

    expect(toolRoot.querySelector(".tool-event")).toBeTruthy();
    expect(toolRoot.querySelector('button[aria-label="Allow tool call"]')).toBeFalsy();
    expect(approvalRoot.querySelector('button[aria-label="Allow tool call"]')).toBeTruthy();
    expect(approvalRoot.querySelector('button[aria-label="Deny tool call"]')).toBeTruthy();
  });

  it("disables composition while offline and exposes selections", () => {
    const composer = document.createElement("div");
    new ChatComposerWidget(composer, {
      activeTurn: false,
      composition: {
        agent: "copilot",
        approvalMode: "ask",
        attachments: [],
        draft: "hello",
        model: "model-one",
      },
      enabled: false,
      models: [{ id: "model-one", name: "Model One" }],
      onDidCancelTurn: () => undefined,
      onDidChangeAgent: () => undefined,
      onDidChangeApprovalMode: () => undefined,
      onDidChangeDraft: () => undefined,
      onDidChangeModel: () => undefined,
      onDidChooseAttachments: () => undefined,
      onDidRemoveAttachment: () => undefined,
      onDidSendMessage: () => undefined,
    });

    expect(composer.querySelectorAll(".zaw-select")).toHaveLength(3);
    expect(composer.querySelector('textarea[disabled]')).toBeTruthy();
    expect(composer.querySelector('button[aria-label="Send message"]')?.hasAttribute("disabled")).toBe(true);
  });

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
    expect(state.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Build a dashboard");
    expect(state.querySelectorAll(".zaw-dropdown-borderless")).toHaveLength(3);
    expect(state.querySelector(".new-session-agent-picker")).toBeTruthy();
    expect(state.querySelector(".new-session-model-picker")).toBeTruthy();
    expect(state.textContent).toContain("Model One");
    expect(state.textContent).toContain("Ask for approval");
    expect(state.textContent?.indexOf("New Workspace")).toBeLessThan(
      state.textContent?.lastIndexOf("Workspace One") ?? 0,
    );
    expect(state.querySelector('button[aria-label="Create session"]')).toBeTruthy();
  });
});
