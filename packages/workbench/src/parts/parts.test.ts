// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { sessionIdentityKey } from "../services/active-session";
import { BottomPanelPart } from "./bottom-panel/bottom-panel-part";
import { LeftSidebarPart } from "./left-sidebar/left-sidebar-part";
import { PrimaryAreaPart } from "./primary-area/primary-area-part";
import { SecondarySidebarPart } from "./secondary-sidebar/secondary-sidebar-part";
import { TitlebarPart } from "./titlebar/titlebar-part";

const noop = () => undefined;

function root() {
  return document.createElement("div");
}

describe("Workbench parts", () => {
  it("render and dispose independently", () => {
    const parts = [
      new TitlebarPart(root(), {
        leftSidebarVisible: true,
        onDidOpenSettings: noop,
        onDidToggleLeftPanel: noop,
        onDidToggleRightPanel: noop,
        secondarySidebarVisible: true,
      }),
      new LeftSidebarPart(root(), {
        filter: "",
        mobileOpen: false,
        onDidClosePanel: noop,
        onDidOpenSettings: noop,
        onDidSelectSession: noop,
        onDidStartNewSession: noop,
        selectedSession: null,
        selectedWorkspaceID: null,
        sessionTitles: {},
        sessions: {},
        workspaces: [],
      }),
      new PrimaryAreaPart(root(), {
        composer: document.createTextNode(""),
        emptyState: document.createTextNode(""),
        messages: [],
        onDidCreateNewSession: noop,
        onDidToggleTerminal: noop,
        selectedSessionTitle: "New session",
        sessionSelected: false,
        summary: document.createTextNode(""),
        terminalOpen: false,
        terminalPart: null,
        workspaceID: "",
        workspaceOnline: false,
      }),
      new BottomPanelPart(root(), {
        activeTerminal: null,
        collapsed: false,
        height: 300,
        onDidClose: noop,
        onDidCreateTerminal: noop,
        onDidDisposeTerminal: noop,
        onDidInput: noop,
        onDidSelectTerminal: noop,
        onDidToggleCollapse: noop,
        terminals: [],
      }),
      new SecondarySidebarPart(root(), {
        activeTab: { id: "changes", kind: "changes", title: "Changes" },
        activeTabID: "changes",
        changes: [],
        files: [],
        mobileOpen: false,
        onDidClosePanel: noop,
        onDidCloseTab: noop,
        onDidOpenChange: noop,
        onDidOpenDirectory: noop,
        onDidOpenFile: noop,
        onDidOpenFilesTab: noop,
        onDidRefresh: noop,
        onDidRequestRevertChange: noop,
        onDidReviewChange: noop,
        onDidSelectTab: noop,
        onDidStageChange: noop,
        tabs: [{ id: "changes", kind: "changes", title: "Changes" }],
      }),
    ];
    for (const part of parts) {
      expect(() => undefined).not.toThrow();
      expect(() => part.dispose()).not.toThrow();
    }
  });

  it("renders Bottom Panel resize and non-destructive close controls", () => {
    const panel = root();
    new BottomPanelPart(panel, {
      activeTerminal: "ahp-terminal:/one",
      collapsed: false,
      height: 320,
      onDidClose: noop,
      onDidCreateTerminal: noop,
      onDidDisposeTerminal: noop,
      onDidInput: noop,
      onDidSelectTerminal: noop,
      onDidToggleCollapse: noop,
      terminal: {
        resource: "ahp-terminal:/one",
        title: "Terminal 1",
        output: "ready",
      },
      terminals: [
        {
          resource: "ahp-terminal:/one",
          title: "Terminal 1",
          output: "ready",
        },
      ],
    });

    expect(panel.querySelector('[data-resize-panel="bottom"]')).toBeTruthy();
    expect(panel.querySelector<HTMLElement>(".terminal-panel")?.style.getPropertyValue("--zaw-terminal-panel-height")).toBe("320px");
    expect(panel.querySelector('button[aria-label="Close terminal panel"]')).toBeTruthy();
    expect(panel.querySelector('button[aria-label="Close Terminal 1"]')).toBeTruthy();
  });

  it("renders only workspaces with sessions as non-selectable groups", () => {
    const workspace = (id: string, name: string) => ({
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
    });
    const sidebar = root();
    new LeftSidebarPart(sidebar, {
      filter: "",
      mobileOpen: false,
      onDidClosePanel: noop,
      onDidOpenSettings: noop,
      onDidSelectSession: noop,
      onDidStartNewSession: noop,
      selectedSession: "ahp-session:/one",
      selectedWorkspaceID: "workspace-one",
      sessionTitles: {
        [sessionIdentityKey({
          workspaceID: "workspace-one",
          resource: "ahp-session:/one",
        })]: "Session One",
      },
      sessions: { "workspace-one": ["ahp-session:/one"] },
      workspaces: [
        workspace("workspace-one", "Workspace One"),
        workspace("workspace-empty", "Empty Workspace"),
      ],
    });

    expect(sidebar.textContent).toContain("Workspace One");
    expect(sidebar.textContent).toContain("Session One");
    expect(sidebar.textContent).not.toContain("Empty Workspace");
    expect(sidebar.querySelector('button[aria-label="Select Workspace One"]')).toBeFalsy();
  });

  it("renders reusable detail tabs and explicit Changeset operations", () => {
    const sidebar = root();
    new SecondarySidebarPart(sidebar, {
      activeTab: { id: "changes", kind: "changes", title: "Changes" },
      activeTabID: "changes",
      changes: [
        {
          id: "README.md",
          path: "README.md",
          reviewed: false,
          status: "M",
        },
      ],
      files: [],
      mobileOpen: false,
      onDidClosePanel: noop,
      onDidCloseTab: noop,
      onDidOpenChange: noop,
      onDidOpenDirectory: noop,
      onDidOpenFile: noop,
      onDidOpenFilesTab: noop,
      onDidRefresh: noop,
      onDidRequestRevertChange: noop,
      onDidReviewChange: noop,
      onDidSelectTab: noop,
      onDidStageChange: noop,
      tabs: [
        { id: "changes", kind: "changes", title: "Changes" },
        { id: "files", kind: "files", title: "Files" },
      ],
      workspace: {
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
    });

    expect(sidebar.querySelector('button[aria-label="Close Files"]')).toBeTruthy();
    expect(sidebar.textContent).toContain("Workspace Changes · Workspace One");
    expect(sidebar.querySelector('button[aria-label="Mark reviewed README.md"]')).toBeTruthy();
    expect(sidebar.querySelector('button[aria-label="Accept README.md"]')).toBeTruthy();
    expect(sidebar.querySelector('button[aria-label="Restore README.md"]')).toBeTruthy();
  });
});
