import { describe, expect, it, vi } from "vitest";
import { Container } from "inversify";
import type { IAgentHost } from "../../services/agent-host";
import { IWorkspaceAttachmentService } from "../../services/workspace-attachment";
import {
  ITerminalGroupService,
  TerminalGroupService,
} from "./terminal-group-service";
import { ITerminalService, TerminalService } from "./terminal-service";

describe("TerminalService", () => {
  it("owns create, select, input, resize, dispose, and reattach resource lifecycle", async () => {
    const createTerminal = vi.fn().mockResolvedValue({
      resource: "terminal:/new",
      title: "Terminal",
      output: "$ ",
    });
    const disposeTerminal = vi.fn().mockResolvedValue(undefined);
    const terminalInput = vi.fn();
    const terminalResize = vi.fn();
    const attachTerminal = vi
      .fn()
      .mockImplementation(async (resource: string) => ({
        resource,
        title: `attached ${resource}`,
        output: "restored",
      }));
    const host = {
      createTerminal,
      disposeTerminal,
      terminalInput,
      terminalResize,
      listTerminals: () => [
        { resource: "terminal:/one", title: "one", output: "" },
        { resource: "terminal:/two", title: "two", output: "" },
      ],
      attachTerminal,
    } as unknown as IAgentHost;
    const attachment = {
      attachedWorkspaceID: () => "workspace:/one",
      attached: vi.fn().mockReturnValue(host),
    } as unknown as IWorkspaceAttachmentService;
    const container = new Container();
    container
      .bind<IWorkspaceAttachmentService>(IWorkspaceAttachmentService)
      .toConstantValue(attachment);
    container
      .bind(ITerminalGroupService)
      .to(TerminalGroupService)
      .inSingletonScope();
    container.bind(ITerminalService).to(TerminalService).inSingletonScope();
    const service = container.get<TerminalService>(ITerminalService);
    const group = container.get<TerminalGroupService>(ITerminalGroupService);

    await service.create();
    expect(createTerminal).toHaveBeenCalledWith(
      expect.stringMatching(/^ahp-terminal:\//),
      "Terminal",
    );
    expect(service.activeTerminal).toBe("terminal:/new");
    expect(service.terminals[0]?.output).toBe("$ ");
    expect(group.open).toBe(true);

    service.select("terminal:/new");
    service.input("terminal:/new", "echo hello");
    service.resize("terminal:/new", 80.8, 23.2);
    expect(terminalInput).toHaveBeenCalledWith("terminal:/new", "echo hello");
    expect(terminalResize).toHaveBeenCalledWith("terminal:/new", 80, 23);

    await service.reattach("workspace:/one", host);
    expect(attachTerminal).toHaveBeenCalledTimes(2);
    expect(service.terminals.map((terminal) => terminal.resource)).toEqual([
      "terminal:/one",
      "terminal:/two",
    ]);
    expect(service.activeTerminal).toBe("terminal:/one");

    await service.disposeTerminal("terminal:/one");
    expect(disposeTerminal).toHaveBeenCalledWith("terminal:/one");
    expect(service.activeTerminal).toBe("terminal:/two");
  });
});
