// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { WorkbenchLayoutService } from "./layout-service";
import { Part } from "./layout";

describe("WorkbenchLayoutService", () => {
  it("keeps stable part roots and persists layout state", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as Storage;
    const layout = new WorkbenchLayoutService(storage);
    const sidebar = layout.getPartRoot(Part.Sidebar);
    expect(layout.getPartRoot(Part.Sidebar)).toBe(sidebar);
    layout.setSidebarWidth(320);
    layout.setAuxiliaryBarWidth(360);
    layout.setPanelHeight(240);
    layout.setVisible(Part.AuxiliaryBar, false);
    layout.setVisible(Part.Panel, true);
    const restored = new WorkbenchLayoutService(storage);
    expect(restored.sidebarWidth).toBe(320);
    expect(restored.auxiliaryBarWidth).toBe(360);
    expect(restored.panelHeight).toBe(240);
    expect(restored.isVisible(Part.AuxiliaryBar)).toBe(false);
    expect(restored.isVisible(Part.Panel)).toBe(true);
  });

  it("composes independent automatic visibility sources", () => {
    const layout = new WorkbenchLayoutService();
    layout.setAutoHidden(Part.AuxiliaryBar, true, "responsive-policy");
    layout.setAutoHidden(Part.AuxiliaryBar, true, "active-view-container");
    expect(layout.isVisible(Part.AuxiliaryBar)).toBe(false);

    layout.setAutoHidden(Part.AuxiliaryBar, false, "responsive-policy");
    expect(layout.isVisible(Part.AuxiliaryBar)).toBe(false);

    layout.setAutoHidden(Part.AuxiliaryBar, false, "active-view-container");
    expect(layout.isVisible(Part.AuxiliaryBar)).toBe(true);
  });

  it("publishes semantic editor visibility without inventing another Part", () => {
    const layout = new WorkbenchLayoutService();
    const states: boolean[] = [];
    layout.onDidChangeEditorVisibility((visible) => states.push(visible));
    layout.setEditorVisible(true);
    layout.setEditorVisible(true);
    layout.setEditorVisible(false);
    expect(states).toEqual([true, false]);
  });
});
