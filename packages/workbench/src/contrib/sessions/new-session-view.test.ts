// @vitest-environment happy-dom

import { Emitter } from "@zaw/ui";
import { describe, expect, it, vi } from "vitest";
import type { ICommandService } from "../../platform/commands/commands";
import type { IManagementService } from "../management/management-service";
import type { IWorkspaceService } from "../workspace/workspace-service";
import { NewSessionInputModel, NewSessionView } from "./new-session-view";

describe("NewSessionView empty states", () => {
  it("distinguishes workspace, host, model loading, error and empty states", () => {
    const workspaceChanges = new Emitter<void>();
    const managementChanges = new Emitter<void>();
    let selected: string | null = null;
    const workspace = {
      agentHostState: "offline",
      desiredState: "running",
      id: "one",
      name: "One",
      observedState: "running",
      parameters: {},
    };
    const workspaces = {
      get selectedWorkspaceID() {
        return selected;
      },
      onDidChange: workspaceChanges.event,
      select: async (id: string) => {
        selected = id;
        workspaceChanges.fire();
      },
      workspaces: [workspace],
    } as unknown as IWorkspaceService;
    const management = {
      models: [],
      modelsError: "",
      modelsState: "loading",
      onDidChange: managementChanges.event,
    } as unknown as IManagementService;
    const view = new NewSessionView(
      workspaces,
      management,
      { executeCommand: async () => undefined } as ICommandService,
      new NewSessionInputModel(),
    );
    const editor = view.element.querySelector("textarea")!;
    expect(editor.placeholder).toBe("Select a workspace to start");

    selected = "one";
    workspaceChanges.fire();
    expect(editor.placeholder).toBe(
      "Workspace must be running to create a session",
    );

    workspace.agentHostState = "online";
    workspaceChanges.fire();
    expect(editor.placeholder).toBe("Loading language models");
    expect(
      view.element.querySelector(
        '[aria-label="Language model"] .zaw-picker-action-label',
      )?.textContent,
    ).toBe("Loading models…");

    Object.assign(management, {
      modelsError: "model endpoint offline",
      modelsState: "error",
    });
    managementChanges.fire();
    expect(editor.placeholder).toBe("Language models are unavailable");
    expect(
      view.element.querySelector(
        '[aria-label="Language model"] .zaw-picker-action-label',
      )?.textContent,
    ).toBe("Models unavailable");
    expect(view.element.querySelector('[role="alert"]')?.textContent).toBe(
      "model endpoint offline",
    );

    Object.assign(management, { modelsError: "", modelsState: "ready" });
    managementChanges.fire();
    expect(editor.placeholder).toBe("No language models available");
    expect(
      view.element.querySelector(
        '[aria-label="Language model"] .zaw-picker-action-label',
      )?.textContent,
    ).toBe("No models available");
    expect(editor.disabled).toBe(true);

    Object.assign(management, { models: [{ id: "model", name: "Model" }] });
    managementChanges.fire();
    expect(editor.placeholder).toBe("Describe what you want to build");
    expect(editor.disabled).toBe(false);
    view.dispose();
  });

  it("offers workspace creation from the workspace picker", () => {
    const executeCommand = vi.fn().mockResolvedValue(undefined);
    const view = new NewSessionView(
      {
        onDidChange: new Emitter<void>().event,
        selectedWorkspaceID: null,
        workspaces: [],
      } as unknown as IWorkspaceService,
      undefined,
      { executeCommand } as unknown as ICommandService,
      new NewSessionInputModel(),
    );
    const create = view.element.querySelector<HTMLButtonElement>(
      'button[value="__create_workspace__"]',
    );
    expect(create?.textContent).toContain("Create New Workspace");
    create?.click();
    expect(executeCommand).toHaveBeenCalledWith("zaw.workspace.openCreate");
    view.dispose();
  });

  it("shows build logs and stable lifecycle controls", async () => {
    const changes = new Emitter<void>();
    const workspace = {
      agentHostState: "online",
      desiredState: "running",
      id: "one",
      name: "One",
      observedState: "running",
      parameters: {},
    };
    const reload = vi.fn().mockResolvedValue(undefined);
    const stopWorkspace = vi.fn().mockResolvedValue(undefined);
    const workspaces = {
      onDidChange: changes.event,
      reload,
      selectedWorkspaceID: "one",
      workspaces: [workspace],
    } as unknown as IWorkspaceService;
    const management = {
      models: [{ id: "model", name: "Model" }],
      modelsState: "ready",
      onDidChange: new Emitter<void>().event,
      openBuildLogs: vi.fn(),
      stopWorkspace,
    } as unknown as IManagementService;
    const view = new NewSessionView(
      workspaces,
      management,
      { executeCommand: vi.fn() } as unknown as ICommandService,
      new NewSessionInputModel(),
    );

    expect(
      view.element.querySelector('[aria-label="View build logs for One"]'),
    ).not.toBeNull();
    const stop = view.element.querySelector<HTMLButtonElement>(
      '[aria-label="Stop One"]',
    );
    expect(stop?.closest(".state-stop")).not.toBeNull();
    stop?.click();
    expect(
      view.element.querySelector(".agent-workspace-transition.codicon-loading"),
    ).not.toBeNull();
    await vi.waitFor(() => expect(stopWorkspace).toHaveBeenCalledWith("one"));

    Object.assign(workspace, {
      agentHostState: "offline",
      desiredState: "stopped",
      observedState: "stopped",
    });
    changes.fire();
    expect(
      view.element
        .querySelector('[aria-label="Start One"]')
        ?.closest(".state-start"),
    ).not.toBeNull();
    expect(view.element.querySelector("textarea")?.disabled).toBe(true);
    view.dispose();
  });
});
