// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { ManagementViewRegistry } from "./management-view-registry";
import { ManagementSurfaceWidget } from "../views/management/management-surface";
import { registerBuiltinManagementViews } from "../views/management/management.contribution";

describe("Management surface", () => {
  it("registers searchable scoped views", () => {
    const registry = new ManagementViewRegistry();
    registerBuiltinManagementViews(registry);
    expect(registry.get("templates")?.scope).toBe("remote");
    expect(registry.all()).toHaveLength(7);
    expect(() =>
      registry.register({
        category: "Duplicate",
        factory: () => undefined,
        icon: "settings",
        id: "templates",
        keywords: [],
        scope: "remote",
        title: "Duplicate",
      }),
    ).toThrow();
  });

  it("renders search, scope tabs, tree navigation and back", () => {
    const registry = new ManagementViewRegistry();
    registerBuiltinManagementViews(registry);
    const root = document.createElement("div");
    new ManagementSurfaceWidget(root, {
      activeViewID: "templates",
      canGoBack: true,
      content: document.createTextNode("Template content"),
      query: "template",
      registry,
      scope: "remote",
    });
    expect(
      root.querySelector('input[aria-label="Search settings"]'),
    ).toBeTruthy();
    expect(root.querySelector(".management-scope-tabs")).toBeTruthy();
    expect(root.querySelector('[role="tree"]')).toBeTruthy();
    expect(root.querySelector('button[aria-label="Back"]')).toBeTruthy();
    expect(root.textContent).toContain("Templates");
    expect(root.textContent).not.toContain("Workspaces");
  });
});
