// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import {
  WorkbenchViewContainersRegistry,
  WorkbenchViewsRegistry,
} from "./workbench-view-registry";
import { WorkbenchViewHost } from "./workbench-view-host";

describe("WorkbenchViewHost", () => {
  it("renders ordered containers and views, honors when, forwards actions, and disposes factories", () => {
    const containers = new WorkbenchViewContainersRegistry();
    const views = new WorkbenchViewsRegistry<{
      enabled: boolean;
      emitAction: (value: string) => void;
    }>();
    const later = {
      id: "later",
      location: "panel" as const,
      order: 20,
      title: "Later",
    };
    const earlier = {
      id: "earlier",
      location: "panel" as const,
      order: 10,
      title: "Earlier",
    };
    containers.registerViewContainer(later);
    containers.registerViewContainer(earlier);
    const dispose = vi.fn();
    views.registerViews(
      [
        {
          id: "visible",
          name: "Visible",
          factory: (root, context) => {
            root.textContent = "visible";
            context.emitAction("forwarded");
            return { dispose };
          },
        },
      ],
      earlier,
    );
    views.registerViews(
      [
        {
          id: "conditional",
          name: "Conditional",
          when: (context) => context.enabled,
          factory: (root) => {
            root.textContent = "conditional";
          },
        },
      ],
      later,
    );
    const action = vi.fn();
    const host = new WorkbenchViewHost(containers, views);

    const first = host.render({ enabled: false, emitAction: action });
    expect(
      first
        .getLocationNodes("panel")
        .map((node) => (node as HTMLElement).dataset.workbenchViewContainer),
    ).toEqual(["earlier", "later"]);
    expect(first.getContainerNode("later")?.textContent).toBe("");
    expect(action).toHaveBeenCalledWith("forwarded");

    const second = host.render({ enabled: true, emitAction: action });
    expect(dispose).toHaveBeenCalledOnce();
    expect(second.getContainerNode("later")?.textContent).toBe("conditional");
    host.dispose();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
