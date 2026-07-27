import { describe, expect, it, vi } from "vitest";
import {
  AHPActionContributionRegistry,
  type AHPActionHandlerContext,
} from "./ahp-action-contribution-registry";
import { registerBuiltinAHPActionContributions } from "./ahp-action.contribution";
import type { IChatSessionService } from "./chat-session";
import type { IWorkspaceAttachmentService } from "./workspace-attachment";

describe("AHPActionContributionRegistry", () => {
  it("routes known terminal actions and ignores unknown action types", () => {
    const registry = new AHPActionContributionRegistry();
    registerBuiltinAHPActionContributions(registry);
    const context: AHPActionHandlerContext = {
      applyToolApproval: vi.fn(),
      applyToolCall: vi.fn(),
      attachmentService: {
        attached: () => null,
      } as unknown as IWorkspaceAttachmentService,
      changes: {},
      changesetResources: {},
      chatSessionService: {
        composition: () => ({ approvalMode: "ask" }),
        setActiveTurn: vi.fn(),
        update: vi.fn(),
      } as unknown as IChatSessionService,
      identityForChat: () => undefined,
      messages: {},
      reattachTerminals: vi.fn(),
      sessionTitles: {},
      sessions: {},
      terminals: {
        workspace: [{ output: "", resource: "terminal", title: "Terminal" }],
      },
    };

    registry.dispatch(
      "workspace",
      {
        action: { type: "terminal/data", data: "ready" },
        channel: "terminal",
        serverSeq: 1,
      },
      context,
    );
    registry.dispatch(
      "workspace",
      { action: { type: "unknown/action" }, channel: "terminal", serverSeq: 2 },
      context,
    );

    expect(context.terminals.workspace[0]?.output).toBe("ready");
  });
});
