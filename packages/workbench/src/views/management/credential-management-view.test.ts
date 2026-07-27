// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { CredentialManagementView } from "./credential-management-view";

describe("CredentialManagementView", () => {
  it("shows metadata and usage without rendering secret values", () => {
    const root = document.createElement("div");
    new CredentialManagementView(root, {
      credentials: [
        {
          createdAt: "2026-07-27T00:00:00Z",
          id: "credential-one",
          kind: "ssh_key",
          metadata: { fingerprint: "SHA256:public", username: "git" },
          name: "Private Git",
          updatedAt: "2026-07-27T00:00:00Z",
        },
      ],
      templates: [
        {
          createdAt: "2026-07-27T00:00:00Z",
          description: "Private source",
          id: "template-one",
          name: "Ubuntu 24",
          source: {
            commit: "0123456789012345678901234567890123456789",
            credentialId: "credential-one",
            kind: "git",
            url: "ssh://git@example.com/template.git",
          },
          updatedAt: "2026-07-27T00:00:00Z",
        },
      ],
    });
    expect(root.textContent).toContain("SHA256:public");
    expect(root.textContent).toContain("Ubuntu 24");
    expect(root.textContent).toContain("no automatic rotation");
    expect(
      root.querySelector('button[aria-label="Delete Private Git"]'),
    ).toBeTruthy();
    expect(root.textContent).not.toContain("privateKey");
  });
});
