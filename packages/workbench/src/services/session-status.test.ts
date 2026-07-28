import { describe, expect, it } from "vitest";
import { SessionStatusRegistry } from "./session-status";

describe("SessionStatusRegistry", () => {
  it("lets a contribution override presentation without changing a renderer", () => {
    const registry = new SessionStatusRegistry();
    registry.register({
      icon: "rocket",
      id: "custom.deploying",
      label: "Deploying",
      matches: (item) => item?.activity === "deploying",
      order: 1,
      state: "deploying",
    });
    expect(registry.resolve({ activity: "deploying" } as never)).toMatchObject({
      icon: "rocket",
      state: "deploying",
    });
    expect(registry.resolve(undefined).state).toBe("idle");
  });
});
