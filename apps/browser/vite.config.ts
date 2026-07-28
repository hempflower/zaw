import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, ".", "");

  return {
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: environment.ZAW_DEV_API_URL || "http://127.0.0.1:8080",
          changeOrigin: true,
          rewriteWsOrigin: true,
          ws: true,
        },
      },
    },
  };
});
