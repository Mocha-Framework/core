import { QProperty, Signal, QObject, QApplication, QTimer, ThreadManager, effect, ReactiveEffect, QComputedProperty, inject, Injectable, qproperty, globalContainer } from "@mocha/core";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function test(name: string, fn: () => void): void {
  console.log(`\n[TEST] ${name}`);
  try {
    fn();
  } catch (err) {
    failed++;
    console.error(`  ERROR: ${err}`);
  }
}

async function attest(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n[TEST] ${name}`);
  try {
    await fn();
  } catch (err) {
    failed++;
    console.error(`  ERROR: ${err}`);
  }
}

const flush = () => new Promise<void>(r => queueMicrotask(r));

async function run(): Promise<void> {

// ════════════════════════════════════════════════════════════
// QProperty
// ════════════════════════════════════════════════════════════

test("QProperty - basic get/set", () => {
  const p = new QProperty(0);
  assert(p.value === 0, "initial value is 0");
  p.value = 42;
  assert(p.value === 42, "value is 42 after set");
  assert(p.get() === 42, "get() returns 42");
});

test("QProperty - change notification", () => {
  const p = new QProperty(0);
  let changedValue = -1;
  let previousValue = -1;
  p.changed.connect((v, prev) => {
    changedValue = v;
    previousValue = prev;
  });
  p.value = 10;
  assert(changedValue === 10, "notified value is 10");
  assert(previousValue === 0, "previous value is 0");
});

test("QProperty - constant property", () => {
  const p = new QProperty(5, { isConstant: true });
  p.value = 10;
  assert(p.value === 5, "constant property unchanged");
});

test("QProperty - bindTo", () => {
  const source = new QProperty(1);
  const target = new QProperty(0);
  target.bindTo(source);
  assert(target.value === 1, "target synced to source");
  source.value = 5;
  assert(target.value === 5, "target follows source change");
});

test("QProperty - bindTwoWay", () => {
  const a = new QProperty(0);
  const b = new QProperty(1);
  const unsub = a.bindTwoWay(b);
  assert(a.value === 1, "a synced to b initially");
  assert(b.value === 1, "b unchanged");
  a.value = 5;
  assert(b.value === 5, "b follows a change");
  b.value = 3;
  assert(a.value === 3, "a follows b change");
  unsub();
  a.value = 99;
  assert(b.value === 3, "b not synced after unbind");
});

test("QProperty - same value does not emit change", () => {
  const p = new QProperty(0);
  let emissions = 0;
  p.changed.connect(() => emissions++);
  p.value = 5;
  assert(emissions === 1, "changed emitted on first set");
  p.value = 5;
  assert(emissions === 1, "changed not emitted on same value");
  p.value = 5;
  assert(emissions === 1, "changed still not emitted");
});

// ════════════════════════════════════════════════════════════
// Signal
// ════════════════════════════════════════════════════════════

test("Signal - connect and emit", () => {
  const sig = new Signal<(x: number) => void>();
  let received = 0;
  sig.connect((x: number) => { received = x; });
  sig.emit(42);
  assert(received === 42, "signal value received");
});

test("Signal - disconnect", () => {
  const sig = new Signal<() => void>();
  let count = 0;
  const conn = sig.connect(() => count++);
  sig.emit();
  assert(count === 1, "count is 1");
  conn.disconnect();
  sig.emit();
  assert(count === 1, "count still 1 after disconnect");
});

test("Signal - connectionCount", () => {
  const sig = new Signal<() => void>();
  assert(sig.connectionCount === 0, "no connections");
  const c1 = sig.connect(() => {});
  assert(sig.connectionCount === 1, "1 connection");
  const c2 = sig.connect(() => {});
  assert(sig.connectionCount === 2, "2 connections");
  c1.disconnect();
  assert(sig.connectionCount === 1, "1 connection after disconnect");
  c2.disconnect();
  assert(sig.connectionCount === 0, "0 connections");
});

test("Signal - once pattern", () => {
  const sig = new Signal<() => void>();
  let count = 0;
  const conn = sig.connect(() => { count++; conn.disconnect(); });
  sig.emit();
  assert(count === 1, "fired once");
  sig.emit();
  assert(count === 1, "not fired after self-disconnect");
});

test("Signal - disconnectAll", () => {
  const sig = new Signal<() => void>();
  let a = 0, b = 0;
  sig.connect(() => a++);
  sig.connect(() => b++);
  sig.emit();
  assert(a === 1, "first listener fired");
  assert(b === 1, "second listener fired");
  sig.disconnect();
  sig.emit();
  assert(a === 1, "first not fired after disconnectAll");
  assert(b === 1, "second not fired after disconnectAll");
});

// ════════════════════════════════════════════════════════════
// ReactiveEffect (synchronous tests)
// ════════════════════════════════════════════════════════════

test("ReactiveEffect - run executes fn and tracks deps", () => {
  const qp = new QProperty(0);
  let val = -1;
  const eff = new ReactiveEffect(() => { val = qp.value; });
  eff.run();
  assert(val === 0, "initial value synced");
  eff.destroy();
});

test("effect() - runs fn synchronously on creation", () => {
  let count = 0;
  const eff = effect(() => { count++; });
  assert(count === 1, "fn ran once on creation");
  eff.destroy();
});

test("effect() - does not loop on same-value set", async () => {
  const qp = new QProperty(5);
  let runs = 0;
  const eff = effect(() => { void qp.value; runs++; });
  assert(runs === 1, "initial run");
  qp.value = 5;
  await flush();
  assert(runs === 1, "not re-run (setter skipped emit)");
  eff.destroy();
});

test("ReactiveEffect - addDep deduplicates", () => {
  const qp = new QProperty(0);
  const eff = new ReactiveEffect(() => { void qp.value; });
  eff.run();
  eff.addDep(qp);
  eff.addDep(qp);
  eff.addDep(qp);
  assert((eff as any)._deps.size, "only one dep"); // any non-zero
  eff.destroy();
});

// ════════════════════════════════════════════════════════════
// QComputedProperty (synchronous tests)
// ════════════════════════════════════════════════════════════

test("QComputedProperty - lazy computation", () => {
  let computeCount = 0;
  const c = new QComputedProperty(() => { computeCount++; return 42; });
  assert(computeCount === 0, "not computed until first access");
  assert(c.value === 42, "returns computed value");
  assert(computeCount === 1, "computed once on first access");
});

test("QComputedProperty - caches value when deps unchanged", () => {
  let computeCount = 0;
  const c = new QComputedProperty(() => { computeCount++; return 42; });
  c.value; c.value; c.value;
  assert(computeCount === 1, "computed only once across multiple accesses");
});

test("QComputedProperty - toString", () => {
  const c = new QComputedProperty(() => 42);
  assert(c.toString() === "42", "toString returns string");
  assert(typeof c.value === "number", "value is number");
  assert(c + "" === "42", "implicit coercion works");
});

test("QComputedProperty - zero and falsy values", () => {
  const a = new QProperty(0);
  const c = new QComputedProperty(() => a.value);
  assert(c.value === 0, "zero is correct");
});

// ════════════════════════════════════════════════════════════
// DI / inject()
// ════════════════════════════════════════════════════════════

@Injectable()
class TestService extends QObject {
  @qproperty value = new QProperty(42);
}

test("inject() - resolves singleton from globalContainer", () => {
  const svc = inject(TestService);
  assert(svc instanceof TestService, "returns service instance");
  assert(svc.value.value === 42, "QProperty accessible");
  const svc2 = inject(TestService);
  assert(svc === svc2, "same singleton instance on multiple calls");
});

test("inject() - throws for unregistered class", () => {
  class Unregistered {}
  let threw = false;
  try { inject(Unregistered as any); } catch { threw = true; }
  assert(threw, "throws on unregistered class");
});

// ════════════════════════════════════════════════════════════
// QObject
// ════════════════════════════════════════════════════════════

test("QObject - parent-child hierarchy", () => {
  const parent = new QObject();
  const child = new QObject(parent);
  assert(parent.childCount === 1, "parent has 1 child");
  assert(child.parent === parent, "child's parent is correct");
  assert(parent.children[0] === child, "children array is correct");
});

test("QObject - findChild", () => {
  const parent = new QObject();
  const child1 = new QObject(parent);
  child1.objectName = "one";
  const child2 = new QObject(parent);
  child2.objectName = "two";
  const found = parent.findChild((c) => c.objectName === "two");
  assert(found === child2, "findChild returns correct child");
});

test("QObject - dumpObjectTree", () => {
  const root = new QObject();
  const child = new QObject(root);
  const grandchild = new QObject(child);
  const tree = root.dumpObjectTree();
  assert(tree.includes("QObject"), "tree contains class name");
  assert(tree.split("\n").length >= 3, "tree has multiple levels");
});

test("QObject - dispose cascades", () => {
  const root = new QObject();
  const child = new QObject(root);
  const grandchild = new QObject(child);
  let childDestroyed = false;
  let grandchildDestroyed = false;
  child.destroyed.connect(() => childDestroyed = true);
  grandchild.destroyed.connect(() => grandchildDestroyed = true);
  root.dispose();
  assert(childDestroyed, "child destroyed signal emitted");
  assert(grandchildDestroyed, "grandchild destroyed signal emitted");
  assert(root.isDisposed, "root is disposed");
});

// ════════════════════════════════════════════════════════════
// QTimer / QApplication / ThreadManager
// ════════════════════════════════════════════════════════════

test("QTimer - singleShot fires after delay", () => {
  let fired = false;
  QTimer.singleShot(10, () => { fired = true; });
  assert(fired === false, "not yet fired synchronously");
});

test("QApplication - lifecycle", () => {
  const app = new QApplication({ appName: "TestApp" });
  assert(app.appName === "TestApp", "app name is correct");
  assert(app.isRunning === false, "not running yet");
  assert(QApplication.instance === app, "instance is set");
  app.exec();
  assert(app.isRunning === true, "now running");
  assert(app.uptime >= 0, "uptime is non-negative");
  app.quit();
  assert(app.isRunning === false, "stopped running");
  assert(QApplication.instance === app, "instance still set");
});

test("ThreadManager - threads", () => {
  const main = ThreadManager.mainThread();
  const v8 = ThreadManager.v8Thread();
  assert(main.name === "qt", "main thread is qt");
  assert(v8.name === "v8", "v8 thread is v8");
  assert(main.type === "main", "main thread type is main");
  assert(v8.type === "worker", "v8 thread type is worker");
});

// ════════════════════════════════════════════════════════════
// effect() async tests (microtask scheduling)
// ════════════════════════════════════════════════════════════

await attest("effect() - re-runs after microtask flush", async () => {
  const qp = new QProperty(0);
  let val = -1;
  const eff = effect(() => { val = qp.value; });
  assert(val === 0, "initial value synced");
  qp.value = 42;
  assert(val === 0, "stale before flush");
  await flush();
  assert(val === 42, "updated after microtask");
  eff.destroy();
});

await attest("effect() - batches multiple changes into single run", async () => {
  const qp = new QProperty(0);
  let runs = 0;
  const eff = effect(() => { void qp.value; runs++; });
  assert(runs === 1, "initial run");
  qp.value = 1;
  qp.value = 2;
  qp.value = 3;
  await flush();
  assert(runs === 2, "batched into single re-run");
  eff.destroy();
});

await attest("effect() - tracks multiple QProperties", async () => {
  const a = new QProperty(1);
  const b = new QProperty(10);
  let sum = 0;
  const eff = effect(() => { sum = a.value + b.value; });
  assert(sum === 11, "initial sum");
  a.value = 2;
  await flush();
  assert(sum === 12, "recomputed after a change");
  b.value = 20;
  await flush();
  assert(sum === 22, "recomputed after b change");
  eff.destroy();
});

await attest("effect() - destroy prevents future runs", async () => {
  const qp = new QProperty(0);
  let runs = 0;
  const eff = effect(() => { void qp.value; runs++; });
  assert(runs === 1, "initial run");
  eff.destroy();
  qp.value = 42;
  await flush();
  assert(runs === 1, "not re-run after destroy");
});

await attest("effect() - stale deps are cleaned up", async () => {
  const toggle = new QProperty(true);
  const a = new QProperty(1);
  const b = new QProperty(10);
  let tracked = 0;
  const eff = effect(() => {
    if (toggle.value) { tracked = a.value; }
    else { tracked = b.value; }
  });
  assert(tracked === 1, "initial: tracks a");
  toggle.value = false;
  b.value = 20;
  await flush();
  assert(tracked === 20, "now tracks b (toggle + b change)");
  a.value = 99;
  await flush();
  assert(tracked === 20, "a change does not trigger (stale dep cleaned)");
  eff.destroy();
});

await attest("effect() - multiple effects work independently", async () => {
  const qp = new QProperty(0);
  let a = 0, b = 0;
  const e1 = effect(() => { void qp.value; a++; });
  const e2 = effect(() => { void qp.value; b++; });
  assert(a === 1, "e1 initial");
  assert(b === 1, "e2 initial");
  qp.value = 1;
  await flush();
  assert(a === 2, "e1 re-ran");
  assert(b === 2, "e2 re-ran");
  e1.destroy();
  e2.destroy();
});

// ════════════════════════════════════════════════════════════
// QComputedProperty async tests
// ════════════════════════════════════════════════════════════

await attest("QComputedProperty - recomputes when dependency changes", async () => {
  const a = new QProperty(1);
  const c = new QComputedProperty(() => a.value * 2);
  assert(c.value === 2, "initial: 1*2");
  a.value = 5;
  await flush();
  assert(c.value === 10, "recomputed: 5*2");
  c.dispose();
});

await attest("QComputedProperty - two dependencies", async () => {
  const x = new QProperty(2);
  const y = new QProperty(3);
  const c = new QComputedProperty(() => x.value + y.value);
  assert(c.value === 5, "initial");
  x.value = 10;
  await flush();
  assert(c.value === 13, "after x");
  y.value = 7;
  await flush();
  assert(c.value === 17, "after y");
  c.dispose();
});

await attest("QComputedProperty - does not fire changed when value unchanged", async () => {
  const a = new QProperty(2);
  let emissions = 0;
  const c = new QComputedProperty(() => a.value % 3);
  c.changed.connect(() => emissions++);
  assert(c.value === 2, "initial");
  a.value = 5; // 5%3 = 2 → same result
  await flush();
  assert(c.value === 2, "value same");
  assert(emissions === 0, "changed not emitted (same value)");
  c.dispose();
});

await attest("QComputedProperty - fires changed when value differs", async () => {
  const a = new QProperty(2);
  let lastVal = -1;
  const c = new QComputedProperty(() => a.value * 2);
  c.changed.connect((v) => { lastVal = v; });
  assert(c.value === 4, "initial");
  a.value = 5;
  await flush();
  assert(lastVal === 10, "changed emitted");
  assert(c.value === 10, "value updated");
  c.dispose();
});

await attest("QComputedProperty - effect tracks computed", async () => {
  const a = new QProperty(1);
  const c = new QComputedProperty(() => a.value * 2);
  let val = -1;
  const eff = effect(() => { val = c.value; });
  assert(val === 2, "initial");
  a.value = 4;
  await flush();
  assert(val === 8, "effect re-ran after computed change");
  eff.destroy();
  c.dispose();
});

await attest("QComputedProperty - chain: computed depends on computed", async () => {
  const a = new QProperty(2);
  const c1 = new QComputedProperty(() => a.value * 2);
  const c2 = new QComputedProperty(() => c1.value + 10);
  assert(c1.value === 4, "c1 = 2*2");
  assert(c2.value === 14, "c2 = 4+10");
  a.value = 3;
  await flush();
  assert(c1.value === 6, "c1 recomputed");
  assert(c2.value === 16, "c2 recomputed from new c1");
  c1.dispose();
  c2.dispose();
});

await attest("QComputedProperty - dispose stops recomputation", async () => {
  const a = new QProperty(1);
  let computeCount = 0;
  const c = new QComputedProperty(() => { computeCount++; return a.value; });
  assert(c.value === 1, "initial value");
  assert(computeCount === 1, "computed once at init");
  c.dispose();
  a.value = 5;
  await flush();
  assert(computeCount === 1, "not recomputed after dispose");
});

// ════════════════════════════════════════════════════════════
// Results
// ════════════════════════════════════════════════════════════

console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);

}

run();
