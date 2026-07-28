import { describe, expect, it, vi } from "vitest";
import { ManagementService } from "./management-service";
import type { IManagementProvider } from "../../services/management";

function provider(): IManagementProvider {
  return {
    deleteCredential: vi.fn().mockResolvedValue(undefined),
    deleteModel: vi.fn().mockResolvedValue(undefined),
    deleteModelProvider: vi.fn().mockResolvedValue(undefined),
    deleteTemplate: vi.fn().mockResolvedValue(undefined),
    deleteWorkspace: vi.fn().mockResolvedValue(undefined),
    getCredential: vi.fn(),
    getTemplate: vi.fn(),
    listBuilds: vi.fn().mockResolvedValue([]),
    listCredentials: vi.fn().mockResolvedValue([]),
    listJobs: vi.fn().mockResolvedValue([]),
    listModels: vi.fn().mockResolvedValue([]),
    listModelProviders: vi.fn().mockResolvedValue([]),
    listProvisioners: vi.fn().mockResolvedValue([]),
    listTemplates: vi.fn().mockResolvedValue([]),
    saveCredential: vi.fn().mockResolvedValue({}),
    saveModel: vi.fn().mockResolvedValue({}),
    saveModelProvider: vi.fn().mockResolvedValue({}),
    saveTemplate: vi.fn().mockResolvedValue({}),
    startWorkspace: vi.fn().mockResolvedValue(undefined),
    stopWorkspace: vi.fn().mockResolvedValue(undefined),
  } as unknown as IManagementProvider;
}

describe("ManagementService", () => {
  it("closes dirty sheets without an unsaved-changes prompt", () => {
    const service = new ManagementService(provider());
    service.addCredential();
    service.setDirty(true);
    service.closeSheet();
    expect(service.sheet).toBeNull();
    expect(service.dirty).toBe(false);
    expect(service.editingCredential).toBeNull();
  });

  it("passes a secret only to the typed provider input", async () => {
    const fake = provider();
    const service = new ManagementService(fake);
    await service.saveCredential("API", "token", {}, { token: "secret" });
    expect(fake.saveCredential).toHaveBeenCalledWith({
      name: "API",
      kind: "token",
      metadata: {},
      secret: { token: "secret" },
    });
    expect(JSON.stringify(service)).not.toContain("secret");
  });

  it("keeps prior data on failure and ignores a stale reload result", async () => {
    let resolveFirst!: (value: []) => void;
    const first = new Promise<[]>((resolve) => (resolveFirst = resolve));
    const fake = provider();
    vi.mocked(fake.listTemplates)
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce([
        { id: "new", name: "New", description: "", source: { kind: "git" } },
      ] as never)
      .mockRejectedValueOnce(new Error("offline"));
    const service = new ManagementService(fake);
    const stale = service.reload();
    await service.reload();
    expect(service.modelsState).toBe("ready");
    resolveFirst([]);
    await stale;
    expect(service.templates.map((template) => template.id)).toEqual(["new"]);
    await expect(service.reload()).rejects.toThrow("offline");
    expect(service.modelsState).toBe("error");
    expect(service.modelsError).toBe("offline");
    expect(service.templates.map((template) => template.id)).toEqual(["new"]);
  });

  it("runs template and credential CRUD through its service owner", async () => {
    const fake = provider();
    const service = new ManagementService(fake);
    await service.saveTemplate("Template", "desc", {
      kind: "git",
      url: "https://example.test/repo",
    });
    expect(fake.saveTemplate).toHaveBeenCalledWith({
      name: "Template",
      description: "desc",
      source: { kind: "git", url: "https://example.test/repo" },
    });
    service.requestDeleteTemplate("template-one");
    await service.deleteTemplate();
    expect(fake.deleteTemplate).toHaveBeenCalledWith("template-one");
    service.requestDeleteCredential("credential-one");
    await service.deleteCredential("credential-one");
    expect(fake.deleteCredential).toHaveBeenCalledWith("credential-one");
  });

  it("creates model providers and default models through typed inputs", async () => {
    const fake = provider();
    const service = new ManagementService(fake);
    service.addModelProvider();
    await service.saveModelProvider(
      "deepseek",
      "DeepSeek Anthropic",
      "anthropic",
      "https://api.deepseek.com/anthropic",
      "sk-placeholder",
    );
    expect(fake.saveModelProvider).toHaveBeenCalledWith(
      {
        id: "deepseek",
        name: "DeepSeek Anthropic",
        kind: "anthropic",
        apiBase: "https://api.deepseek.com/anthropic",
        apiKey: "sk-placeholder",
      },
      undefined,
    );
    await service.saveModel(
      "provider-one",
      "DeepSeek V4 Pro",
      "deepseek-v4-pro",
      true,
      { contextWindow: 128000, textInput: true, tools: true },
    );
    expect(fake.saveModel).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "provider-one",
        upstreamModel: "deepseek-v4-pro",
        isDefault: true,
        capabilities: expect.objectContaining({ textInput: true, tools: true }),
      }),
      undefined,
    );
  });

  it("edits and deletes provider-grouped models", async () => {
    const fake = provider();
    fake.listModelProviders = vi.fn().mockResolvedValue([
      {
        apiBase: "https://example.test",
        hasApiKey: true,
        id: "provider-one",
        kind: "openai",
        name: "Provider One",
      },
    ]);
    fake.listModels = vi.fn().mockResolvedValue([
      {
        capabilities: { contextWindow: 128000, textInput: true },
        id: "model-one",
        isDefault: false,
        name: "Model One",
        providerId: "provider-one",
        upstreamModel: "model-one-upstream",
      },
    ]);
    const service = new ManagementService(fake);
    await service.reload();
    service.addModel("provider-one");
    expect(service.modelProviderID).toBe("provider-one");
    service.editModel("model-one");
    expect(service.editingModel?.id).toBe("model-one");
    await service.saveModel(
      "provider-one",
      "Renamed Model",
      "renamed-model",
      false,
      { contextWindow: 128000, textInput: true },
    );
    expect(fake.saveModel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Renamed Model" }),
      "model-one",
    );
    await service.deleteModel("model-one");
    await service.deleteModelProvider("provider-one");
    expect(fake.deleteModel).toHaveBeenCalledWith("model-one");
    expect(fake.deleteModelProvider).toHaveBeenCalledWith("provider-one");
  });
});
