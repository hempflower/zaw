import { describe, expect, it, vi } from "vitest";
import type { IAgentHost } from "./agent-host";
import { AgentHostProviderRegistry } from "./agent-host-provider-registry";

describe("AgentHostProviderRegistry", () => {
  it("selects the first capable contribution and supports deregistration", async () => {
    const registry = new AgentHostProviderRegistry();
    const fallback = vi.fn().mockResolvedValue({ id: "fallback" });
    const remote = vi.fn().mockResolvedValue({ id: "remote" });
    registry.register({
      id: "fallback",
      order: 100,
      provider: { connect: fallback },
    });
    const registration = registry.register({
      canHandle: (workspaceID) => workspaceID.startsWith("remote:"),
      id: "remote",
      order: 10,
      provider: { connect: remote },
    });
    await expect(registry.connect("remote:one")).resolves.toMatchObject({
      id: "remote",
    } as unknown as IAgentHost);
    expect(remote).toHaveBeenCalledWith("remote:one");
    registration.dispose();
    await registry.connect("remote:two");
    expect(fallback).toHaveBeenCalledWith("remote:two");
  });
});
