import type { Credential, Template } from "@zaw/protocol";
import { inject, injectable } from "inversify";
import type { IManagementProvider } from "../services/management";
import { HTTPClient } from "./http-client";

@injectable()
export class HTTPManagementProvider implements IManagementProvider {
  constructor(@inject(HTTPClient) private readonly client: HTTPClient) {}

  listCredentials() {
    return this.client.request<Credential[]>("/credentials");
  }

  listTemplates() {
    return this.client.request<Template[]>("/templates");
  }

  request<T>(path: string, init?: RequestInit) {
    return this.client.request<T>(path, init);
  }
}
