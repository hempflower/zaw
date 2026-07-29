import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { vscodeAgentsWindowFixture } from "./fixtures/vscode-agents-window";

const fixtureWorkspace = {
  agentHostState: "online",
  agentHostTelemetry: { cpuPercent: 12, health: "healthy", memoryBytes: 1 },
  createdAt: "2026-07-28T08:00:00Z",
  currentBuildId: "build-one",
  desiredState: "running",
  id: "fixture-workspace",
  name: "zaw",
  observedState: "running",
  parameters: { branch: "main", worktree: "New Worktree" },
  sourceSnapshot: { kind: "git", url: "https://example.invalid/zaw.git" },
  templateId: "template-one",
  updatedAt: "2026-07-28T08:00:00Z",
};

const fixtureSessions = [
  ["pinned", "Implement agent platform", 8, "+12 files"],
  ["approval", "Review terminal command", 24, "Needs approval"],
  ["error", "Fix browser worker", 2, "Failed"],
  ["idle", "Refactor workspace tree", 0, "Waiting"],
  ["archived", "Initial architecture", 64, "Completed"],
].map(([id, title, status, activity], index) => ({
  activity,
  approval:
    id === "approval"
      ? { label: "Review terminal command\nApprove or reject this request" }
      : undefined,
  agentHostOnline: true,
  changes: { additions: index * 3, deletions: index, files: index },
  createdAt: `2026-07-${String(28 - index).padStart(2, "0")}T08:00:00Z`,
  modifiedAt: `2026-07-${String(28 - index).padStart(2, "0")}T09:00:00Z`,
  observedAt: "2026-07-28T09:00:00Z",
  provider: "Copilot",
  resource: `ahp-session:/${id}`,
  stale: false,
  status,
  title,
  workingDirectory: "/workspace/zaw",
  workspaceId: fixtureWorkspace.id,
}));

async function installAgentFixture(
  page: import("@playwright/test").Page,
  workspaces: unknown[] = [fixtureWorkspace],
) {
  let buildLogRequests = 0;
  const modelProviders: Record<string, unknown>[] = [
    {
      apiBase: "https://models.example.invalid",
      hasApiKey: true,
      id: "fixture-provider",
      kind: "openai",
      name: "Fixture AI",
    },
  ];
  const models: Record<string, unknown>[] = [
    {
      capabilities: {
        contextWindow: 128000,
        reasoning: true,
        reasoningEfforts: ["low", "medium", "high"],
        textInput: true,
      },
      id: "fixture-model",
      isDefault: true,
      name: "GPT Fixture",
      providerId: "fixture-provider",
      upstreamModel: "gpt-fixture",
    },
  ];
  await page.route("**/api/v1/auth/status", (route) =>
    route.fulfill({ json: { authenticated: true } }),
  );
  await page.route("**/api/v1/workspaces", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          json: { buildId: "fixture-build-new", id: "fixture-workspace-new" },
          status: 201,
        })
      : route.fulfill({ json: workspaces }),
  );
  await page.route("**/api/v1/workspaces/*/builds", (route) =>
    route.fulfill({ json: { id: "fixture-lifecycle-build" }, status: 202 }),
  );
  await page.route("**/api/v1/sessions?*", (route) =>
    route.fulfill({ json: { items: fixtureSessions } }),
  );
  await page.route("**/api/v1/templates", (route) =>
    route.fulfill({
      json: [
        {
          createdAt: "2026-07-28T08:00:00Z",
          description: "Fixture workspace template",
          id: "template-one",
          name: "Agents Template",
          source: {
            kind: "git",
            ref: "main",
            url: "https://example.invalid/zaw.git",
          },
          updatedAt: "2026-07-28T08:00:00Z",
        },
      ],
    }),
  );
  await page.route("**/api/v1/credentials", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/models", (route) => {
    if (route.request().method() === "POST") {
      const model = {
        ...route.request().postDataJSON(),
        id: "fixture-model-new",
      };
      models.push(model);
      return route.fulfill({ json: model, status: 201 });
    }
    return route.fulfill({ json: models });
  });
  await page.route("**/api/v1/model-providers", (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      const provider = {
        apiBase: input.apiBase,
        hasApiKey: true,
        id: "fixture-provider-new",
        kind: input.kind,
        name: input.name,
      };
      modelProviders.push(provider);
      return route.fulfill({ json: provider, status: 201 });
    }
    return route.fulfill({ json: modelProviders });
  });
  await page.route("**/api/v1/provisioners", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/provisioner-jobs", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/builds", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/builds/*/logs", (route) =>
    route.fulfill({
      json: {
        logs:
          ++buildLogRequests > 1
            ? "Terraform initialized\nWorkspace ready\nBuild complete\n"
            : "Terraform initialized\nWorkspace ready\n",
      },
    }),
  );
}

test("single-user login gates the workbench", async ({ page }) => {
  await page.route("**/api/v1/auth/status", (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  await page.route("**/api/v1/auth/login", async (route) => {
    const input = route.request().postDataJSON() as { password: string };
    await route.fulfill({
      json:
        input.password === "correct"
          ? { authenticated: true }
          : { error: "invalid password" },
      status: input.password === "correct" ? 200 : 401,
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ZAW" })).toBeVisible();
  const [loginBox, formBox] = await Promise.all([
    page.locator(".zaw-login").boundingBox(),
    page.locator(".zaw-login-form").boundingBox(),
  ]);
  const viewport = page.viewportSize()!;
  expect(loginBox).toEqual({
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  });
  expect(
    Math.abs(
      (formBox?.x ?? 0) + (formBox?.width ?? 0) / 2 - viewport.width / 2,
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      (formBox?.y ?? 0) + (formBox?.height ?? 0) / 2 - viewport.height / 2,
    ),
  ).toBeLessThanOrEqual(1);
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "The password is incorrect.",
  );
  await page.getByLabel("Password").fill("correct");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.locator(".zaw-workbench")).toBeVisible();
});

async function installFakeAgentHost(
  page: import("@playwright/test").Page,
  resourceState: "error" | "loading" | "ready" = "ready",
) {
  await page.addInitScript((resourceState) => {
    const fixtureWindow = window as unknown as {
      __fixtureRequests: string[];
    };
    fixtureWindow.__fixtureRequests = [];
    class FixtureWebSocket extends EventTarget {
      static readonly CLOSED = 3;
      static readonly CLOSING = 2;
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      readonly url: string;
      readyState = FixtureWebSocket.CONNECTING;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        queueMicrotask(() => {
          this.readyState = FixtureWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        });
      }

      send(raw: string): void {
        const request = JSON.parse(raw) as {
          id?: number;
          method?: string;
          params?: { channel?: string };
        };
        fixtureWindow.__fixtureRequests.push(
          `${request.method ?? "notification"}:${request.params?.channel ?? ""}`,
        );
        if (typeof request.id !== "number") return;
        let result: unknown = {};
        if (request.method === "initialize") {
          result = {
            defaultDirectory: "file:///workspace/zaw/",
            protocolVersion: "0.6.0",
            serverSeq: 1,
            snapshots: [
              {
                resource: "ahp-root://",
                state: {
                  agents: [
                    {
                      description: "Fixture Agent Host provider",
                      displayName: "GitHub Copilot",
                      provider: "copilot",
                    },
                  ],
                  terminals: [],
                },
              },
            ],
          };
        } else if (
          request.method === "resourceList" &&
          resourceState === "loading"
        ) {
          return;
        } else if (
          request.method === "resourceList" &&
          resourceState === "error"
        ) {
          queueMicrotask(() =>
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  error: {
                    code: -32603,
                    message: "Fixture workspace load failed",
                  },
                  id: request.id,
                  jsonrpc: "2.0",
                }),
              }),
            ),
          );
          return;
        } else if (request.method === "resourceList") {
          result = {
            entries: [
              { name: "packages", type: "directory" },
              { name: "README.md", type: "file" },
            ],
          };
        } else if (request.method === "resourceRead") {
          result = { data: "# Fixture workspace\n\nAgent platform details." };
        } else if (
          request.method === "subscribe" &&
          request.params?.channel?.startsWith("ahp-session:")
        ) {
          result = {
            snapshot: {
              state: {
                changesets: [{ uriTemplate: "ahp-changeset:/fixture" }],
                defaultChat: "ahp-chat:/fixture",
              },
            },
          };
        } else if (
          request.method === "subscribe" &&
          request.params?.channel === "ahp-changeset:/fixture"
        ) {
          result = {
            snapshot: {
              state: {
                files: [
                  {
                    edit: {
                      after: { uri: "file:///workspace/zaw/README.md" },
                      before: { uri: "file:///workspace/zaw/README.md" },
                      diff: "--- a/README.md\n+++ b/README.md\n-old\n+new\n+details",
                    },
                    id: "README.md",
                    reviewed: false,
                  },
                ],
                operations: [{ id: "stage" }, { id: "revert" }],
              },
            },
          };
        } else if (
          request.method === "subscribe" &&
          request.params?.channel === "ahp-chat:/fixture"
        ) {
          result = {
            snapshot: {
              fromSeq: 20,
              state: {
                activeTurn: {
                  id: "turn-active",
                  message: { text: "Run the verification suite" },
                  responseParts: [
                    {
                      kind: "toolCall",
                      toolCall: {
                        confirmationTitle: "Run in terminal",
                        displayName: "Terminal",
                        invocationMessage:
                          "The agent wants to run pnpm test:e2e",
                        status: "pending-confirmation",
                        toolCallId: "tool-fixture",
                        toolName: "terminal",
                      },
                    },
                  ],
                },
                draft: { text: "Check the visual diff too" },
                modifiedAt: "2026-07-28T09:00:00Z",
                resource: "ahp-chat:/fixture",
                status: 24,
                title: "Implement agent platform",
                turns: [
                  ...Array.from({ length: 18 }, (_, index) => ({
                    id: `turn-history-${index}`,
                    message: {
                      text: `Review migration checkpoint ${index + 1}`,
                    },
                    responseParts: [
                      {
                        content: `Checkpoint ${index + 1} is verified against the fixed VS Code source baseline.`,
                        id: `response-history-${index}`,
                        kind: "markdown",
                      },
                    ],
                    state: "complete",
                    usage: {},
                  })),
                  {
                    id: "turn-one",
                    message: { text: "Inspect the current architecture" },
                    responseParts: [
                      {
                        content:
                          "I inspected the workbench parts and found the remaining migration gaps.",
                        id: "response-one",
                        kind: "markdown",
                      },
                      {
                        kind: "toolCall",
                        toolCall: {
                          displayName: "Read source",
                          result: {
                            pastTenseMessage: "Read the VS Code source",
                            success: true,
                          },
                          status: "completed",
                          toolCallId: "tool-completed",
                          toolName: "read_file",
                        },
                      },
                      {
                        kind: "toolCall",
                        toolCall: {
                          displayName: "Run visual test",
                          result: {
                            error: { message: "Pixel mismatch" },
                            success: false,
                          },
                          status: "completed",
                          toolCallId: "tool-failed",
                          toolName: "test",
                        },
                      },
                      {
                        invocationMessage: "Cancelled by the user",
                        kind: "toolCall",
                        toolCall: {
                          displayName: "Deploy preview",
                          invocationMessage: "Cancelled by the user",
                          status: "cancelled",
                          toolCallId: "tool-cancelled",
                          toolName: "deploy",
                        },
                      },
                      {
                        kind: "toolCall",
                        toolCall: {
                          displayName: "Index repository",
                          invocationMessage: "Indexing files",
                          status: "streaming",
                          toolCallId: "tool-streaming",
                          toolName: "index",
                        },
                      },
                    ],
                    state: "complete",
                    usage: {},
                    error: { message: "Recovered from a transient failure" },
                  },
                ],
              },
            },
          };
        }
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ id: request.id, jsonrpc: "2.0", result }),
            }),
          ),
        );
      }

      close(): void {
        this.readyState = FixtureWebSocket.CLOSED;
        this.dispatchEvent(new Event("close"));
      }
    }
    Object.assign(FixtureWebSocket.prototype, {
      binaryType: "blob",
      bufferedAmount: 0,
      extensions: "",
      protocol: "",
    });
    window.WebSocket = FixtureWebSocket as unknown as typeof WebSocket;
  }, resourceState);
}

for (const [name, viewport] of [
  ["full-hd", { width: 1920, height: 1080 }],
  ["desktop", { width: 1440, height: 900 }],
  ["compact-desktop", { width: 1280, height: 800 }],
  ["small-desktop", { width: 1024, height: 768 }],
  ["tablet", { width: 820, height: 900 }],
  ["narrow desktop", { width: 390, height: 844 }],
] as const) {
  test(`renders ${name} workbench without horizontal overflow`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator(".zaw-workbench")).toBeVisible();
    await expect(page.locator(".zaw-workbench")).toHaveAttribute(
      "data-platform",
      "desktop",
    );
    await expect(page.locator(".zaw-workbench")).toHaveAttribute(
      "data-layout",
      "desktop",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: `test-results/workbench-${name}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}

test("Settings exposes all management pages and the workspace picker creates a workspace", async ({
  page,
}) => {
  await installAgentFixture(page);
  await installFakeAgentHost(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await expect(settings.locator(".management-toolbar")).toHaveCSS(
    "height",
    "35px",
  );
  const [settingsBox, settingsTitleBox] = await Promise.all([
    settings.boundingBox(),
    settings.locator(".management-title").boundingBox(),
  ]);
  expect(
    Math.abs(
      (settingsTitleBox?.x ?? 0) +
        (settingsTitleBox?.width ?? 0) / 2 -
        ((settingsBox?.x ?? 0) + (settingsBox?.width ?? 0) / 2),
    ),
  ).toBeLessThanOrEqual(1);
  await expect(settings.locator(".management-navigation-item")).toHaveText([
    "Common Settings",
    "Workspaces",
    "Templates",
    "Credentials",
    "Models",
    "Provisioners",
  ]);
  await settings.getByRole("button", { name: "Workspaces" }).click();
  const createWorkspaceAction = settings.getByRole("button", {
    name: "Create",
    exact: true,
  });
  await expect(createWorkspaceAction).toHaveText("Create");
  await expect(createWorkspaceAction).toHaveCSS("white-space", "nowrap");
  await settings
    .getByRole("button", { name: "View build logs for zaw" })
    .click();
  const buildLogs = page.getByRole("dialog", { name: "Build Logs" });
  await expect(buildLogs).toBeVisible();
  await expect(buildLogs.locator("..")).toHaveClass(/management-sheet-window/);
  await expect(buildLogs).toContainText("build-one");
  await expect(buildLogs.getByLabel("Workspace build logs")).toContainText(
    "Workspace ready",
  );
  await expect(buildLogs.getByLabel("Workspace build logs")).toContainText(
    "Build complete",
    { timeout: 4_000 },
  );
  await buildLogs.getByRole("button", { name: "Close dialog" }).click();
  await expect(settings).toBeVisible();
  const stopRequest = page.waitForRequest(
    (candidate) =>
      candidate.url().endsWith("/api/v1/workspaces/fixture-workspace/builds") &&
      candidate.method() === "POST",
  );
  await settings.getByRole("button", { name: "Stop zaw" }).click();
  const stopConfirmation = page.getByRole("dialog", {
    name: "Stop Workspace",
  });
  await stopConfirmation
    .getByRole("button", { name: "Stop Workspace" })
    .click();
  expect((await stopRequest).postDataJSON()).toEqual({ operation: "stop" });
  await expect(stopConfirmation).toBeHidden();
  const deleteRequest = page.waitForRequest(
    (candidate) =>
      candidate.url().endsWith("/api/v1/workspaces/fixture-workspace/builds") &&
      candidate.method() === "POST",
  );
  await settings.getByRole("button", { name: "Delete zaw" }).click();
  expect((await deleteRequest).postDataJSON()).toEqual({ operation: "delete" });
  await settings.getByRole("button", { name: "Models" }).click();
  await settings.getByRole("button", { name: "Add Provider" }).click();
  const addProvider = page.getByRole("dialog", {
    name: "Add Model Provider",
  });
  await addProvider.getByLabel("Provider ID").fill("deepseek-anthropic");
  await addProvider.getByLabel("Provider name").fill("DeepSeek Anthropic");
  await addProvider.getByLabel("Protocol").click();
  await addProvider.getByRole("option", { name: "Anthropic" }).click();
  await addProvider
    .getByLabel("API Base")
    .fill("https://api.deepseek.com/anthropic");
  await addProvider.getByLabel("API key").fill("sk-placeholder");
  const providerRequest = page.waitForRequest(
    (candidate) =>
      candidate.url().endsWith("/api/v1/model-providers") &&
      candidate.method() === "POST",
  );
  await addProvider
    .getByRole("button", { name: "Add Provider", exact: true })
    .click();
  expect((await providerRequest).postDataJSON()).toEqual({
    apiBase: "https://api.deepseek.com/anthropic",
    apiKey: "sk-placeholder",
    id: "deepseek-anthropic",
    kind: "anthropic",
    name: "DeepSeek Anthropic",
  });
  await expect(settings).toContainText("DeepSeek Anthropic");
  await settings
    .getByRole("button", { name: "Add model to DeepSeek Anthropic" })
    .click();
  const addModel = page.getByRole("dialog", { name: "Add Model" });
  await expect(addModel.locator("..")).toHaveClass(/management-sheet-window/);
  await expect(settings.locator(".management-sheet-window")).toHaveCount(0);
  await addModel.getByLabel("Model name").fill("DeepSeek V4 Pro");
  await addModel.getByLabel("Upstream model").fill("deepseek-v4-pro");
  await expect(addModel.getByLabel("Use as default model")).toHaveCount(0);
  await expect(addModel.getByLabel("Default reasoning effort")).toHaveCount(0);
  await addModel.getByLabel("Reasoning").check();
  await expect(addModel.getByLabel("Reasoning")).toHaveCSS(
    "appearance",
    "none",
  );
  await addModel.getByRole("button", { name: "Add effort" }).click();
  await addModel
    .getByRole("textbox", { name: "Reasoning effort" })
    .fill("high");
  await expect(addModel.locator(".management-sheet-content")).toHaveCSS(
    "overflow-y",
    "auto",
  );
  await addModel.screenshot({ path: "test-results/model-editor-window.png" });
  const modelRequest = page.waitForRequest(
    (candidate) =>
      candidate.url().endsWith("/api/v1/models") &&
      candidate.method() === "POST",
  );
  await addModel.getByRole("button", { name: "Add Model" }).click();
  expect((await modelRequest).postDataJSON()).toEqual(
    expect.objectContaining({
      name: "DeepSeek V4 Pro",
      providerId: "fixture-provider-new",
      upstreamModel: "deepseek-v4-pro",
      isDefault: false,
      capabilities: expect.objectContaining({
        reasoning: true,
        reasoningEfforts: ["high"],
      }),
    }),
  );
  await expect(settings).toContainText("DeepSeek V4 Pro");
  await settings.getByRole("button", { name: "Common Settings" }).click();
  await settings.getByLabel("Color theme").click();
  const themeMenu = settings.locator(".zaw-select-menu");
  const highContrastOption = themeMenu.getByRole("option", {
    name: "High Contrast",
    exact: true,
  });
  await expect(themeMenu).toBeVisible();
  await expect(highContrastOption).toHaveCSS("height", "22px");
  await expect(highContrastOption).toHaveCSS("white-space", "nowrap");
  const [contentBox, themeMenuBox] = await Promise.all([
    settings.locator(".management-content").boundingBox(),
    themeMenu.boundingBox(),
  ]);
  expect(themeMenuBox?.width ?? 0).toBeGreaterThanOrEqual(160);
  expect(
    (themeMenuBox?.x ?? 0) + (themeMenuBox?.width ?? 0),
  ).toBeLessThanOrEqual((contentBox?.x ?? 0) + (contentBox?.width ?? 0));
  await page.getByRole("option", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-zaw-theme", "light");
  await settings.getByRole("button", { name: "Close Settings" }).click();

  await page.getByLabel("Select workspace").click();
  const workspaceOptions = page.locator(
    ".agent-workspace-picker .zaw-dropdown-item",
  );
  await expect(workspaceOptions).toHaveCount(2);
  await expect(workspaceOptions.first()).toHaveCSS("height", "22px");
  await expect(
    page.locator(".agent-workspace-picker .zaw-dropdown-item small"),
  ).toHaveCount(0);
  await page.getByRole("option", { name: "Create New Workspace…" }).click();
  const create = page.getByRole("dialog", {
    name: "Create Workspace",
    exact: true,
  });
  await expect(create).toBeVisible();
  await create.getByLabel("Name").fill("New Agents Workspace");
  await create.getByLabel("Template", { exact: true }).click();
  await create.locator('button[role="option"][value="template-one"]').click();
  const request = page.waitForRequest(
    (candidate) =>
      candidate.url().endsWith("/api/v1/workspaces") &&
      candidate.method() === "POST",
  );
  await create
    .getByRole("button", { name: "Create Workspace", exact: true })
    .click();
  expect((await request).postDataJSON()).toEqual({
    name: "New Agents Workspace",
    parameters: {},
    templateId: "template-one",
  });
  await expect(create).toBeHidden();
});

test("agents window uses borderless icon actions and reclaims pane space", async ({
  page,
}) => {
  await installAgentFixture(page);
  await installFakeAgentHost(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const auxiliary = page.locator('[data-workbench-part="auxiliarybar"]');
  await expect(auxiliary).toBeHidden();
  await page.setViewportSize({ width: 820, height: 900 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(auxiliary).toBeHidden();
  await page.locator('summary[aria-label="Select workspace"]').click();
  await page.getByRole("option", { name: "zaw" }).click();
  await expect(auxiliary).toBeVisible();
  const primary = page.locator('[data-workbench-part="primary"]');
  const editor = page.getByRole("textbox", {
    name: "Describe what you want to build",
  });
  await editor.fill("Preserve this selection");
  await editor.evaluate((element) => {
    const input = element as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(5, 9);
  });
  const initialWidth = await primary.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  await expect(page.locator(".zaw-action-icon").first()).toHaveCSS(
    "border-top-width",
    "0px",
  );

  await page.getByRole("button", { name: "Toggle Agent Sessions" }).click();
  await expect
    .poll(() =>
      primary.evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(initialWidth);
  await expect(editor).toBeFocused();
  await expect
    .poll(() =>
      editor.evaluate((element) => {
        const input = element as HTMLTextAreaElement;
        return [input.selectionStart, input.selectionEnd];
      }),
    )
    .toEqual([5, 9]);

  await page.getByRole("button", { name: "Toggle Details" }).click();
  await expect(auxiliary).toBeHidden();
  await expect
    .poll(() =>
      primary.evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBe(1420);
  await expect(editor).toBeFocused();
  await page.getByRole("button", { name: "Toggle Details" }).click();
  await expect(auxiliary).toBeVisible();
  await expect
    .poll(() =>
      primary.evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeLessThan(1420);
  await expect(editor).toBeFocused();
  const [primaryGeometry, auxiliaryGeometry] = await Promise.all([
    primary.boundingBox(),
    auxiliary.boundingBox(),
  ]);
  expect(
    Math.round(
      (auxiliaryGeometry?.x ?? 0) -
        ((primaryGeometry?.x ?? 0) + (primaryGeometry?.width ?? 0)),
    ),
  ).toBe(8);
  await expect(primary).toHaveCSS("border-top-right-radius", "8px");
  await expect(auxiliary).toHaveCSS("border-top-left-radius", "8px");
  await expect(page.getByText("Customize", { exact: true })).toHaveCount(0);
});

test("keyboard-only workflow creates, switches, approves, opens a file, and collapses parts", async ({
  page,
}) => {
  await installAgentFixture(page);
  await installFakeAgentHost(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const workspacePicker = page.locator(
    'summary[aria-label="Select workspace"]',
  );
  await workspacePicker.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: "zaw" })).toBeFocused();
  await page.keyboard.press("Enter");

  const newComposer = page.getByRole("textbox", {
    name: "Describe what you want to build",
  });
  await expect(newComposer).toBeEnabled();
  await newComposer.focus();
  await page.keyboard.type("Verify the keyboard workflow");
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __fixtureRequests: string[] }
        ).__fixtureRequests.some((request) =>
          request.startsWith("createSession:ahp-session:/"),
        ),
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("textbox", { name: "Message the agent" }),
  ).toBeVisible();

  const allow = page.getByRole("button", { name: "Allow Run in terminal" });
  await allow.last().focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __fixtureRequests: string[] }
        ).__fixtureRequests.some(
          (request) => request === "dispatchAction:ahp-chat:/fixture",
        ),
      ),
    )
    .toBe(true);

  const existingSession = page.getByRole("button", {
    name: /Copilot, Implement agent platform/,
  });
  await existingSession.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message the agent" }),
  ).toBeVisible();

  const toggleDetails = page.getByRole("button", { name: "Toggle Details" });
  await toggleDetails.focus();
  await page.keyboard.press("Enter");
  const filesAction = page.getByRole("button", { name: "Files", exact: true });
  await filesAction.focus();
  await page.keyboard.press("Enter");
  const readme = page.getByRole("treeitem", { name: "README.md" });
  await expect(readme).toBeVisible();
  await readme.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Workspace preview" }),
  ).toBeVisible();
  await expect(page.getByText("# Fixture workspace")).toBeVisible();

  await page.keyboard.press("Control+`");
  await expect(page.locator('[data-workbench-part="panel"]')).toBeVisible();
  await page.keyboard.press("Control+`");
  await expect(page.locator('[data-workbench-part="panel"]')).toBeHidden();

  const toggleSessions = page.getByRole("button", {
    name: "Toggle Agent Sessions",
  });
  await toggleSessions.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-workbench-part="sidebar"]')).toBeHidden();
});

test("D7 restores only the sessions sidebar that responsive policy auto-hid", async ({
  page,
}) => {
  await installAgentFixture(page);
  await installFakeAgentHost(page);
  await page.addInitScript(() =>
    localStorage.setItem("sessions.layout.autoCollapseSessionsSidebar", "true"),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('summary[aria-label="Select workspace"]').click();
  await page.getByRole("option", { name: "zaw" }).click();

  const sidebar = page.locator('[data-workbench-part="sidebar"]');
  const readme = page.getByRole("treeitem", { name: "README.md" });
  await readme.click();
  await expect(sidebar).toBeHidden();
  await page.getByRole("button", { name: "Close View" }).click();
  await expect(sidebar).toBeVisible();

  await page.getByRole("button", { name: "Toggle Agent Sessions" }).click();
  await expect(sidebar).toBeHidden();
  await readme.click();
  await page.getByRole("button", { name: "Close View" }).click();
  await expect(sidebar).toBeHidden();
});

test("sidebar sash snaps closed and restores its persisted size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const sidebar = page.locator('[data-workbench-part="sidebar"]');
  const sash = page.locator('[data-sash="sidebar"]');
  const sashBox = await sash.boundingBox();
  expect(sashBox).not.toBeNull();

  await page.mouse.move(
    (sashBox?.x ?? 0) + (sashBox?.width ?? 0) / 2,
    (sashBox?.y ?? 0) + 100,
  );
  await page.mouse.down();
  await page.mouse.move(120, (sashBox?.y ?? 0) + 100, { steps: 8 });
  await page.mouse.up();
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");

  await page.getByRole("button", { name: "Toggle Agent Sessions" }).click();
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  const restoredWidth = (await sidebar.boundingBox())?.width;
  expect(restoredWidth).toBeGreaterThanOrEqual(270);

  await page.reload();
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width)
    .toBe(restoredWidth);
});

test("terminal action reveals a bottom panel across the full content area", async ({
  page,
}) => {
  await installAgentFixture(page);
  await installFakeAgentHost(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const titleBox = await page.locator(".agent-window-session").boundingBox();
  expect(
    Math.abs(
      (titleBox?.x ?? 0) +
        (titleBox?.width ?? 0) / 2 -
        page.viewportSize()!.width / 2,
    ),
  ).toBeLessThanOrEqual(1);
  const panel = page.locator('[data-workbench-part="panel"]');
  await page.locator('summary[aria-label="Select workspace"]').click();
  await page.getByRole("option", { name: "zaw" }).click();
  await expect(
    page.locator('[data-workbench-part="auxiliarybar"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "Toggle Terminal" }).click();
  await expect(panel).toBeVisible();
  await expect(page.locator(".agent-terminal-panel")).toBeVisible();
  await page.locator('summary[aria-label="Agent mode"]').click();
  const modeMenu = page.locator(".agent-mode-picker .zaw-dropdown-panel");
  await expect(modeMenu).toBeVisible();
  const [primaryBox, auxiliaryBox, panelBox] = await Promise.all([
    page.locator('[data-workbench-part="primary"]').boundingBox(),
    page.locator('[data-workbench-part="auxiliarybar"]').boundingBox(),
    panel.boundingBox(),
  ]);
  const modeMenuBox = await modeMenu.boundingBox();
  expect(
    Math.round((modeMenuBox?.y ?? 0) + (modeMenuBox?.height ?? 0)),
  ).toBeLessThanOrEqual(
    Math.round((primaryBox?.y ?? 0) + (primaryBox?.height ?? 0)),
  );
  expect(panelBox?.x).toBe(primaryBox?.x);
  expect(Math.round((panelBox?.x ?? 0) + (panelBox?.width ?? 0))).toBe(
    Math.round((auxiliaryBox?.x ?? 0) + (auxiliaryBox?.width ?? 0)),
  );
  const horizontalGap = Math.round(
    (auxiliaryBox?.x ?? 0) - ((primaryBox?.x ?? 0) + (primaryBox?.width ?? 0)),
  );
  const verticalGap = Math.round(
    (panelBox?.y ?? 0) - ((primaryBox?.y ?? 0) + (primaryBox?.height ?? 0)),
  );
  expect(horizontalGap).toBe(8);
  expect(verticalGap).toBe(horizontalGap);
  const auxiliarySash = await page
    .locator('[data-sash="auxiliary"]')
    .boundingBox();
  expect(
    Math.round((auxiliarySash?.y ?? 0) + (auxiliarySash?.height ?? 0)),
  ).toBe(Math.round((primaryBox?.y ?? 0) + (primaryBox?.height ?? 0)));
  const [sidebarBox, sidebarSash, panelSash] = await Promise.all([
    page.locator('[data-workbench-part="sidebar"]').boundingBox(),
    page.locator('[data-sash="sidebar"]').boundingBox(),
    page.locator('[data-sash="panel"]').boundingBox(),
  ]);
  const center = (box: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  expect(center(sidebarSash!).x).toBe(
    ((sidebarBox?.x ?? 0) + (sidebarBox?.width ?? 0) + (primaryBox?.x ?? 0)) /
      2,
  );
  expect(center(auxiliarySash!).x).toBe(
    ((primaryBox?.x ?? 0) + (primaryBox?.width ?? 0) + (auxiliaryBox?.x ?? 0)) /
      2,
  );
  expect(center(panelSash!).y).toBe(
    ((primaryBox?.y ?? 0) + (primaryBox?.height ?? 0) + (panelBox?.y ?? 0)) / 2,
  );

  await page.getByRole("button", { name: "Toggle Agent Sessions" }).click();
  const [expandedPanelBox, expandedPanelSash] = await Promise.all([
    panel.boundingBox(),
    page.locator('[data-sash="panel"]').boundingBox(),
  ]);
  expect(expandedPanelSash?.x).toBe(expandedPanelBox?.x);
  expect(expandedPanelSash?.width).toBe(expandedPanelBox?.width);
  expect(expandedPanelSash?.x).toBe(10);
  expect(
    Math.round((expandedPanelSash?.x ?? 0) + (expandedPanelSash?.width ?? 0)),
  ).toBe(page.viewportSize()!.width - 10);

  await page.getByRole("button", { name: "Toggle Agent Sessions" }).click();
  const [restoredPanelBox, restoredPanelSash] = await Promise.all([
    panel.boundingBox(),
    page.locator('[data-sash="panel"]').boundingBox(),
  ]);
  expect(restoredPanelSash?.x).toBe(restoredPanelBox?.x);
  expect(restoredPanelSash?.width).toBe(restoredPanelBox?.width);

  await page.getByRole("button", { name: "Toggle Details" }).click();
  const [withoutDetailsPanelBox, withoutDetailsPanelSash] = await Promise.all([
    panel.boundingBox(),
    page.locator('[data-sash="panel"]').boundingBox(),
  ]);
  expect(withoutDetailsPanelSash?.x).toBe(withoutDetailsPanelBox?.x);
  expect(withoutDetailsPanelSash?.width).toBe(withoutDetailsPanelBox?.width);

  await page.screenshot({
    path: "test-results/workbench-terminal-panel.png",
    fullPage: true,
  });
});

test("real mobile platform uses an accessible overlay drawer", async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("/");
  const shell = page.locator(".zaw-workbench");
  const sidebar = page.locator('[data-workbench-part="sidebar"]');
  await expect(shell).toHaveAttribute("data-platform", "mobile");
  await expect(shell).toHaveAttribute("data-layout", "phone");
  await expect(page.locator(".zaw-action").first()).toHaveCSS(
    "min-height",
    "44px",
  );
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("button", { name: "Toggle Agent Sessions" }).click();
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  await expect(shell).toHaveClass(/mobile-overlay-open/);
  await expect
    .poll(async () => (await sidebar.boundingBox())?.x ?? Number.NaN)
    .toBe(0);
  const sidebarBox = await sidebar.boundingBox();
  expect(sidebarBox?.x).toBe(0);
  expect(sidebarBox?.width).toBe(390);
  await page.getByRole("button", { name: "Toggle Agent Sessions" }).click();
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await page.screenshot({
    path: "test-results/workbench-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ height: 900, width: 820 });
  await expect(shell).toHaveAttribute("data-layout", "tablet");
  await page.setViewportSize({ height: 900, width: 1100 });
  await expect(shell).toHaveAttribute("data-platform", "desktop");
  await expect(shell).toHaveAttribute("data-layout", "desktop");
  await context.close();
});

test("deterministic agents fixture covers catalog visual states", async ({
  page,
}) => {
  await installAgentFixture(page);
  await page.addInitScript(() => {
    const key = (resource: string) =>
      `${encodeURIComponent("fixture-workspace")}|${encodeURIComponent(resource)}`;
    localStorage.setItem(
      "zaw.session-catalog.local-state",
      JSON.stringify({
        archived: [],
        pinned: [key("ahp-session:/pinned")],
        unread: [key("ahp-session:/approval")],
      }),
    );
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator(".agent-session-select")).toHaveCount(5);
  await expect(page.locator('[data-state="in-progress"]')).toHaveCount(1);
  await expect(page.locator('[data-state="input-needed"]')).toHaveCount(1);
  await expect(page.locator('[data-state="error"]')).toHaveCount(1);
  await expect(page.locator('[data-state="idle"]')).toHaveCount(2);
  await expect(page.locator(".agent-session-approval-row:visible")).toHaveCount(
    1,
  );
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Toggle Agent Sessions" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator('[data-workbench-part="auxiliarybar"]'),
  ).toHaveAttribute("aria-hidden", "true");
  await expect(
    page.locator('[data-pinned="true"] .agent-session-pinned-indicator'),
  ).toBeVisible();
  await expect(
    page
      .locator('[data-pinned="false"] .agent-session-pinned-indicator')
      .first(),
  ).toBeHidden();
  await expect(
    page.locator('[data-read="false"] .agent-session-unread-indicator'),
  ).toBeVisible();
  await page.locator(".agent-session-section").hover();
  const collapseSection = page.getByRole("button", { name: "Collapse zaw" });
  await expect(collapseSection).toBeVisible();
  await expect(page.locator(".agent-session-section-count")).toBeHidden();
  await collapseSection.click();
  await expect(page.locator(".agent-session-select")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand zaw" }).click();
  await expect(page.locator(".agent-session-select")).toHaveCount(5);
  await page.locator(".agent-session-select").first().hover();
  await expect(
    page.getByRole("button", { name: "Unpin session" }),
  ).toBeVisible();
  await page.locator(".agent-session-select").first().focus();
  await expect(page.locator(".agent-session-select").first()).toBeFocused();
  const sessionRows = page
    .locator('.agent-session-list [role="listitem"]')
    .filter({ has: page.locator(".agent-session-select") });
  await sessionRows
    .nth(1)
    .locator(".agent-session-select")
    .click({
      modifiers: ["Control"],
    });
  await sessionRows
    .nth(2)
    .locator(".agent-session-select")
    .click({
      modifiers: ["Control"],
    });
  await expect(page.locator('[data-selected="true"]')).toHaveCount(2);
  const dragPayload = await sessionRows.nth(1).evaluate((element) => {
    const dataTransfer = new DataTransfer();
    element.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, dataTransfer }),
    );
    return JSON.parse(
      dataTransfer.getData("application/vnd.zaw.agent-sessions+json"),
    ) as { sessions: unknown[] };
  });
  expect(dragPayload.sessions).toHaveLength(2);
  await sessionRows.nth(1).click({ button: "right" });
  const contextMenu = page.getByRole("menu", { name: "Session actions" });
  await expect(contextMenu).toBeVisible();
  await expect(contextMenu.getByRole("menuitem")).toHaveCount(3);
  await contextMenu.getByRole("menuitem", { name: "Archive session" }).click();
  await expect(page.locator('[data-archived="true"]')).toHaveCount(3);
  await page.getByRole("button", { name: "Filter Chats" }).click();
  await expect(
    page.getByRole("textbox", { name: "Filter chats" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Filter Chats" }).click();
  await page.screenshot({
    path: "test-results/workbench-agent-catalog-fixture.png",
    fullPage: true,
  });
  await page.locator(".agent-session-sidebar").screenshot({
    path: "test-results/region-session-catalog.png",
  });
});

test("workspace Auxiliary fixture covers empty, loading, and error states", async ({
  browser,
}) => {
  const emptyContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const emptyPage = await emptyContext.newPage();
  await installAgentFixture(emptyPage, []);
  await installFakeAgentHost(emptyPage);
  await emptyPage.goto("/");
  await expect(
    emptyPage.locator('[data-workbench-part="auxiliarybar"]'),
  ).toBeHidden();
  await emptyPage.screenshot({
    path: "test-results/region-workspace-empty.png",
    fullPage: true,
  });
  await emptyContext.close();

  for (const [state, message] of [
    ["loading", "Loading workspace resources…"],
    ["error", "Fixture workspace load failed"],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await installAgentFixture(page);
    await installFakeAgentHost(page, state);
    await page.goto("/");
    await page.locator('summary[aria-label="Select workspace"]').click();
    await page.getByRole("option", { name: "zaw" }).click();
    const auxiliary = page.locator('[data-workbench-part="auxiliarybar"]');
    await expect(auxiliary).toBeVisible();
    await expect(auxiliary.getByRole("status")).toHaveText(message);
    await auxiliary.screenshot({
      path: `test-results/region-workspace-${state}.png`,
    });
    await context.close();
  }
});

test("new composer container breakpoints remain source-aligned", async ({
  page,
}) => {
  await installAgentFixture(page);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/");
  const content = page.locator(".agent-new-session-content");
  await expect(
    content.locator('[aria-label="Language model"] .zaw-picker-action-label'),
  ).toHaveText("GPT Fixture");
  await expect(content.getByLabel("Agent", { exact: true })).toHaveCount(0);
  await expect(content.getByLabel("Reasoning effort")).toContainText("Low");
  await content.getByLabel("Language model").click();
  const modelOption = content.getByRole("option", { name: /GPT Fixture/ });
  await expect(modelOption).toContainText("Fixture AI");
  await expect(modelOption).toHaveCSS("white-space", "nowrap");
  await content.screenshot({
    path: "test-results/region-new-composer-model-picker.png",
  });
  await page.keyboard.press("Escape");
  for (const width of [800, 640, 480, 330, 240]) {
    await content.evaluate((element, targetWidth) => {
      element.style.width = `${targetWidth}px`;
    }, width);
    await expect
      .poll(() =>
        content.evaluate((element) =>
          Math.round(element.getBoundingClientRect().width),
        ),
      )
      .toBe(width);
    const agentLabel = page
      .locator(".agent-composer-picker-host .zaw-picker-action-label")
      .first();
    await expect(agentLabel).toHaveCSS(
      "display",
      width <= 330 ? "none" : "flex",
    );
    await content.screenshot({
      path: `test-results/region-new-composer-${width}.png`,
    });
  }
});

test("theme, DPR, and reduced-motion fixture matrix keeps Agents geometry stable", async ({
  browser,
}) => {
  for (const theme of ["dark", "light", "hc"] as const) {
    for (const deviceScaleFactor of [1, 2] as const) {
      const context = await browser.newContext({
        deviceScaleFactor,
        reducedMotion: "reduce",
        viewport: { height: 900, width: 1440 },
      });
      await context.addInitScript((selectedTheme) => {
        localStorage.setItem("zaw.theme", selectedTheme);
      }, theme);
      const page = await context.newPage();
      await page.clock.install({ time: new Date("2026-07-28T10:00:00Z") });
      await installAgentFixture(page);
      await installFakeAgentHost(page);
      await page.goto("/");
      await expect(
        page.locator(".agent-session-list [role=listitem]"),
      ).toHaveCount(6);
      const geometry = await page
        .locator('[data-workbench-part="primary"]')
        .evaluate((element) => {
          const style = getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          return {
            borderWidth: style.borderTopWidth,
            height: bounds.height,
            radius: style.borderTopLeftRadius,
            width: bounds.width,
          };
        });
      expect(geometry.borderWidth).toBe("1px");
      expect(geometry.radius).toBe("8px");
      expect(geometry.width).toBeGreaterThan(700);
      expect(geometry.height).toBeGreaterThan(800);
      await expect(
        page.locator('[data-state="input-needed"] .agent-session-status-icon'),
      ).toHaveCSS("animation-name", "none");
      await expect(page.locator(".zaw-workbench")).toHaveScreenshot(
        `agents-${theme}-${deviceScaleFactor}x.png`,
        {
          animations: "disabled",
          maxDiffPixelRatio: 0.005,
        },
      );
      await context.close();
    }
  }
});

test("fixed VS Code source annotations constrain the pixel baseline", async ({
  page,
}) => {
  await installAgentFixture(page);
  await installFakeAgentHost(page);
  await page.clock.install({ time: new Date("2026-07-28T10:00:00Z") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("zaw.theme", "dark"));
  await page.goto("/");
  const shell = page.locator(".zaw-workbench");
  const sidebar = page.locator('[data-workbench-part="sidebar"]');
  const primary = page.locator('[data-workbench-part="primary"]');
  const shellBox = await shell.boundingBox();
  const sidebarBox = await sidebar.boundingBox();
  const primaryBox = await primary.boundingBox();
  const source = vscodeAgentsWindowFixture.geometry;
  expect(Math.round(sidebarBox?.width ?? 0)).toBe(source.sidebarWidth);
  expect(Math.round(sidebarBox?.x ?? 0)).toBe(source.shellLeftInset);
  expect(
    Math.round(
      (primaryBox?.x ?? 0) - ((sidebarBox?.x ?? 0) + (sidebarBox?.width ?? 0)),
    ),
  ).toBe(source.partGap);
  expect(
    Math.round(
      (shellBox?.width ?? 0) -
        ((primaryBox?.x ?? 0) + (primaryBox?.width ?? 0)),
    ),
  ).toBe(source.shellRightInset);
  await expect(primary).toHaveCSS(
    "border-top-left-radius",
    `${source.panelRadius}px`,
  );
  await expect(shell).toHaveScreenshot("vscode-agents-window-dark.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.005,
  });
});

test("real control-plane and Agent Host complete the browser workflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.locator('summary[aria-label="Select workspace"]').click();
  await page.getByRole("option", { name: "real-api-workspace" }).click();
  const editor = page.getByRole("textbox", {
    name: "Describe what you want to build",
  });
  await expect(editor).toBeEnabled();
  await editor.fill("Create a session through the real API");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".agent-active-session-view")).toBeVisible();
  await expect(
    page.getByText("Response from the real Agent Host"),
  ).toBeVisible();

  const firstApproval = page.getByRole("button", { name: /^Allow / });
  await expect(firstApproval).toBeVisible();
  await firstApproval.click();
  await expect(page.locator(".tool-event.state-completed")).toBeVisible();

  const stop = page.getByRole("button", { name: "Stop generating" });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(stop).toBeHidden();

  const auxiliary = page.locator('[data-workbench-part="auxiliarybar"]');
  if (!(await auxiliary.isVisible()))
    await page.getByRole("button", { name: "Toggle Details" }).click();
  await expect(auxiliary).toBeVisible();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: "README.md" })).toBeVisible();
  await page.getByRole("treeitem", { name: "README.md" }).click();
  await expect(page.locator(".agent-preview-content")).toContainText(
    "Real API workspace",
  );

  await page.getByRole("button", { name: "Toggle Terminal" }).click();
  await page.getByRole("button", { name: "Toggle Agent Sessions" }).click();
  await expect(page.locator('[data-workbench-part="panel"]')).toBeVisible();
  await expect(page.locator('[data-workbench-part="sidebar"]')).toBeHidden();
  await page.reload();
  await expect(page.locator('[data-workbench-part="panel"]')).toBeVisible();
  await expect(page.locator('[data-workbench-part="sidebar"]')).toBeHidden();
  await page.getByRole("button", { name: "Toggle Agent Sessions" }).click();
  await page.locator(".agent-session-select").first().click();
  await expect(
    page.locator(
      ".agent-active-session-view:not([hidden]) .agent-session-context-status",
    ),
  ).toContainText("Agent host online");
  await expect(
    page
      .locator(
        ".agent-active-session-view:not([hidden]) .agent-mode-picker .zaw-picker-action-label",
      )
      .first(),
  ).toHaveText("Agent");
  if (!(await auxiliary.isVisible()))
    await page.getByRole("button", { name: "Toggle Details" }).click();
  await expect(auxiliary).toBeVisible();
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(
    page.locator(".agent-change-path", { hasText: "README.md" }),
  ).toBeVisible();
});

test("existing AHP session restores active chat and confirmation UI", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await installAgentFixture(page);
  await installFakeAgentHost(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /Implement agent platform/ }).click();
  await expect.poll(() => errors).toEqual([]);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __fixtureRequests: string[] })
            .__fixtureRequests,
      ),
    )
    .toContain("subscribe:ahp-chat:/fixture");
  await expect(page.locator(".agent-active-session-view")).toBeVisible();
  await expect(page.getByRole("button", { name: "Go Back" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Go Forward" })).toBeDisabled();
  await page.getByRole("button", { name: /Review terminal command/ }).click();
  await expect(page.locator(".agent-window-session-label")).toContainText(
    "Review terminal command",
  );
  await page.getByRole("button", { name: "Go Back" }).click();
  await expect(page.locator(".agent-window-session-label")).toContainText(
    "Implement agent platform",
  );
  await page.getByRole("button", { name: "Go Forward" }).click();
  await expect(page.locator(".agent-window-session-label")).toContainText(
    "Review terminal command",
  );
  await page.getByRole("button", { name: "Go Back" }).click();
  await expect(page.locator(".agent-window-session-label")).toContainText(
    "Implement agent platform",
  );
  await expect(
    page.getByText("Inspect the current architecture"),
  ).toBeVisible();
  await expect(
    page.getByRole("group", {
      name: /Chat confirmation dialog Run in terminal/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Allow Run in terminal" }),
  ).toBeVisible();
  const toolGroup = page.locator(".tool-event-group");
  await expect(toolGroup).toBeVisible();
  await toolGroup.locator(":scope > summary").click();
  await expect(page.locator(".tool-event.state-completed")).toBeVisible();
  await expect(page.locator(".tool-event.state-failed")).toBeVisible();
  await expect(page.locator(".tool-event.state-streaming")).toBeVisible();
  await expect(page.locator(".session-event.error")).toContainText(
    "Recovered from a transient failure",
  );
  const auxiliaryPart = page.locator('[data-workbench-part="auxiliarybar"]');
  await expect(auxiliaryPart).toBeHidden();
  await page.getByRole("button", { name: "Toggle Details" }).click();
  await expect(page.locator(".agent-changes-pane")).toBeVisible();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.locator(".agent-files-root strong")).toHaveText("zaw");
  const activeView = page.locator(".agent-active-session-view:not([hidden])");
  const transcript = activeView.locator(".agent-conversation-transcript");
  await transcript.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  const scrollDown = activeView.getByRole("button", {
    name: "Scroll to bottom",
  });
  await expect(scrollDown).toBeVisible();
  const [contentBox, scrollDownBox] = await Promise.all([
    activeView.locator(".agent-conversation-content").boundingBox(),
    scrollDown.boundingBox(),
  ]);
  expect(Math.round((contentBox?.x ?? 0) + (contentBox?.width ?? 0) - 32)).toBe(
    Math.round((scrollDownBox?.x ?? 0) + (scrollDownBox?.width ?? 0)),
  );
  await activeView.screenshot({
    path: "test-results/region-active-chat-scroll-down.png",
  });
  await scrollDown.click();
  await expect(scrollDown).toBeHidden();
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThan(2);
  await page.screenshot({
    path: "test-results/workbench-active-session-fixture.png",
    fullPage: true,
  });
  await activeView.screenshot({
    path: "test-results/region-active-chat.png",
  });
  await page.locator(".agent-files-pane").screenshot({
    path: "test-results/region-files.png",
  });
  const filesView = await page
    .locator('[data-workbench-view="zaw.workspace.files"]')
    .elementHandle();
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(page.locator(".agent-changes-pane")).toBeVisible();
  await expect(
    page.locator('[data-workbench-view="zaw.workspace.changes"]'),
  ).toBeFocused();
  await expect(page.locator(".agent-change-diff")).toHaveText("+2 −1");
  await page.locator(".agent-changes-pane").screenshot({
    path: "test-results/region-changes.png",
  });
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.locator(".agent-files-pane")).toBeVisible();
  await expect(
    page.locator('[data-workbench-view="zaw.workspace.files"]'),
  ).toBeFocused();
  expect(
    await page
      .locator('[data-workbench-view="zaw.workspace.files"]')
      .evaluate((element, original) => element === original, filesView),
  ).toBe(true);
  await page.getByRole("treeitem", { name: "README.md" }).click();
  await expect(page.locator(".agent-preview-pane")).toBeVisible();
  await expect(
    page.locator('[data-workbench-view="zaw.workspace.preview"]'),
  ).toBeFocused();
  await expect(page.locator(".agent-preview-content")).toContainText(
    "Fixture workspace",
  );
  await page.locator(".agent-preview-pane").screenshot({
    path: "test-results/region-preview.png",
  });

  await page.getByRole("button", { name: /Review terminal command/ }).click();
  await expect(auxiliaryPart).toBeHidden();
  await page.getByRole("button", { name: "Toggle Details" }).click();
  await expect(page.locator(".agent-changes-pane")).toBeVisible();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.locator(".agent-files-pane")).toBeVisible();
  await page.getByRole("button", { name: "Toggle Details" }).click();
  await expect(auxiliaryPart).toBeHidden();
  await page.getByRole("button", { name: /Implement agent platform/ }).click();
  await expect(page.locator(".agent-preview-pane")).toBeVisible();
  await page.getByRole("button", { name: /Review terminal command/ }).click();
  await expect(auxiliaryPart).toBeHidden();
});

test("new and active Agents surfaces have no serious accessibility violations", async ({
  page,
}) => {
  await installAgentFixture(page);
  await installFakeAgentHost(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const seriousViolations = async () =>
    (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
    ).violations
      .filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      )
      .map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      }));
  expect(await seriousViolations()).toEqual([]);

  await page.getByRole("button", { name: /Implement agent platform/ }).click();
  await expect(page.locator(".agent-active-session-view")).toBeVisible();
  expect(await seriousViolations()).toEqual([]);
});
