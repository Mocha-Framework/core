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
