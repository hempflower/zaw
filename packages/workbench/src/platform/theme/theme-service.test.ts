// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { ThemeService } from "./theme-service";

describe("ThemeService", () => {
  it("applies and persists dark, light, high-contrast and system themes", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as unknown as Storage;
    const service = new ThemeService(storage);
    for (const theme of ["dark", "light", "hc", "system"] as const) {
      service.set(theme);
      expect(document.documentElement.dataset.zawTheme).toBe(theme);
      expect(values.get("zaw.theme")).toBe(theme);
    }
  });
});
