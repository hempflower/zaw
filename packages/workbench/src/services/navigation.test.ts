import { describe, expect, it, vi } from "vitest";
import type { ICommandService } from "../platform/commands/commands";
import { ContextKeyService } from "../platform/context-key/context-key-service";
import { NavigationContext } from "../workbench/context-keys";
import { ActiveSessionService } from "./active-session";
import { WorkbenchNavigationService } from "./navigation";

describe("WorkbenchNavigationService", () => {
  it("navigates session history and truncates forward history on a branch", async () => {
    const context = new ContextKeyService();
    const active = new ActiveSessionService(context);
    const executeCommand = vi.fn(
      async (
        _id: string,
        identity: { resource: string; workspaceID: string },
      ) => active.select(identity),
    );
    const navigation = new WorkbenchNavigationService(
      active,
      { executeCommand } as unknown as ICommandService,
      context,
    );
    const a = { resource: "ahp-session:/a", workspaceID: "one" };
    const b = { resource: "ahp-session:/b", workspaceID: "one" };
    const c = { resource: "ahp-session:/c", workspaceID: "one" };
    active.select(a);
    active.select(b);

    expect(context.getValue(NavigationContext.canGoBack.key)).toBe(true);
    await navigation.back();
    expect(active.current()).toEqual(a);
    expect(context.getValue(NavigationContext.canGoForward.key)).toBe(true);
    await navigation.forward();
    expect(active.current()).toEqual(b);

    await navigation.back();
    active.select(c);
    expect(navigation.canGoForward).toBe(false);
    expect(context.getValue(NavigationContext.canGoForward.key)).toBe(false);
    navigation.dispose();
  });
});
