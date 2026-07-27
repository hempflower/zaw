import { describe, expect, it } from "vitest";
import { ContributionRegistry } from "./contribution-registry";

describe("ContributionRegistry", () => {
  it("registers ordered descriptors, emits registration, and disposes entries", () => {
    const registry = new ContributionRegistry<
      string,
      { factory: () => void; id: string; order?: number }
    >();
    const registered: string[] = [];
    registry.onDidRegister((descriptor) => registered.push(descriptor.id));
    const later = registry.register({
      factory: () => undefined,
      id: "later",
      order: 20,
    });
    registry.register({ factory: () => undefined, id: "first", order: 10 });

    expect(registered).toEqual(["later", "first"]);
    expect(registry.all().map((descriptor) => descriptor.id)).toEqual([
      "first",
      "later",
    ]);
    expect(() =>
      registry.register({ factory: () => undefined, id: "first" }),
    ).toThrow();

    later.dispose();
    expect(registry.get("later")).toBeUndefined();
  });
});
