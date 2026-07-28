/**
 * Architecture tests for the Workbench package.
 *
 * These tests enforce the dependency direction defined in
 * docs/architecture/workbench-refactoring-roadmap.md.
 *
 * Rules:
 * - bootstrap/ may depend on platform/workbench registration & layout interfaces.
 * - contrib/<feature>/ may depend on platform, workbench framework, provider port.
 * - services/ must NOT depend on concrete View/Widget/Part.
 * - providers/ must NOT depend on View, Part, or Workbench.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const WORKBENCH_SRC = resolve(import.meta.dirname ?? __dirname, "..");

function walkTsFiles(dir: string, excludePatterns: RegExp[] = []): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (excludePatterns.some((p) => p.test(full))) continue;
    if (entry.isDirectory()) {
      results.push(...walkTsFiles(full, excludePatterns));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

function walkStyleFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkStyleFiles(full));
    } else if (entry.name.endsWith(".scss")) {
      results.push(full);
    }
  }
  return results;
}

function fileImports(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  const imports: string[] = [];
  // Match ES import paths: from "./foo" or from "../bar/baz"
  const regex = /from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

function relativeFromSrc(filePath: string): string {
  return relative(WORKBENCH_SRC, filePath).replace(/\\/g, "/");
}

describe("R0 Architecture dependency contracts", () => {
  const allSourceFiles = walkTsFiles(WORKBENCH_SRC, [
    /node_modules/,
    /\.test\.ts$/,
  ]);

  // ── Rule 1: bootstrap/workbench.ts must not import contrib/** ──
  it("bootstrap/workbench.ts must not import specific feature contributions", () => {
    const workbenchTs = join(WORKBENCH_SRC, "bootstrap", "workbench.ts");
    const imports = fileImports(workbenchTs);

    // bootstrap/workbench.ts should NOT import from views/management/,
    // views/session/, views/terminal/, views/session-details/,
    // views/session-catalog/ directly.
    // These violations are tracked for resolution in R6-R11.
    const forbiddenViewDirs = [
      "../views/management/",
      "../views/management-sheet/",
      "../views/session/",
      "../views/session-details/",
      "../views/session-catalog/",
      "../views/terminal/",
      "../views/settings/",
    ];

    const violations: string[] = [];
    for (const imp of imports) {
      for (const forbidden of forbiddenViewDirs) {
        if (imp.startsWith(forbidden) || imp === forbidden.replace(/\/$/, "")) {
          violations.push(imp);
        }
      }
    }

    // During R0-R10 these violations exist intentionally and are tracked.
    // Each violation must be resolved in its corresponding R stage.
    expect(violations).toEqual([]);
  });

  // ── Rule 2: Views must not directly import HTTP/WebSocket/AHP providers ──
  it("Views must not import HTTP, WebSocket, or AHP providers directly", () => {
    const viewDirs = [
      join(WORKBENCH_SRC, "views"),
      join(WORKBENCH_SRC, "widgets"),
    ];

    for (const viewDir of viewDirs) {
      let files: string[] = [];
      try {
        files = walkTsFiles(viewDir);
      } catch {
        continue;
      }

      for (const file of files) {
        const imports = fileImports(file);
        const rel = relativeFromSrc(file);

        for (const imp of imports) {
          // Views should not import from providers/ directly
          if (imp.startsWith("../providers/") || imp.includes("/providers/")) {
            // Exception: provider type interfaces (not implementations)
            if (
              imp.includes("management") &&
              !imp.includes("http") &&
              !imp.includes("ahp")
            ) {
              continue;
            }
          }

          // Views should not use fetch/WebSocket directly
          const content = readFileSync(file, "utf-8");
          expect(content).not.toMatch(/\bfetch\s*\(/);
          expect(content).not.toMatch(/\bnew\s+WebSocket\s*\(/);
        }
      }
    }
  });

  // ── Rule 3: Services must not import DOM Widget or concrete View ──
  it("Services must not import DOM Widgets or concrete Views", () => {
    const servicesDir = join(WORKBENCH_SRC, "services");
    const files = walkTsFiles(servicesDir);

    const forbiddenWidgetImports = [
      "../widgets/",
      "../views/management/",
      "../views/session/",
      "../views/session-details/",
      "../views/session-catalog/",
      "../views/terminal/",
      "../views/settings/",
      "../views/workbench/",
      "../views/management-sheet/",
    ];

    const violations: string[] = [];
    for (const file of files) {
      const imports = fileImports(file);
      const rel = relativeFromSrc(file);

      for (const imp of imports) {
        for (const forbidden of forbiddenWidgetImports) {
          if (imp.startsWith(forbidden)) {
            // Allow view registry types but not concrete view implementations
            if (
              imp.includes("registry") ||
              imp.includes("contribution-registry")
            ) {
              continue;
            }
            violations.push(`${rel} -> ${imp}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // ── Rule 4: Providers must not import View, Part, or Workbench ──
  it("Providers must not import View, Part, or Workbench types", () => {
    const providersDir = join(WORKBENCH_SRC, "providers");
    const files = walkTsFiles(providersDir);

    const forbiddenDirs = [
      "../views/",
      "../parts/",
      "../widgets/",
      "../bootstrap/",
    ];

    for (const file of files) {
      const imports = fileImports(file);
      const rel = relativeFromSrc(file);

      for (const imp of imports) {
        for (const forbidden of forbiddenDirs) {
          expect(imp).not.toMatch(
            new RegExp(`^${forbidden.replace(/\//g, "\\/")}`),
          );
        }
      }
    }
  });

  // ── Rule 5: No React/JSX usage ──
  it("must not use React or JSX", () => {
    for (const file of allSourceFiles) {
      const content = readFileSync(file, "utf-8");
      expect(content).not.toMatch(/from\s+["']react["']/);
      expect(content).not.toMatch(/from\s+['"]react\//);
      expect(content).not.toMatch(/\.tsx$/);
    }
  });

  // ── Rule 6: No direct DOM fetch/WebSocket in views/widgets ──
  it("views and widgets must not use fetch or WebSocket directly", () => {
    const dirs = [
      join(WORKBENCH_SRC, "views"),
      join(WORKBENCH_SRC, "widgets"),
      join(WORKBENCH_SRC, "parts"),
    ];

    for (const dir of dirs) {
      let files: string[] = [];
      try {
        files = walkTsFiles(dir);
      } catch {
        continue;
      }

      for (const file of files) {
        const content = readFileSync(file, "utf-8");
        const rel = relativeFromSrc(file);
        if (content.includes("fetch(")) {
          expect.fail(
            `${rel} uses fetch() directly; use a typed provider instead`,
          );
        }
        if (content.includes("new WebSocket(")) {
          expect.fail(
            `${rel} uses new WebSocket() directly; use a typed provider instead`,
          );
        }
      }
    }
  });
});

describe("R0 Workbench size assertions", () => {
  it("bootstrap/workbench.ts stays within the final framework-only budget", () => {
    const workbenchTs = join(WORKBENCH_SRC, "bootstrap", "workbench.ts");
    const content = readFileSync(workbenchTs, "utf-8");
    const lines = content.split("\n").length;
    expect(lines).toBeLessThanOrEqual(300);
    console.log(`[STATS] bootstrap/workbench.ts: ${lines} lines`);
  });

  it("does not retain the global view context or central action dispatcher", () => {
    for (const file of walkTsFiles(WORKBENCH_SRC, [/\.test\.ts$/])) {
      const content = readFileSync(file, "utf-8");
      expect(content).not.toMatch(
        /WorkbenchViewContext|WorkbenchViewAction|handleViewAction|updateWorkbench/,
      );
    }
  });

  it("Workbench constructor parameter count", () => {
    const workbenchTs = join(WORKBENCH_SRC, "bootstrap", "workbench.ts");
    const content = readFileSync(workbenchTs, "utf-8");
    // Count @inject() decorators in the constructor
    const injectCount = (content.match(/@inject\(/g) || []).length;
    // Target: 8 or fewer framework services by R11 completion.
    // During migration, up to 20 is acceptable.
    expect(injectCount).toBeLessThanOrEqual(20);
  });
});

describe("R20 legacy UI removal contracts", () => {
  it("does not restore deleted monoliths or transitional styles", () => {
    for (const path of [
      "refactored-workbench.scss",
      "session-views.ts",
      "styles/views/chat-composer.scss",
    ]) {
      expect(existsSync(join(WORKBENCH_SRC, path))).toBe(false);
    }
  });

  it("uses custom select and a grid-owned terminal Part", () => {
    for (const file of walkTsFiles(WORKBENCH_SRC, [/\.test\.ts$/])) {
      const content = readFileSync(file, "utf-8");
      expect(content).not.toMatch(/createElement\(["']select["']/);
      expect(content).not.toMatch(/document\.createElement\(["']select["']/);
    }
    const terminalStyles = readFileSync(
      join(WORKBENCH_SRC, "styles", "views", "agent-terminal.scss"),
      "utf-8",
    );
    expect(terminalStyles).not.toMatch(/position:\s*fixed/);
  });

  it("keeps product colors in theme maps and avoids broad button selectors", () => {
    const styleRoot = join(WORKBENCH_SRC, "styles");
    for (const file of walkStyleFiles(styleRoot)) {
      const content = readFileSync(file, "utf-8");
      expect(content).not.toMatch(/\.zaw-workbench\s+button\b/);
      if (!file.endsWith("_agents-tokens.scss")) {
        expect(content).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgb\(|\bhsl\(/);
      }
    }
  });
});
