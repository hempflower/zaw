import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "go run ./e2e/real-api-server",
      url: "http://127.0.0.1:18080/healthz",
      reuseExistingServer: true,
    },
    {
      command:
        "ZAW_DEV_API_URL=http://127.0.0.1:18080 pnpm --filter @zaw/browser dev -- --host 127.0.0.1",
      port: 5173,
      reuseExistingServer: true,
    },
  ],
});
