import { describe, expect, it, vi } from "vitest";
import { Container } from "inversify";
import {
  ICommandRegistry,
  ICommandService,
  type ServicesAccessor,
} from "./commands";
import { CommandRegistry } from "./command-service";
import { ContextKeyService } from "../context-key/context-key-service";
import { ContextKeyExpr, IContextKeyService } from "../context-key/context-key";

describe("CommandRegistry", () => {
  function setup() {
    const registry = new CommandRegistry();
    const container = new Container();
    registry.setServicesAccessor(container);
    return { registry, container };
  }

  it("registers and executes a command", async () => {
    const { registry } = setup();
    const handler = vi.fn();
    registry.registerCommand("test.hello", handler);
    await registry.executeCommand("test.hello");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("passes arguments to the handler", async () => {
    const { registry } = setup();
    const handler = vi.fn();
    registry.registerCommand("test.args", handler);
    await registry.executeCommand("test.args", "a", 42);
    expect(handler).toHaveBeenCalledWith(expect.anything(), "a", 42);
  });

  it("rejects duplicate command IDs", () => {
    const { registry } = setup();
    registry.registerCommand("test.dup", () => {});
    expect(() => registry.registerCommand("test.dup", () => {})).toThrow(
      "already registered",
    );
  });

  it("throws on unregistered command execution", async () => {
    const { registry } = setup();
    await expect(registry.executeCommand("test.missing")).rejects.toThrow(
      "not registered",
    );
  });

  it("hasCommand returns correct status", () => {
    const { registry } = setup();
    expect(registry.hasCommand("test.check")).toBe(false);
    registry.registerCommand("test.check", () => {});
    expect(registry.hasCommand("test.check")).toBe(true);
  });

  it("getCommand returns the descriptor", () => {
    const { registry } = setup();
    registry.registerCommand("test.desc", () => {}, {
      category: "Test",
    });
    const desc = registry.getCommand("test.desc");
    expect(desc?.id).toBe("test.desc");
    expect(desc?.category).toBe("Test");
  });

  it("dispose removes the command", () => {
    const { registry } = setup();
    const handle = registry.registerCommand("test.dispose", () => {});
    expect(registry.hasCommand("test.dispose")).toBe(true);
    handle.dispose();
    expect(registry.hasCommand("test.dispose")).toBe(false);
  });

  it("disposed command cannot be executed", async () => {
    const { registry } = setup();
    const handle = registry.registerCommand("test.gone", () => {});
    handle.dispose();
    await expect(registry.executeCommand("test.gone")).rejects.toThrow(
      "not registered",
    );
  });

  it("validates parameters before execution", async () => {
    const { registry } = setup();
    const handler = vi.fn();
    registry.registerCommand("test.validate", handler, {
      validate: (value: unknown) => typeof value === "string",
    });

    await expect(registry.executeCommand("test.validate", 123)).rejects.toThrow(
      "validation failed",
    );
    expect(handler).not.toHaveBeenCalled();

    await registry.executeCommand("test.validate", "ok");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("enforces the same context expression used by declarative UI", async () => {
    const registry = new CommandRegistry();
    const container = new Container();
    const context = new ContextKeyService();
    const enabled = context.createKey("feature.enabled", false);
    container.bind(IContextKeyService).toConstantValue(context);
    registry.setServicesAccessor(container);
    const handler = vi.fn();
    registry.registerCommand("test.context", handler, {
      precondition: ContextKeyExpr.has("feature.enabled"),
    });
    await expect(registry.executeCommand("test.context")).rejects.toThrow(
      "precondition failed",
    );
    enabled.set(true);
    await registry.executeCommand("test.context");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("resolves services via accessor", async () => {
    const { registry, container } = setup();
    const testToken = Symbol.for("testService");
    const testService = { value: "resolved" };
    container.bind(testToken).toConstantValue(testService);

    let resolved: unknown;
    registry.registerCommand("test.di", (accessor: ServicesAccessor) => {
      resolved = accessor.get(testToken);
    });

    await registry.executeCommand("test.di");
    expect(resolved).toBe(testService);
  });

  it("handler can be async", async () => {
    const { registry } = setup();
    let completed = false;
    registry.registerCommand("test.async", async () => {
      await new Promise((r) => setTimeout(r, 10));
      completed = true;
    });

    await registry.executeCommand("test.async");
    expect(completed).toBe(true);
  });

  it("emits onDidRegister and onDidUnregister", () => {
    const registry = new CommandRegistry();
    const registered: string[] = [];
    const unregistered: string[] = [];
    registry.onDidRegister((id) => registered.push(id));
    registry.onDidUnregister((id) => unregistered.push(id));

    const handle = registry.registerCommand("test.event", () => {});
    expect(registered).toEqual(["test.event"]);

    handle.dispose();
    expect(unregistered).toEqual(["test.event"]);
  });

  it("multiple dispose of same handle is safe", () => {
    const { registry } = setup();
    const handle = registry.registerCommand("test.multi", () => {});
    handle.dispose();
    // Second dispose should not throw
    expect(() => handle.dispose()).not.toThrow();
  });
});

describe("ICommandService and ICommandRegistry are same instance", () => {
  it("shares state between registry and service interfaces", async () => {
    const registry = new CommandRegistry();
    const handler = vi.fn();

    // Register via ICommandRegistry
    (registry as ICommandRegistry).registerCommand("test.share", handler);

    // Execute via ICommandService
    await (registry as ICommandService).executeCommand("test.share", 1, 2);
    expect(handler).toHaveBeenCalledWith(expect.anything(), 1, 2);
  });
});
