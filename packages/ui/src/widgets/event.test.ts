import { describe, expect, it } from "vitest";
import { DisposableStore, Emitter } from "./event";

describe("Emitter", () => {
  it("supports thisArgs and DisposableStore registration", () => {
    const emitter = new Emitter<number>();
    const store = new DisposableStore();
    const receiver = { total: 0 };
    emitter.event(
      function (this: typeof receiver, value) {
        this.total += value;
      },
      receiver,
      store,
    );
    emitter.fire(2);
    store.dispose();
    emitter.fire(3);
    expect(receiver.total).toBe(2);
  });

  it("handles listener removal during delivery", () => {
    const emitter = new Emitter<string>();
    const calls: string[] = [];
    const first = emitter.event((value) => {
      calls.push(`first:${value}`);
      second.dispose();
    });
    const second = emitter.event((value) => calls.push(`second:${value}`));
    emitter.fire("a");
    first.dispose();
    expect(calls).toEqual(["first:a"]);
  });
});
