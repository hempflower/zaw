import { describe, expect, it } from "vitest";
import { ChatSessionService } from "./chat-session";

describe("ChatSessionService", () => {
  it("isolates drafts and active turns by composite Session identity", () => {
    const service = new ChatSessionService();
    const first = { workspaceID: "one", resource: "ahp-session:/same" };
    const second = { workspaceID: "two", resource: "ahp-session:/same" };

    service.update(first, { draft: "first" });
    service.update(second, { draft: "second" });
    service.setActiveTurn(first, "turn-one");

    expect(service.composition(first).draft).toBe("first");
    expect(service.composition(second).draft).toBe("second");
    expect(service.activeTurn(first)).toBe("turn-one");
    expect(service.activeTurn(second)).toBeUndefined();
  });

  it("clears only transient message data after sending", () => {
    const service = new ChatSessionService();
    const identity = { workspaceID: "one", resource: "ahp-session:/one" };
    service.update(identity, {
      approvalMode: "allow",
      draft: "hello",
      model: "model-one",
      attachments: [
        {
          type: "embeddedResource",
          label: "image.png",
          data: "AAAA",
          contentType: "image/png",
          displayKind: "image",
        },
      ],
    });

    service.clearAfterSend(identity);

    expect(service.composition(identity)).toMatchObject({
      approvalMode: "allow",
      attachments: [],
      draft: "",
      model: "model-one",
    });
  });
});
