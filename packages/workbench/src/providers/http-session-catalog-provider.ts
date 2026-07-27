import { inject, injectable } from "inversify";
import type {
  ISessionCatalogProvider,
  SessionCatalogItem,
  SessionCatalogPage,
} from "../services/session-catalog";
import { HTTPClient } from "./http-client";

@injectable()
export class HTTPSessionCatalogProvider implements ISessionCatalogProvider {
  constructor(@inject(HTTPClient) private readonly client: HTTPClient) {}

  async list() {
    const items: SessionCatalogItem[] = [];
    let cursor = "";
    do {
      const query = new URLSearchParams({ limit: "200" });
      if (cursor) query.set("cursor", cursor);
      const page = await this.client.request<SessionCatalogPage>(
        `/sessions?${query.toString()}`,
      );
      items.push(...page.items);
      cursor = page.nextCursor ?? "";
    } while (cursor);
    return items;
  }
}
