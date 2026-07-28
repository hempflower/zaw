import { inject, injectable } from "inversify";

export const HTTPApiBase = Symbol.for("HTTPApiBase");

/** Stable application error. Views never receive a Response or server payload. */
export class HTTPProviderError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
  ) {
    super(`Unable to ${operation}`);
    this.name = "HTTPProviderError";
  }
}

@injectable()
export class HTTPClient {
  constructor(@inject(HTTPApiBase) private readonly apiBase: string) {}

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.apiBase}${path}`, init);
    } catch {
      throw new HTTPProviderError(0, operationFor(path, init?.method));
    }
    if (response.status === 204) return undefined as T;
    let payload: T | undefined;
    try {
      payload = (await response.json()) as T;
    } catch {
      if (response.ok)
        throw new HTTPProviderError(
          response.status,
          operationFor(path, init?.method),
        );
    }
    if (!response.ok) {
      throw new HTTPProviderError(
        response.status,
        operationFor(path, init?.method),
      );
    }
    return payload as T;
  }
}

function operationFor(path: string, method = "GET"): string {
  const resource = path.split("/").filter(Boolean).at(0) ?? "resource";
  return method === "DELETE"
    ? `delete ${resource}`
    : method === "POST"
      ? `save ${resource}`
      : `load ${resource}`;
}
