// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { ManagementSheetContributionRegistry } from "./management-sheet-contribution-registry";
import { registerBuiltinManagementSheetContributions } from "./management-sheet.contribution";

describe("ManagementSheetContributionRegistry", () => {
  it("registers builtin sheet descriptors and rejects duplicate ids", () => {
    const registry = new ManagementSheetContributionRegistry();
    registerBuiltinManagementSheetContributions(registry);

    expect(registry.get("workspace-picker")?.title).toBe("Choose a workspace");
    expect(registry.all()).toHaveLength(10);
    expect(() =>
      registry.register({
        factory: () => undefined,
        id: "workspace-picker",
        title: "Duplicate",
      }),
    ).toThrow();
  });
});
