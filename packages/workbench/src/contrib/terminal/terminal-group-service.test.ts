import { describe, expect, it } from "vitest";
import { TerminalGroupService } from "./terminal-group-service";

describe("TerminalGroupService", () => {
  it("keeps panel placement independent from terminal resource lifetime", () => {
    const group = new TerminalGroupService();
    let changes = 0;
    group.onDidChange(() => changes++);
    group.openPanel();
    group.toggleCollapse();
    group.toggleOpen();
    expect(group.open).toBe(false);
    expect(group.collapsed).toBe(true);
    expect(changes).toBe(3);
  });
});
