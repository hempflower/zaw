import { describe, expect, it, vi } from "vitest";
import {
  WorkbenchViewContainersRegistry,
  WorkbenchViewsRegistry,
  type WorkbenchViewContainer,
  type WorkbenchViewDescriptor,
} from "./workbench-view-registry";

const sidebar: WorkbenchViewContainer = {
  id: "workbench.container.sidebar",
  location: "sidebar",
  order: 20,
  title: "Sidebar",
};

const primary: WorkbenchViewContainer = {
  id: "workbench.container.primary",
  location: "primary",
  order: 10,
  title: "Primary",
};

const view = (id: string, order?: number): WorkbenchViewDescriptor => ({
  ctor: class {
    readonly id = id;
    dispose() {}
  },
  id,
  name: id,
  order,
});

describe("WorkbenchViewContainersRegistry", () => {
  it("registers containers by location and deregisters them", () => {
    const registry = new WorkbenchViewContainersRegistry();
    const registered = vi.fn();
    const deregistered = vi.fn();
    registry.onDidRegister(registered);
    registry.onDidDeregister(deregistered);

    registry.registerViewContainer(sidebar);
    const registration = registry.registerViewContainer(primary);

    expect(registry.all).toEqual([primary, sidebar]);
    expect(registry.getViewContainers("sidebar")).toEqual([sidebar]);
    expect(registered).toHaveBeenCalledTimes(2);
    registration.dispose();
    expect(registry.get(primary.id)).toBeUndefined();
    expect(deregistered).toHaveBeenCalledWith(primary);
  });

  it("rejects duplicate container IDs", () => {
    const registry = new WorkbenchViewContainersRegistry();
    registry.registerViewContainer(sidebar);
    expect(() => registry.registerViewContainer({ ...sidebar })).toThrow(
      "already registered",
    );
  });
});

describe("WorkbenchViewsRegistry", () => {
  it("orders views and resolves their container", () => {
    const registry = new WorkbenchViewsRegistry();
    const later = view("later", 20);
    const earlier = view("earlier", 10);
    registry.registerViews([later, earlier], primary);

    expect(registry.getViews(primary)).toEqual([earlier, later]);
    expect(registry.getView("later")).toBe(later);
    expect(registry.getViewContainer("later")).toBe(primary);
  });

  it("enforces global view IDs and emits registration changes", () => {
    const registry = new WorkbenchViewsRegistry();
    const registered = vi.fn();
    const deregistered = vi.fn();
    const descriptor = view("sessions");
    registry.onViewsRegistered(registered);
    registry.onViewsDeregistered(deregistered);

    const registration = registry.registerViews([descriptor], sidebar);
    expect(() => registry.registerViews([view("sessions")], primary)).toThrow(
      "already registered",
    );
    expect(registered).toHaveBeenCalledWith({
      container: sidebar,
      views: [descriptor],
    });

    registration.dispose();
    expect(registry.getView("sessions")).toBeUndefined();
    expect(deregistered).toHaveBeenCalledWith({
      container: sidebar,
      views: [descriptor],
    });
  });
});
