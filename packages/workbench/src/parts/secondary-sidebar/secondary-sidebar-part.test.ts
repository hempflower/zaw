// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { noop, root, workspace } from "../test-helpers";
import { SecondarySidebarPart } from "./secondary-sidebar-part";
import { DetailTabRendererRegistry } from "../../views/session-details/detail-tab-renderer-registry";
import { registerBuiltinDetailTabRenderers } from "../../views/session-details/detail-tab.contribution";

describe("SecondarySidebarPart", () => {
  it("renders reusable detail tabs and explicit Changeset operations", () => {
    const sidebar = root();
    const registry = new DetailTabRendererRegistry();
    registerBuiltinDetailTabRenderers(registry);
    new SecondarySidebarPart(
      sidebar,
      {
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
        tabs: [
          { id: "changes", kind: "changes", title: "Changes" },
          { id: "files", kind: "files", title: "Files" },
        ],
        workspace: workspace("workspace-one", "Workspace One"),
      },
      registry,
    );

    expect(
      sidebar.querySelector('button[aria-label="Close Files"]'),
    ).toBeTruthy();
    expect(sidebar.textContent).toContain("Workspace Changes · Workspace One");
    expect(
      sidebar.querySelector('button[aria-label="Mark reviewed README.md"]'),
    ).toBeTruthy();
    expect(
      sidebar.querySelector('button[aria-label="Accept README.md"]'),
    ).toBeTruthy();
    expect(
      sidebar.querySelector('button[aria-label="Restore README.md"]'),
    ).toBeTruthy();
  });

  it("registers detail renderers by kind", () => {
    const registry = new DetailTabRendererRegistry();
    registerBuiltinDetailTabRenderers(registry);
    expect(registry.rendererFor("changes")?.icon).toBe("source-control");
    expect(() =>
      registry.register({
        factory: () => undefined,
        icon: "source-control",
        id: "detail-tab.changes",
        kind: "changes",
      }),
    ).toThrow();
  });
});
