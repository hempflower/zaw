import { describe, expect, it, vi } from "vitest";
import { HTTPClient } from "./http-client";
import { HTTPWorkspaceProvider } from "./http-workspace-provider";

describe("HTTPWorkspaceProvider", () => {
  it("maps typed workspace operations to HTTP path, method and body", async () => {
    const request = vi.fn().mockResolvedValue({ id: "workspace" });
    const provider = new HTTPWorkspaceProvider({
      request,
    } as unknown as HTTPClient);
    await provider.create({
      name: "Demo",
      templateId: "template",
      parameters: {},
    });
    await provider.requestBuild("workspace-one", "start");
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/workspaces",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"name":"Demo"'),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/workspaces/workspace-one/builds",
      expect.objectContaining({
        method: "POST",
        body: '{"operation":"start"}',
      }),
    );
  });
});
