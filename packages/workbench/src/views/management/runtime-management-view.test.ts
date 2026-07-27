// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { RuntimeManagementView } from "./runtime-management-view";

const options = {
  builds: [
    {
      createdAt: "2026-07-27T00:00:00Z",
      error: "terraform failed",
      id: "build-one",
      logs: "provider diagnostic",
      operation: "create",
      provisionerId: "provisioner-one",
      status: "failed",
      workspaceId: "workspace-one",
    },
  ],
  jobs: [
    {
      attempt: 1,
      buildId: "build-one",
      claimedBy: "provisioner-one",
      id: "job-one",
      status: "failed",
    },
  ],
  provisioners: [
    {
      capabilities: { terraform: true },
      id: "provisioner-one",
      lastHeartbeatAt: "2026-07-27T00:00:00Z",
      name: "Local Incus",
      status: "online",
    },
  ],
  workspaces: [],
};

describe("RuntimeManagementView", () => {
  it("shows provisioner and job diagnostics", () => {
    const root = document.createElement("div");
    new RuntimeManagementView(root, {
      ...options,
      kind: "provisioners",
    });
    expect(root.textContent).toContain("Local Incus");
    expect(root.textContent).toContain("job-one");
    expect(root.textContent).toContain("terraform");
  });

  it("shows build logs and failure details", () => {
    const root = document.createElement("div");
    new RuntimeManagementView(root, {
      ...options,
      kind: "builds",
    });
    expect(root.textContent).toContain("terraform failed");
    expect(root.textContent).toContain("provider diagnostic");
  });
});
