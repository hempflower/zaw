// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { ContextKeyExpr } from "../../platform/context-key/context-key";
import { ContextKeyService } from "../../platform/context-key/context-key-service";
import {
  WorkbenchViewContainersRegistry,
  WorkbenchViewsRegistry,
} from "../../services/workbench-view-registry";
import { Part } from "../../workbench/layout/layout";
import { WorkbenchLayoutService } from "../../workbench/layout/layout-service";
import { CoreViewsContribution } from "./core-views.contribution";

describe("CoreViewsContribution", () => {
  it("only allocates the Auxiliary Part while its container has an active view", () => {
    const containers = new WorkbenchViewContainersRegistry();
    const views = new WorkbenchViewsRegistry();
    const context = new ContextKeyService();
    const layout = new WorkbenchLayoutService();
    const contribution = new CoreViewsContribution(
      containers,
      views,
      context,
      layout,
    );
    const active = context.createKey("test.auxiliary.active", false);
    class TestAuxiliaryView {
      readonly id = "test.auxiliary";
      dispose(): void {}
    }
    const registration = views.registerViews(
      [
        {
          ctor: TestAuxiliaryView,
          id: "test.auxiliary",
          name: "Test Auxiliary",
          when: ContextKeyExpr.has("test.auxiliary.active"),
        },
      ],
      containers.get("core.auxiliary")!,
    );

    expect(layout.isVisible(Part.AuxiliaryBar)).toBe(false);
    active.set(true);
    expect(layout.isVisible(Part.AuxiliaryBar)).toBe(true);
    active.set(false);
    expect(layout.isVisible(Part.AuxiliaryBar)).toBe(false);

    registration.dispose();
    contribution.dispose();
  });
});
