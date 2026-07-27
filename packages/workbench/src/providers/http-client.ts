import { inject, injectable } from "inversify";

export const HTTPApiBase = Symbol.for("HTTPApiBase");

@injectable()
export class HTTPClient {
  constructor(@inject(HTTPApiBase) private readonly apiBase: string) {}

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiBase}${path}`, init);
    if (response.status === 204) return undefined as T;
    const payload = (await response.json()) as T | { error?: string };
    if (!response.ok) {
      const error = payload as { error?: string };
      throw new Error(error.error ?? `Request failed with ${response.status}`);
    }
    return payload as T;
  }
}
