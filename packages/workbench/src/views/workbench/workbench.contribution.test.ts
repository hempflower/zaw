import { describe, expect, it } from "vitest";
import {
  WorkbenchViewContainersRegistry,
  WorkbenchViewsRegistry,
} from "../../services/workbench-view-registry";
import type { WorkbenchViewContext } from "../../services/workbench-view-context";
import {
  builtinWorkbenchViewContainers,
  builtinWorkbenchViewIDs,
  registerBuiltinWorkbenchViews,
} from "./workbench.contribution";

describe("builtin workbench views", () => {
  it("registers stable containers and globally unique top-level views", () => {
    const containers = new WorkbenchViewContainersRegistry();
    const views = new WorkbenchViewsRegistry<WorkbenchViewContext>();
    registerBuiltinWorkbenchViews(containers, views);

    expect(containers.all).toHaveLength(
      Object.keys(builtinWorkbenchViewContainers).length,
    );
    const descriptors = containers.all.flatMap((container) =>
      views.getViews(container),
    );
    expect(descriptors.map((view) => view.id).sort()).toEqual(
      Object.values(builtinWorkbenchViewIDs).sort(),
    );
    expect(new Set(descriptors.map((view) => view.id))).toHaveProperty(
      "size",
      descriptors.length,
    );
    expect(views.getView(builtinWorkbenchViewIDs.terminal)?.when).toBeTypeOf(
      "function",
    );
  });
});
