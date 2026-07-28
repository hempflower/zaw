// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { WorkbenchLayoutService } from "../../workbench/layout/layout-service";
import { Part } from "../../workbench/layout/layout";
import {
  RESPONSIVE_SIDEBAR_SETTING,
  ResponsiveSidebarContribution,
} from "./responsive-sidebar.contribution";

function memoryStorage(enabled: boolean): Storage {
  const values = new Map<string, string>();
  if (enabled) values.set(RESPONSIVE_SIDEBAR_SETTING, "true");
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  } as Storage;
}

describe("ResponsiveSidebarContribution", () => {
  it("implements D7 transitions and restores only its own hide", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1440,
    });
    const layout = new WorkbenchLayoutService();
    const contribution = new ResponsiveSidebarContribution(
      layout,
      memoryStorage(true),
    );

    layout.setEditorVisible(true);
    expect(layout.isVisible(Part.Sidebar)).toBe(false);
    layout.setEditorVisible(false);
    expect(layout.isVisible(Part.Sidebar)).toBe(true);

    layout.setVisible(Part.Sidebar, false);
    layout.setEditorVisible(true);
    layout.setEditorVisible(false);
    expect(layout.isVisible(Part.Sidebar)).toBe(false);
    contribution.dispose();
  });

  it("is feature-gated and re-baselines an initially constrained layout", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1440,
    });
    const disabledLayout = new WorkbenchLayoutService();
    const disabled = new ResponsiveSidebarContribution(
      disabledLayout,
      memoryStorage(false),
    );
    disabledLayout.setEditorVisible(true);
    expect(disabledLayout.isVisible(Part.Sidebar)).toBe(true);
    disabled.dispose();

    const baselineLayout = new WorkbenchLayoutService();
    baselineLayout.setEditorVisible(true);
    const baseline = new ResponsiveSidebarContribution(
      baselineLayout,
      memoryStorage(true),
    );
    expect(baselineLayout.isVisible(Part.Sidebar)).toBe(true);
    baselineLayout.setEditorVisible(false);
    baselineLayout.setEditorVisible(true);
    expect(baselineLayout.isVisible(Part.Sidebar)).toBe(false);
    baseline.dispose();
  });
});
