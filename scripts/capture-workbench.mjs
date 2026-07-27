import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

const address = "http://127.0.0.1:4173";
const now = "2026-07-27T12:00:00Z";
const server = spawn(
  "pnpm",
  ["--filter", "@zaw/browser", "dev", "--host", "127.0.0.1", "--port", "4173"],
  { stdio: "ignore" },
);

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  await mkdir("docs/screenshots", { recursive: true });
  for (const viewport of [
    { height: 900, name: "desktop", width: 1440 },
    { height: 1024, name: "tablet", width: 768 },
    { height: 844, name: "mobile", width: 390 },
  ]) {
    for (const theme of ["dark", "light", "hc", "system"]) {
      await capture(browser, viewport, theme);
    }
  }
  await captureManagement(browser, { height: 900, width: 1280 });
  await captureManagement(browser, { height: 844, width: 390 });
  await browser.close();
} finally {
  server.kill("SIGTERM");
}

async function capture(browser, viewport, theme) {
  const page = await browser.newPage({ viewport });
  await mockAPI(page);
  await page.addInitScript((selectedTheme) => {
    localStorage.setItem("zaw.theme", selectedTheme);
  }, theme);
  await page.goto(address);
  await page.waitForSelector(".workspace-row");
  if (viewport.width <= 860) {
    await page.locator('[data-action="toggle-left-panel"]').click();
  }
  await assertWorkbenchLayout(page, viewport.width, viewport.width <= 860);
  await page.screenshot({
    fullPage: true,
    path: `docs/screenshots/workbench-${viewport.name}-${theme}.png`,
  });
  await page.close();
}

async function captureManagement(browser, viewport) {
  const page = await browser.newPage({ viewport });
  await mockAPI(page);
  await page.goto(address);
  await page.waitForSelector(".workspace-row");
  await page.locator('[data-action="open-settings"]').first().click();
  await page.waitForSelector(".zaw-floating-window");
  await assertWorkbenchLayout(page, viewport.width, false);
  await assertFloatingLayout(page, viewport);
  await page.screenshot({
    fullPage: true,
    path: `docs/screenshots/workbench-${viewport.width}-management.png`,
  });
  await page.close();
}

async function mockAPI(page) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = fixtures(path);
    await route.fulfill({
      body: JSON.stringify(data),
      contentType: "application/json",
      status: 200,
    });
  });
}

async function assertWorkbenchLayout(page, viewportWidth, expectDrawer) {
  const layout = await page.evaluate(() => {
    const drawer = document.querySelector(".workspace-sidebar.mobile-open");
    const drawerBounds = drawer?.getBoundingClientRect();
    return {
      drawerLeft: drawerBounds?.left,
      drawerWidth: drawerBounds?.width,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  if (layout.scrollWidth > viewportWidth) {
    throw new Error(`Horizontal overflow: ${layout.scrollWidth} > ${viewportWidth}`);
  }
  if (expectDrawer && layout.drawerWidth !== viewportWidth) {
    throw new Error(`Mobile drawer width is ${layout.drawerWidth}, expected ${viewportWidth}`);
  }
  if (expectDrawer && layout.drawerLeft !== 0) {
    throw new Error(`Mobile drawer starts at ${layout.drawerLeft}, expected 0`);
  }
}

async function assertFloatingLayout(page, viewport) {
  const bounds = await page.locator(".zaw-floating-window").boundingBox();
  if (!bounds) throw new Error("Floating window has no layout bounds");
  if (
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.x + bounds.width > viewport.width ||
    bounds.y + bounds.height > viewport.height
  ) {
    throw new Error(`Floating window escaped viewport: ${JSON.stringify(bounds)}`);
  }
  if (viewport.width <= 540 && bounds.width !== viewport.width) {
    throw new Error("Mobile floating window does not fill the viewport");
  }
}

function fixtures(path) {
  if (path === "/api/v1/workspaces") return workspaces();
  if (path === "/api/v1/templates") return templates();
  if (path === "/api/v1/credentials") return credentials();
  if (path === "/api/v1/models") return [{ id: "gpt-5", name: "GPT-5" }];
  if (path === "/api/v1/provisioners") return provisioners();
  if (path === "/api/v1/provisioner-jobs") return jobs();
  if (path === "/api/v1/builds") return builds();
  if (path === "/api/v1/sessions") return { items: [], observedAt: now };
  return {};
}

function workspaces() {
  return [
    {
      agentHostState: "offline",
      agentHostTelemetry: {
        cpuPercent: 12.4,
        health: "ready",
        memoryBytes: 892338176,
      },
      createdAt: now,
      currentBuildId: "build-browser",
      desiredState: "running",
      id: "browser-js",
      name: "browser-js",
      observedState: "running",
      parameters: { cpu: 4 },
      sourceSnapshot: templates()[0].source,
      templateId: "ubuntu-24",
    },
    {
      agentHostState: "offline",
      createdAt: now,
      currentBuildId: "build-api",
      desiredState: "stopped",
      id: "api-go",
      name: "api-go",
      observedState: "stopped",
      parameters: { cpu: 2 },
      sourceSnapshot: templates()[0].source,
      templateId: "ubuntu-24",
    },
  ];
}

function templates() {
  return [
    {
      createdAt: now,
      description: "Incus Ubuntu 24 workspace",
      id: "ubuntu-24",
      name: "Ubuntu 24",
      source: {
        commit: "0123456789012345678901234567890123456789",
        kind: "git",
        url: "https://example.com/zaw-ubuntu.git",
      },
      updatedAt: now,
    },
  ];
}

function credentials() {
  return [
    {
      createdAt: now,
      id: "git-credential",
      kind: "token",
      metadata: {},
      name: "Git templates",
      updatedAt: now,
    },
  ];
}

function provisioners() {
  return [
    {
      capabilities: { incus: true, terraform: true },
      id: "local-incus",
      lastHeartbeatAt: now,
      name: "Local Incus",
      status: "online",
    },
  ];
}

function jobs() {
  return [
    {
      attempt: 1,
      buildId: "build-browser",
      claimedBy: "local-incus",
      id: "job-1",
    },
  ];
}

function builds() {
  return [
    {
      createdAt: now,
      error: "",
      id: "build-browser",
      logs: "Terraform apply completed.",
      operation: "create",
      provisionerId: "local-incus",
      status: "succeeded",
      workspaceId: "browser-js",
    },
  ];
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(address);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Workbench development server did not start");
}
