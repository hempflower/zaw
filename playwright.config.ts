import { defineConfig } from "@playwright/test";

const reuseExistingServer = process.env.CI !== "true";

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
      reuseExistingServer,
    },
    {
      command:
        "ZAW_DEV_API_URL=http://127.0.0.1:18080 pnpm --filter @zaw/browser dev -- --host 127.0.0.1 --strictPort",
      url: "http://127.0.0.1:5173",
      reuseExistingServer,
    },
  ],
});
