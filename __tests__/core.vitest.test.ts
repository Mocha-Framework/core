import { describe, test, expect } from "vitest";
import {
  QProperty,
  Signal,
  QObject,
  QApplication,
  QTimer,
  effect,
  QComputedProperty,
} from "@mocha/core";

const flush = () => new Promise<void>((r) => queueMicrotask(r));

describe("QProperty", () => {
  test("basic get/set", () => {
    const p = new QProperty(0);
    expect(p.value).toBe(0);
    p.value = 42;
    expect(p.value).toBe(42);
    expect(p.get()).toBe(42);
  });

  test("change notification", () => {
    const p = new QProperty(0);
    let changedValue = -1;
    let previousValue = -1;
    p.changed.connect((v, prev) => {
      changedValue = v;
      previousValue = prev;
    });
    p.value = 10;
    expect(changedValue).toBe(10);
    expect(previousValue).toBe(0);
  });

  test("beforeChange signal", () => {
    const p = new QProperty(5);
    let called = false;
    p.beforeChange.connect(() => {
      called = true;
    });
    p.value = 99;
    expect(called).toBe(true);
  });

  test("bindTo", async () => {
    const source = new QProperty(1);
    const target = new QProperty(0);
    target.bindTo(source);
    expect(target.value).toBe(1);
    source.value = 5;
    await flush();
    expect(target.value).toBe(5);
  });

  test("two-way binding", async () => {
    const a = new QProperty(10);
    const b = new QProperty(20);
    a.bindTwoWay(b);
    expect(a.value).toBe(20);
    b.value = 30;
    await flush();
    expect(a.value).toBe(30);
  });

  test("update", () => {
    const p = new QProperty(5);
    p.update((v) => v + 1);
    expect(p.value).toBe(6);
  });

  test("update with string", () => {
    const p = new QProperty("hello");
    p.update((v) => v + "!");
    expect(p.value).toBe("hello!");
  });

  test("previous returns value before last set", () => {
    const p = new QProperty(0);
    p.value = 10;
    expect(p.previous()).toBe(0);
    p.value = 20;
    expect(p.previous()).toBe(10);
  });

  test("equals compares without .value", () => {
    const p = new QProperty(42);
    expect(p.equals(42)).toBe(true);
    expect(p.equals(0)).toBe(false);
  });

  test("onValue subscribes and returns unsubscribe", () => {
    const p = new QProperty(0);
    let calls: number[] = [];
    const unsub = p.onValue((v) => calls.push(v));
    p.value = 1;
    p.value = 2;
    unsub();
    p.value = 3;
    expect(calls).toEqual([1, 2]);
  });

  test("_setSilent does not emit changed signal", () => {
    const p = new QProperty(0);
    let changed = false;
    p.changed.connect(() => { changed = true; });
    (p as any)._setSilent(99);
    expect(p.value).toBe(99);
    expect(changed).toBe(false);
  });

  test("toString returns debug representation", () => {
    const p = new QProperty(42);
    expect(p.toString()).toContain("QProperty");
    expect(p.toString()).toContain("42");
  });
});

describe("Signal", () => {
  test("emit and connect", () => {
    const sig = new Signal<(x: number) => void>();
    let received = -1;
    sig.connect((x) => { received = x; });
    sig.emit(42);
    expect(received).toBe(42);
  });

  test("disconnect", () => {
    const sig = new Signal<() => void>();
    let count = 0;
    const conn = sig.connect(() => { count++; });
    sig.emit();
    expect(count).toBe(1);
    conn.disconnect();
    sig.emit();
    expect(count).toBe(1);
  });

  test("multiple connections", () => {
    const sig = new Signal<(x: number) => void>();
    const results: number[] = [];
    sig.connect((x) => { results.push(x * 2); });
    sig.connect((x) => { results.push(x * 3); });
    sig.emit(5);
    expect(results).toEqual([10, 15]);
  });
});

describe("QObject", () => {
  test("objectId and objectName", () => {
    const obj = new QObject();
    expect(obj.objectId).toBeGreaterThan(0);
    expect(obj.objectName).toContain("QObject_");
    obj.objectName = "custom";
    expect(obj.objectName).toBe("custom");
  });

  test("parent/child tree", () => {
    const parent = new QObject();
    const child = new QObject(parent);
    expect(child.parent).toBe(parent);
    expect(parent.children.length).toBe(1);
    expect(parent.children[0]).toBe(child);
  });

  test("findChild", () => {
    class A extends QObject { constructor(p: QObject | null = null) { super(p); this.objectName = "a"; } }
    class B extends QObject { constructor(p: QObject | null = null) { super(p); this.objectName = "b"; } }
    const root = new QObject();
    new A(root);
    new B(root);
    const found = root.findChild((c) => c.objectName === "a");
    expect(found).not.toBeNull();
    expect(found!.objectName).toBe("a");
  });

  test("dispose", () => {
    const parent = new QObject();
    const child = new QObject(parent);
    let destroyedCount = 0;
    child.destroyed.connect(() => { destroyedCount++; });
    parent.dispose();
    expect(destroyedCount).toBe(1);
    expect(parent.children.length).toBe(0);
  });

  test("objectNameChanged signal", () => {
    const obj = new QObject();
    let newName = "";
    obj.objectNameChanged.connect((n) => { newName = n; });
    obj.objectName = "renamed";
    expect(newName).toBe("renamed");
  });

  test("bulkSet applies multiple properties atomically", () => {
    class Model extends QObject {
      count = new QProperty(0);
      name = new QProperty("");
    }
    const m = new Model();
    const log: string[] = [];
    m.count.changed.connect(() => log.push("count"));
    m.name.changed.connect(() => log.push("name"));

    m.bulkSet({ count: 5, name: "hello" });
    expect(m.count.value).toBe(5);
    expect(m.name.value).toBe("hello");
    expect(log).toEqual(["count", "name"]);
  });

  test("bulkSet emits signals in the set order", () => {
    class Ordered extends QObject {
      a = new QProperty(1);
      b = new QProperty(2);
    }
    const m = new Ordered();
    const log: string[] = [];
    m.a.changed.connect(() => log.push("a"));
    m.b.changed.connect(() => log.push("b"));

    m.bulkSet({ b: 99, a: 88 });
    expect(log).toEqual(["b", "a"]);
  });
});

describe("QApplication", () => {
  test("creation and quit", () => {
    const app = new QApplication({ appName: "Test", appVersion: "1.0" });
    expect(app.objectName).toContain("QApplication");
    app.quit();
  });
});

describe("QTimer", () => {
  test("singleShot callback", async () => {
    let fired = false;
    QTimer.singleShot(20, () => { fired = true; });
    await new Promise((r) => setTimeout(r, 100));
    expect(fired).toBe(true);
  });

  test("interval", async () => {
    let count = 0;
    const timer = new QTimer();
    timer.timeout.connect(() => { count++; });
    timer.start(10);
    await new Promise((r) => setTimeout(r, 50));
    timer.stop();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

describe("effect (reactivity)", () => {
  test("tracks dependencies", async () => {
    const a = new QProperty(1);
    const b = new QProperty(2);
    let called = 0;
    let lastSum = 0;
    effect(() => { called++; lastSum = a.value + b.value; });
    expect(called).toBe(1);
    expect(lastSum).toBe(3);
    a.value = 10;
    await flush();
    expect(called).toBe(2);
    expect(lastSum).toBe(12);
  });

  test("effect with multiple dependencies", async () => {
    const a = new QProperty(1);
    const b = new QProperty(2);
    const c = new QProperty(3);
    let sum = 0;
    effect(() => { sum = a.value + b.value + c.value; });
    expect(sum).toBe(6);
    a.value = 10;
    await flush();
    expect(sum).toBe(15);
    b.value = 20;
    await flush();
    expect(sum).toBe(33);
  });

  test("effect cleans up stale dependencies", async () => {
    const a = new QProperty(1);
    const b = new QProperty(2);
    const flag = new QProperty(true);
    let last = 0;
    effect(() => { last = flag.value ? a.value : b.value; });
    expect(last).toBe(1);
    a.value = 10;
    await flush();
    expect(last).toBe(10);
    // Switch to reading b instead
    flag.value = false;
    await flush();
    expect(last).toBe(2);
    // Changing a should NOT trigger the effect now
    a.value = 99;
    await flush();
    expect(last).toBe(2);
    // Changing b should
    b.value = 50;
    await flush();
    expect(last).toBe(50);
  });

  test("nested effects batch correctly", async () => {
    const a = new QProperty(1);
    const b = new QProperty(2);
    const outer = new QProperty(0);
    const inner = new QProperty(0);
    effect(() => { outer.value = a.value; });
    effect(() => { inner.value = a.value + b.value; });
    await flush();
    a.value = 10;
    b.value = 20;
    await flush();
    expect(outer.value).toBe(10);
    expect(inner.value).toBe(30);
  });
});

describe("QComputedProperty", () => {
  test("auto-computes", async () => {
    const a = new QProperty(2);
    const c = new QComputedProperty(() => a.value * 3);
    expect(c.value).toBe(6);
    a.value = 5;
    await flush();
    expect(c.value).toBe(15);
  });

  test("dispose stops recomputation", async () => {
    const a = new QProperty(1);
    let computeCount = 0;
    const c = new QComputedProperty(() => { computeCount++; return a.value; });
    expect(c.value).toBe(1);
    expect(computeCount).toBe(1);
    c.dispose();
    a.value = 5;
    await flush();
    expect(computeCount).toBe(1);
  });
});
