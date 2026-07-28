import { describe, expect, it, vi } from "vitest";
import { ContextKeyService } from "./context-key-service";
import {
  ContextKeyExpr,
  RawContextKey,
  type IContextKeyService,
} from "./context-key";

describe("ContextKeyService", () => {
  function setup(): IContextKeyService {
    return new ContextKeyService();
  }

  it("creates and reads a context key", () => {
    const service = setup();
    const key = service.createKey("test.a", false);
    expect(key.get()).toBe(false);
    key.set(true);
    expect(key.get()).toBe(true);
  });

  it("resets a key to default", () => {
    const service = setup();
    const key = service.createKey("test.b", 42);
    key.set(100);
    expect(key.get()).toBe(100);
    key.reset();
    expect(key.get()).toBe(42);
  });

  it("fires onDidChangeContext when key changes", () => {
    const service = setup();
    const listener = vi.fn();
    service.onDidChangeContext(listener);
    const key = service.createKey("test.c", false);
    key.set(true);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not fire when value unchanged", () => {
    const service = setup();
    const listener = vi.fn();
    service.onDidChangeContext(listener);
    const key = service.createKey("test.d", false);
    key.set(false); // same value
    expect(listener).not.toHaveBeenCalled();
  });

  it("disposes a key removes it", () => {
    const service = setup();
    const key = service.createKey("test.e", "hello");
    expect(service.getValue("test.e")).toBe("hello");
    key.dispose();
    expect(service.getValue("test.e")).toBeUndefined();
  });

  it("rejects duplicate key names", () => {
    const service = setup();
    service.createKey("test.f", 1);
    expect(() => service.createKey("test.f", 2)).toThrow("already registered");
  });

  it("RawContextKey binds to service", () => {
    const service = setup();
    const raw = new RawContextKey("test.g", "default");
    const key = raw.bindTo(service);
    expect(key.get()).toBe("default");
    key.set("updated");
    expect(service.getValue("test.g")).toBe("updated");
  });
});

describe("ContextKeyExpr evaluation", () => {
  function setup() {
    const service = new ContextKeyService();
    const a = service.createKey("a", false);
    const b = service.createKey("b", true);
    const count = service.createKey("count", 0);
    const mode = service.createKey("mode", "edit");
    return { service, a, b, count, mode };
  }

  it("evaluates has (truthy check)", () => {
    const { service, a, b } = setup();
    expect(service.evaluate(ContextKeyExpr.has("a"))).toBe(false);
    a.set(true);
    expect(service.evaluate(ContextKeyExpr.has("a"))).toBe(true);
    expect(service.evaluate(ContextKeyExpr.has("b"))).toBe(true);
  });

  it("evaluates equals", () => {
    const { service, mode } = setup();
    expect(service.evaluate(ContextKeyExpr.equals("mode", "edit"))).toBe(true);
    expect(service.evaluate(ContextKeyExpr.equals("mode", "view"))).toBe(false);
  });

  it("evaluates not", () => {
    const { service, a } = setup();
    expect(service.evaluate(ContextKeyExpr.not(ContextKeyExpr.has("a")))).toBe(
      true,
    );
    a.set(true);
    expect(service.evaluate(ContextKeyExpr.not(ContextKeyExpr.has("a")))).toBe(
      false,
    );
  });

  it("evaluates and", () => {
    const { service, a, b } = setup();
    const expr = ContextKeyExpr.and(
      ContextKeyExpr.has("a"),
      ContextKeyExpr.has("b"),
    );
    expect(service.evaluate(expr)).toBe(false);
    a.set(true);
    expect(service.evaluate(expr)).toBe(true);
  });

  it("evaluates or", () => {
    const { service, a, b } = setup();
    b.set(false);
    const expr = ContextKeyExpr.or(
      ContextKeyExpr.has("a"),
      ContextKeyExpr.has("b"),
    );
    expect(service.evaluate(expr)).toBe(false);
    a.set(true);
    expect(service.evaluate(expr)).toBe(true);
  });

  it("evaluates complex expression", () => {
    const { service, a, count, mode } = setup();
    // (a OR count > 0) AND mode == "edit"
    const expr = ContextKeyExpr.and(
      ContextKeyExpr.or(
        ContextKeyExpr.has("a"),
        ContextKeyExpr.equals("count", 1),
      ),
      ContextKeyExpr.equals("mode", "edit"),
    );

    expect(service.evaluate(expr)).toBe(false);
    a.set(true);
    expect(service.evaluate(expr)).toBe(true);
    a.set(false);
    count.set(1);
    expect(service.evaluate(expr)).toBe(true);
    mode.set("view");
    expect(service.evaluate(expr)).toBe(false);
  });

  it("onDidChangeExpression fires on value change", () => {
    const { service, a } = setup();
    const callback = vi.fn();
    service.onDidChangeExpression(ContextKeyExpr.has("a"), callback);

    a.set(true);
    expect(callback).toHaveBeenCalledWith(true);

    a.set(false);
    expect(callback).toHaveBeenCalledWith(false);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("onDidChangeExpression does not fire when unchanged", () => {
    const { service, a } = setup();
    a.set(true);
    const callback = vi.fn();
    service.onDidChangeExpression(ContextKeyExpr.has("a"), callback);

    // Change a different key
    const other = service.createKey("other", 0);
    other.set(1);
    expect(callback).not.toHaveBeenCalled();
  });

  it("dispose expression listener stops callbacks", () => {
    const { service, a } = setup();
    const callback = vi.fn();
    const handle = service.onDidChangeExpression(
      ContextKeyExpr.has("a"),
      callback,
    );

    a.set(true);
    expect(callback).toHaveBeenCalledTimes(1);

    handle.dispose();
    a.set(false);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("true and false literals", () => {
    const { service } = setup();
    expect(service.evaluate(ContextKeyExpr.true)).toBe(true);
    expect(service.evaluate(ContextKeyExpr.false)).toBe(false);
  });

  it("inherits parent values and releases scoped overrides on dispose", () => {
    const { service, mode } = setup();
    mode.set("edit");
    const scoped = service.createScoped();
    expect(scoped.getValue("mode")).toBe("edit");
    const override = scoped.createKey("mode", "view");
    expect(scoped.getValue("mode")).toBe("view");
    override.set("preview");
    expect(scoped.getValue("mode")).toBe("preview");
    override.dispose();
    expect(scoped.getValue("mode")).toBe("edit");
    scoped.dispose();
  });

  it("does not retain parent context listeners after a scope is disposed", () => {
    const { service, a } = setup();
    const scoped = service.createScoped();
    const listener = vi.fn();
    scoped.onDidChangeContext(listener);
    scoped.dispose();
    a.set(true);
    expect(listener).not.toHaveBeenCalled();
  });
});
