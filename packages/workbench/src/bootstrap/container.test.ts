// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  IWorkbenchViewContainersRegistry,
  IWorkbenchViewsRegistry,
  type IWorkbenchViewContainersRegistry as ContainersRegistry,
  type IWorkbenchViewsRegistry as ViewsRegistry,
} from "../services/workbench-view-registry";
import {
  IWorkbenchViewHost,
  WorkbenchViewHost,
} from "../services/workbench-view-host";
import { createWorkbenchContainer } from "./container";
import { Workbench, WorkbenchRoot } from "./workbench";

describe("Workbench dependency injection", () => {
  it("assembles framework services and declarative core views", () => {
    const root = document.createElement("div");
    const container = createWorkbenchContainer(root, "/api/v1");
    expect(container.get(WorkbenchRoot)).toBe(root);
    expect(container.get(IWorkbenchViewHost)).toBeInstanceOf(WorkbenchViewHost);
    expect(
      container.get<ContainersRegistry>(IWorkbenchViewContainersRegistry).all,
    ).toHaveLength(6);
    expect(
      container
        .get<ViewsRegistry>(IWorkbenchViewsRegistry)
        .getView("zaw.workbench.titlebar"),
    ).toBeDefined();
    expect(container.get(Workbench)).toBe(container.get(Workbench));
  });
});
