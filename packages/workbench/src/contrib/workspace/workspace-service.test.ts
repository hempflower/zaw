import { describe, expect, it, vi } from "vitest";
import type { IWorkspaceProvider } from "../../services/workspace";
import type { IWorkspaceAttachmentService } from "../../services/workspace-attachment";
import { ContextKeyService } from "../../platform/context-key/context-key-service";
import { ContextKeyExpr } from "../../platform/context-key/context-key";
import { WorkspaceContext } from "../../workbench/context-keys";
import type { ITerminalService } from "../terminal/terminal-service";
import type { IWorkspaceResourceService } from "./workspace-resource-service";
import { WorkspaceService } from "./workspace-service";

describe("WorkspaceService", () => {
  it("creates through the provider and refreshes the workspace catalog", async () => {
    const created = { buildId: "build-one", id: "workspace-one" };
    const provider = {
      create: vi.fn().mockResolvedValue(created),
      list: vi
        .fn()
        .mockResolvedValue([{ id: "workspace-one", name: "Workspace One" }]),
    } as unknown as IWorkspaceProvider;
    const service = new WorkspaceService(
      provider,
      {
        onClose: () => () => undefined,
      } as unknown as IWorkspaceAttachmentService,
      {} as IWorkspaceResourceService,
      {} as ITerminalService,
    );
    await expect(
      service.create({
        name: "Workspace One",
        parameters: {},
        templateId: "template-one",
      }),
    ).resolves.toEqual(created);
    expect(provider.create).toHaveBeenCalledWith({
      name: "Workspace One",
      parameters: {},
      templateId: "template-one",
    });
    expect(service.workspaces).toHaveLength(1);
  });

  it("returns online when a closed workspace attachment reconnects", async () => {
    let closed: ((workspaceID: string) => void) | undefined;
    const hostOne = {};
    const hostTwo = {};
    const attach = vi
      .fn()
      .mockResolvedValueOnce(hostOne)
      .mockResolvedValueOnce(hostTwo);
    const attachment = {
      attach,
      onClose: (listener: (workspaceID: string) => void) => {
        closed = listener;
        return () => undefined;
      },
    } as unknown as IWorkspaceAttachmentService;
    const resources = {
      loadWorkspace: vi.fn().mockResolvedValue(undefined),
    } as unknown as IWorkspaceResourceService;
    const terminals = {
      reattach: vi.fn().mockResolvedValue(undefined),
    } as unknown as ITerminalService;
    const keys = new ContextKeyService();
    const service = new WorkspaceService(
      { list: vi.fn().mockResolvedValue([]) } as unknown as IWorkspaceProvider,
      attachment,
      resources,
      terminals,
      keys,
    );
    await service.select("workspace-one");
    expect(service.selectedWorkspaceID).toBe("workspace-one");
    expect(keys.evaluate(ContextKeyExpr.has(WorkspaceContext.online.key))).toBe(
      true,
    );
    closed!("workspace-one");
    expect(keys.evaluate(ContextKeyExpr.has(WorkspaceContext.online.key))).toBe(
      false,
    );
    await service.select("workspace-two");
    expect(attach).toHaveBeenNthCalledWith(2, "workspace-two");
    expect(resources.loadWorkspace).toHaveBeenLastCalledWith(
      "workspace-two",
      hostTwo,
      undefined,
    );
    expect(terminals.reattach).toHaveBeenLastCalledWith(
      "workspace-two",
      hostTwo,
    );
    expect(keys.evaluate(ContextKeyExpr.has(WorkspaceContext.online.key))).toBe(
      true,
    );
  });
});
