import { describe, expect, it } from "vitest";
import { DetailViewService } from "./detail-view-service";
import { ActiveSessionService } from "../../services/active-session";
import { WorkbenchLayoutService } from "../../workbench/layout/layout-service";
import { Part } from "../../workbench/layout/layout";
import { WorkspaceUIStateService } from "../../services/workspace-ui-state";

describe("DetailViewService", () => {
  it("owns the Files default and preview lifecycle independently", () => {
    const details = new DetailViewService();
    details.openFiles();
    expect(details.activeTabID).toBe("files");
    details.openPreview("file:README", "README", "hello");
    expect(details.activeTabID).toBe("file:README");
    expect(details.tabs.map((tab) => tab.id)).toEqual(["files", "file:README"]);
    details.close("file:README");
    expect(details.activeTabID).toBe("files");
    expect(details.tabs.map((tab) => tab.id)).toEqual(["files"]);
  });

  it("restores the active view and Auxiliary visibility per Session", () => {
    const active = new ActiveSessionService();
    const layout = new WorkbenchLayoutService();
    const state = new WorkspaceUIStateService();
    const details = new DetailViewService(undefined, active, layout, state);
    const first = { workspaceID: "workspace", resource: "session:first" };
    const second = { workspaceID: "workspace", resource: "session:second" };

    active.select(first);
    expect(details.activeTabID).toBe("changes");
    expect(layout.isVisible(Part.AuxiliaryBar)).toBe(false);
    details.openPreview("file:README", "README", "first");
    layout.setVisible(Part.AuxiliaryBar, false);
    active.select(second);
    expect(details.activeTabID).toBe("changes");
    expect(layout.isVisible(Part.AuxiliaryBar)).toBe(false);

    details.openFiles();
    active.select(first);
    expect(details.activeTabID).toBe("file:README");
    expect(details.tabs.find((tab) => tab.id === "file:README")?.content).toBe(
      "first",
    );
    expect(layout.isVisible(Part.AuxiliaryBar)).toBe(false);

    active.select(second);
    expect(details.activeTabID).toBe("files");
    expect(layout.isVisible(Part.AuxiliaryBar)).toBe(true);
  });

  it("carries the new-session side pane into the committed Session", () => {
    const active = new ActiveSessionService();
    const layout = new WorkbenchLayoutService();
    const state = new WorkspaceUIStateService();
    const details = new DetailViewService(undefined, active, layout, state);
    const identity = { workspaceID: "workspace", resource: "session:new" };

    layout.setVisible(Part.AuxiliaryBar, true);
    details.commitNewSession(identity);
    active.select(identity);

    expect(details.activeTabID).toBe("changes");
    expect(layout.isVisible(Part.AuxiliaryBar)).toBe(true);
  });

  it("reveals a manually closed Auxiliary when a detail is opened", () => {
    const layout = new WorkbenchLayoutService();
    const details = new DetailViewService(undefined, undefined, layout);
    layout.setVisible(Part.AuxiliaryBar, false);
    details.openFiles();
    expect(layout.isVisible(Part.AuxiliaryBar)).toBe(true);
  });
});
