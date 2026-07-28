import { describe, expect, it } from "vitest";
import type { IAgentHost } from "../../services/agent-host";
import type { IWorkspaceAttachmentService } from "../../services/workspace-attachment";
import type { IDetailViewService } from "./detail-view-service";
import { WorkspaceResourceService } from "./workspace-resource-service";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("WorkspaceResourceService", () => {
  it("ignores a stale concurrent workspace load", async () => {
    const firstFiles = deferred<Array<{ name: string; type: "file" }>>();
    const firstChanges = deferred<{
      files: [];
      operations: [];
      resource: string;
    }>();
    const first = {
      listResources: () => firstFiles.promise,
      loadChangeset: () => firstChanges.promise,
      resourceURI: (path: string) => `first:/${path}`,
    } as unknown as IAgentHost;
    const second = {
      listResources: async () => [{ name: "new.ts", type: "file" as const }],
      loadChangeset: async () => ({
        files: [],
        operations: [],
        resource: "changes:/two",
        scope: "workspace" as const,
      }),
      resourceURI: (path: string) => `second:/${path}`,
    } as unknown as IAgentHost;
    const service = new WorkspaceResourceService(
      {} as IWorkspaceAttachmentService,
      {} as IDetailViewService,
    );
    const stale = service.loadWorkspace("workspace-one", first, "session:/one");
    expect(service.workspaceStates["workspace-one"]).toBe("loading");
    await service.loadWorkspace("workspace-one", second, "session:/two");
    firstFiles.resolve([{ name: "old.ts", type: "file" }]);
    firstChanges.resolve({
      files: [],
      operations: [],
      resource: "changes:/one",
    });
    await stale;
    expect(service.files["workspace-one"]).toEqual([
      { name: "new.ts", type: "file", uri: "second:/new.ts" },
    ]);
    expect(service.workspaceStates["workspace-one"]).toBe("ready");
  });

  it("publishes an error without discarding the last workspace snapshot", async () => {
    const service = new WorkspaceResourceService(
      {} as IWorkspaceAttachmentService,
      {} as IDetailViewService,
    );
    const ready = {
      listResources: async () => [{ name: "README.md", type: "file" as const }],
      loadChangeset: async () => ({ files: [], operations: [], resource: "" }),
      resourceURI: (path: string) => `file:/${path}`,
    } as unknown as IAgentHost;
    await service.loadWorkspace("workspace-one", ready);
    const failing = {
      listResources: async () => {
        throw new Error("Workspace fixture failed");
      },
    } as unknown as IAgentHost;

    await expect(
      service.loadWorkspace("workspace-one", failing),
    ).rejects.toThrow("Workspace fixture failed");
    expect(service.workspaceStates["workspace-one"]).toBe("error");
    expect(service.workspaceErrors["workspace-one"]).toBe(
      "Workspace fixture failed",
    );
    expect(service.files["workspace-one"]).toHaveLength(1);
  });

  it("allows different directories to load concurrently", async () => {
    const sourceChildren = deferred<Array<{ name: string; type: "file" }>>();
    const testChildren = deferred<Array<{ name: string; type: "file" }>>();
    const host = {
      listResources: (uri: string) =>
        uri === "file:/src/" ? sourceChildren.promise : testChildren.promise,
      resourceURI: (path: string, base: string) => `${base}${path}`,
    } as unknown as IAgentHost;
    const attachment = {
      attached: () => host,
      attachedWorkspaceID: () => "workspace-one",
    } as unknown as IWorkspaceAttachmentService;
    const service = new WorkspaceResourceService(
      attachment,
      {} as IDetailViewService,
    );

    const sourceLoad = service.openDirectory("file:/src/");
    const testLoad = service.openDirectory("file:/test/");
    testChildren.resolve([{ name: "app.test.ts", type: "file" }]);
    await testLoad;
    sourceChildren.resolve([{ name: "app.ts", type: "file" }]);
    await sourceLoad;

    expect(service.fileChildren["workspace-one"]["file:/src/"]).toEqual([
      { name: "app.ts", type: "file", uri: "file:/src/app.ts" },
    ]);
    expect(service.fileChildren["workspace-one"]["file:/test/"]).toEqual([
      {
        name: "app.test.ts",
        type: "file",
        uri: "file:/test/app.test.ts",
      },
    ]);
  });
});
