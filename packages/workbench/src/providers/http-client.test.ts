import { describe, expect, it, vi } from "vitest";
import { HTTPClient, HTTPProviderError } from "./http-client";

describe("HTTPClient", () => {
  it("maps transport and response failures to stable provider errors", async () => {
    const client = new HTTPClient("/api");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network details")),
    );
    await expect(client.request("/templates")).rejects.toMatchObject({
      name: "HTTPProviderError",
      status: 0,
      message: "Unable to load templates",
    } satisfies Partial<HTTPProviderError>);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "secret server detail" }), {
          status: 500,
        }),
      ),
    );
    await expect(client.request("/credentials")).rejects.toMatchObject({
      name: "HTTPProviderError",
      status: 500,
      message: "Unable to load credentials",
    } satisfies Partial<HTTPProviderError>);
    vi.unstubAllGlobals();
  });
});
