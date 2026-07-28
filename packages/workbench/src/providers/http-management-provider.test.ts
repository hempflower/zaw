import { describe, expect, it, vi } from "vitest";
import { HTTPManagementProvider } from "./http-management-provider";
import { HTTPClient } from "./http-client";

describe("HTTPManagementProvider", () => {
  it("owns encoded paths, methods and JSON bodies for management operations", async () => {
    const request = vi.fn().mockResolvedValue({ id: "credential" });
    const provider = new HTTPManagementProvider({
      request,
    } as unknown as HTTPClient);
    await provider.getCredential("name/with slash");
    await provider.saveCredential({
      kind: "token",
      metadata: {},
      name: "API",
      secret: { token: "secret" },
    });
    await provider.deleteTemplate("template/one");
    await provider.startWorkspace("workspace/one");
    await provider.stopWorkspace("workspace/one");
    await provider.deleteWorkspace("workspace/one");
    await provider.saveModelProvider({
      id: "deepseek",
      name: "DeepSeek",
      kind: "anthropic",
      apiBase: "https://api.deepseek.com/anthropic",
      apiKey: "sk-placeholder",
    });
    await provider.saveModel({
      providerId: "provider-one",
      name: "DeepSeek V4 Pro",
      upstreamModel: "deepseek-v4-pro",
      isDefault: true,
      capabilities: { contextWindow: 128000, textInput: true, tools: true },
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/credentials/name%2Fwith%20slash",
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/credentials",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"name":"API"'),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(3, "/templates/template%2Fone", {
      method: "DELETE",
    });
    expect(request).toHaveBeenNthCalledWith(
      4,
      "/workspaces/workspace%2Fone/builds",
      expect.objectContaining({
        method: "POST",
        body: '{"operation":"start"}',
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      5,
      "/workspaces/workspace%2Fone/builds",
      expect.objectContaining({
        method: "POST",
        body: '{"operation":"stop"}',
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      6,
      "/workspaces/workspace%2Fone/builds",
      expect.objectContaining({
        method: "POST",
        body: '{"operation":"delete"}',
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      7,
      "/model-providers",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"apiKey":"sk-placeholder"'),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      8,
      "/models",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"upstreamModel":"deepseek-v4-pro"'),
      }),
    );
  });

  it("uses item endpoints for model edits and deletes", async () => {
    const request = vi.fn().mockResolvedValue({});
    const provider = new HTTPManagementProvider({
      request,
    } as unknown as HTTPClient);
    const model = {
      capabilities: { contextWindow: 128000, textInput: true },
      isDefault: false,
      name: "Model",
      providerId: "provider",
      upstreamModel: "upstream",
    };
    await provider.saveModel(model, "model/one");
    await provider.deleteModel("model/one");
    await provider.deleteModelProvider("provider/one");
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/models/model%2Fone",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(request).toHaveBeenNthCalledWith(2, "/models/model%2Fone", {
      method: "DELETE",
    });
    expect(request).toHaveBeenNthCalledWith(
      3,
      "/model-providers/provider%2Fone",
      { method: "DELETE" },
    );
  });
});
