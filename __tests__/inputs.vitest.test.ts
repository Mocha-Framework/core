import { describe, test, expect } from "vitest";
import {
  input,
  output,
  model,
  isInputRef,
  isOutputRef,
  isModelRef,
  effect,
  QObject,
} from "@mocha-framework/core";

const flush = () => new Promise<void>((r) => queueMicrotask(r));

describe("input()", () => {
  test("creates InputRef with default value", () => {
    const ref = input<string>("hello");
    expect(isInputRef(ref)).toBe(true);
    expect(ref.value).toBe("hello");
  });

  test("set updates value", () => {
    const ref = input<number>(0);
    ref.set(42);
    expect(ref.value).toBe(42);
  });

  test("subscribe fires on change", () => {
    const ref = input<string>("a");
    const events: Array<[string, string]> = [];
    const unsub = ref.subscribe((v, p) => events.push([v, p]));
    ref.set("b");
    ref.set("c");
    expect(events).toEqual([
      ["b", "a"],
      ["c", "b"],
    ]);
    unsub();
    ref.set("d");
    expect(events).toHaveLength(2);
  });

  test("integrates with effect()", async () => {
    const ref = input<number>(0);
    const log: number[] = [];
    const eff = effect(() => {
      log.push(ref.value);
    });
    ref.set(1);
    await flush();
    ref.set(2);
    await flush();
    expect(log).toEqual([0, 1, 2]);
    eff.destroy();
  });

  test("isInputRef is false for non-inputs", () => {
    expect(isInputRef(42)).toBe(false);
    expect(isInputRef(null)).toBe(false);
    expect(isInputRef({})).toBe(false);
    expect(isInputRef({ __input: false })).toBe(false);
  });

  test("works as a class field initializer", () => {
    class MyController extends QObject {
      name = input<string>("default");
      age = input(0);
    }
    const c = new MyController();
    expect(c.name.value).toBe("default");
    expect(c.age.value).toBe(0);
    c.name.set("world");
    expect(c.name.value).toBe("world");
  });
});

describe("output()", () => {
  test("creates OutputRef", () => {
    const ref = output<string>();
    expect(isOutputRef(ref)).toBe(true);
  });

  test("emit fires subscribers", () => {
    const ref = output<number>();
    const events: number[] = [];
    ref.subscribe((v) => events.push(v));
    ref.emit(1);
    ref.emit(2);
    ref.emit(3);
    expect(events).toEqual([1, 2, 3]);
  });

  test("subscribe returns unsubscribe", () => {
    const ref = output<string>();
    let count = 0;
    const unsub = ref.subscribe(() => count++);
    ref.emit("a");
    expect(count).toBe(1);
    unsub();
    ref.emit("b");
    expect(count).toBe(1);
  });

  test("isOutputRef is false for non-outputs", () => {
    expect(isOutputRef(42)).toBe(false);
    expect(isOutputRef(null)).toBe(false);
    expect(isOutputRef({})).toBe(false);
  });

  test("multiple subscribers all receive events", () => {
    const ref = output<{ id: string }>();
    let a = "";
    let b = "";
    ref.subscribe((v) => (a = v.id));
    ref.subscribe((v) => (b = v.id));
    ref.emit({ id: "x" });
    expect(a).toBe("x");
    expect(b).toBe("x");
  });
});

describe("model()", () => {
  test("creates ModelRef with default value", () => {
    const ref = model<string>("hello");
    expect(isModelRef(ref)).toBe(true);
    expect(ref.value).toBe("hello");
  });

  test("set updates value", () => {
    const ref = model<number>(0);
    ref.set(42);
    expect(ref.value).toBe(42);
  });

  test("change output fires on set", () => {
    const ref = model<string>("");
    const events: string[] = [];
    ref.change.subscribe((v) => events.push(v));
    ref.set("a");
    ref.set("b");
    expect(events).toEqual(["a", "b"]);
  });

  test("isModelRef is false for non-models", () => {
    expect(isModelRef(42)).toBe(false);
    expect(isModelRef(null)).toBe(false);
    expect(isModelRef({})).toBe(false);
  });

  test("parent → child via assignment", () => {
    class Child extends QObject {
      value = model<string>("");
    }
    const child = new Child();
    const events: string[] = [];
    child.value.change.subscribe((v) => events.push(v));
    child.value.set("hello");
    expect(child.value.value).toBe("hello");
    expect(events).toEqual(["hello"]);
  });

  test("integrates with effect()", async () => {
    const ref = model<number>(0);
    const log: number[] = [];
    const eff = effect(() => {
      log.push(ref.value);
    });
    ref.set(1);
    await flush();
    ref.set(2);
    await flush();
    expect(log).toEqual([0, 1, 2]);
    eff.destroy();
  });
});

describe("type guards", () => {
  test("mutual exclusivity", () => {
    const i = input<string>();
    const o = output<string>();
    const m = model<string>();
    expect(isInputRef(i)).toBe(true);
    expect(isOutputRef(i)).toBe(false);
    expect(isModelRef(i)).toBe(false);

    expect(isInputRef(o)).toBe(false);
    expect(isOutputRef(o)).toBe(true);
    expect(isModelRef(o)).toBe(false);

    expect(isInputRef(m)).toBe(false);
    expect(isOutputRef(m)).toBe(false);
    expect(isModelRef(m)).toBe(true);
  });
});
