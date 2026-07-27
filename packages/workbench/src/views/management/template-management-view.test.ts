// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { TemplateManagementView } from "./template-management-view";

describe("TemplateManagementView", () => {
  it("shows immutable source details and management actions", () => {
    const root = document.createElement("div");
    new TemplateManagementView(root, {
      templates: [
        {
          createdAt: "2026-07-27T00:00:00Z",
          description: "Ubuntu development environment",
          id: "template-one",
          name: "Ubuntu 24",
          source: {
            commit: "0123456789012345678901234567890123456789",
            credentialId: "credential-one",
            directory: "terraform",
            kind: "git",
            url: "https://example.com/template.git",
          },
          updatedAt: "2026-07-27T00:00:00Z",
        },
      ],
    });

    expect(root.textContent).toContain(
      "0123456789012345678901234567890123456789",
    );
    expect(root.textContent).toContain("credential-one");
    expect(
      root.querySelector('button[aria-label="Add template"]'),
    ).toBeTruthy();
    expect(
      root.querySelector('button[aria-label="Edit Ubuntu 24"]'),
    ).toBeTruthy();
    expect(
      root.querySelector('button[aria-label="Delete Ubuntu 24"]'),
    ).toBeTruthy();
  });
});
