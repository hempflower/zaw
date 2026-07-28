import { describe, expect, it, vi } from "vitest";
import { HTTPClient } from "./http-client";
import { HTTPSessionCatalogProvider } from "./http-session-catalog-provider";

describe("HTTP Session Catalog provider", () => {
  it("follows opaque pagination cursors", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        items: [catalogItem("first")],
        nextCursor: "opaque+cursor",
      })
      .mockResolvedValueOnce({ items: [catalogItem("second")] });
    const client = { request } as unknown as HTTPClient;
    const items = await new HTTPSessionCatalogProvider(client).list();
    expect(items.map((item) => item.resource)).toEqual(["first", "second"]);
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/sessions?limit=200&cursor=opaque%2Bcursor",
    );
  });

  it("scopes every page of a provider refresh", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        items: [catalogItem("first")],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({ items: [] });
    await new HTTPSessionCatalogProvider({
      request,
    } as unknown as HTTPClient).list("copilot");
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/sessions?limit=200&provider=copilot",
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/sessions?limit=200&cursor=next&provider=copilot",
    );
  });
});

function catalogItem(resource: string) {
  return {
    workspaceId: "workspace",
    resource,
    provider: "copilot",
    title: resource,
    status: 1,
    createdAt: "2026-07-27T00:00:00Z",
    modifiedAt: "2026-07-27T00:00:00Z",
    observedAt: "2026-07-27T00:00:00Z",
    agentHostOnline: true,
    stale: false,
  };
}
