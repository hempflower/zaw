import { describe, expect, it } from "vitest";
import type { AHPAction, IAgentHost, IAgentHostProvider } from "./agent-host";
import {
  ActiveSessionService,
  parseSessionIdentityKey,
  sessionIdentityKey,
} from "./active-session";
import {
  StaleWorkspaceAttachmentError,
  WorkspaceAttachmentService,
} from "./workspace-attachment";
import { WorkspaceUIStateService } from "./workspace-ui-state";

class FakeHost {
  closed = false;
  private actions: Array<(action: AHPAction) => void> = [];
  private closes: Array<() => void> = [];

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closes) listener();
  }

  isClosed() {
    return this.closed;
  }

  onAction(listener: (action: AHPAction) => void) {
    this.actions.push(listener);
    return () => undefined;
  }

  onClose(listener: () => void) {
    this.closes.push(listener);
    return () => undefined;
  }

  emit(action: AHPAction) {
    for (const listener of this.actions) listener(action);
  }
}

class DeferredProvider implements IAgentHostProvider {
  readonly pending = new Map<string, { resolve: (host: IAgentHost) => void }>();

  connect(workspaceID: string) {
    return new Promise<IAgentHost>((resolve) => {
      this.pending.set(workspaceID, { resolve });
    });
  }
}

describe("multi-workspace services", () => {
  it("uses a composite Session identity", () => {
    const identity = {
      workspaceID: "workspace/a",
      resource: "ahp-session:/same",
    };
    expect(parseSessionIdentityKey(sessionIdentityKey(identity))).toEqual(
      identity,
    );
    const active = new ActiveSessionService();
    active.select(identity);
    expect(active.isActive(identity)).toBe(true);
    expect(active.isActive({ ...identity, workspaceID: "workspace/b" })).toBe(
      false,
    );
  });

  it("keeps only the newest Workspace attachment", async () => {
    const provider = new DeferredProvider();
    const service = new WorkspaceAttachmentService(provider);
    const first = service.attach("first");
    const second = service.attach("second");
    const secondHost = new FakeHost();
    provider.pending
      .get("second")!
      .resolve(secondHost as unknown as IAgentHost);
    await expect(second).resolves.toBe(secondHost);
    const firstHost = new FakeHost();
    provider.pending.get("first")!.resolve(firstHost as unknown as IAgentHost);
    await expect(first).rejects.toBeInstanceOf(StaleWorkspaceAttachmentError);
    expect(firstHost.closed).toBe(true);
    expect(service.attachedWorkspaceID()).toBe("second");
  });

  it("does not deliver events from a detached Host", async () => {
    const provider = new DeferredProvider();
    const service = new WorkspaceAttachmentService(provider);
    const received: string[] = [];
    service.onAction((workspaceID) => received.push(workspaceID));
    const firstPromise = service.attach("first");
    const first = new FakeHost();
    provider.pending.get("first")!.resolve(first as unknown as IAgentHost);
    await firstPromise;
    const secondPromise = service.attach("second");
    const second = new FakeHost();
    provider.pending.get("second")!.resolve(second as unknown as IAgentHost);
    await secondPromise;
    first.emit(testAction());
    second.emit(testAction());
    expect(received).toEqual(["second"]);
  });

  it("restores UI state independently per Workspace", () => {
    const state = new WorkspaceUIStateService();
    state.save("first", {
      sessionResource: "ahp-session:/one",
      terminalPanelHeight: 360,
    });
    state.save("second", { sessionResource: "ahp-session:/two" });
    expect(state.load("first").sessionResource).toBe("ahp-session:/one");
    expect(state.load("first").terminalPanelHeight).toBe(360);
    expect(state.load("second").sessionResource).toBe("ahp-session:/two");
  });
});

function testAction(): AHPAction {
  return {
    channel: "ahp-root://",
    action: { type: "root/test" },
    serverSeq: 1,
  };
}
