import { QObject, QProperty, qproperty, inject, Injectable } from "@mocha/core";
import { QMLComponent, qml, generateQMLSource } from "@mocha/core/qml";

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

function makeController(template = qml`Item {}`) {
  @QMLComponent({
    qml: template,
  })
  class TestController extends QObject {
    @qproperty count = new QProperty(0);
  }
  const meta = (TestController as any).__qmlComponent;
  const instance = new TestController();
  return { instance, meta };
}

async function run(): Promise<void> {

// ════════════════════════════════════════════════════════════
// QML codegen: inject() field rewrites
// ════════════════════════════════════════════════════════════

test("controller.<field>.X rewrites to <ClassName>.X", () => {
  const { instance, meta } = makeController(
    qml`Text { text: "Count: " + controller.global.count.value }`
  );
  const out = generateQMLSource(
    instance,
    meta,
    undefined,
    new Map([["global", "GlobalState"]])
  );
  assert(out.includes("GlobalState.count"), `expected GlobalState.count in: ${out}`);
  assert(!out.includes(".value"), `expected .value stripped: ${out}`);
});

test("controller.<field>.method() rewrites to bridgeCall", () => {
  const { instance, meta } = makeController(
    qml`Button { onClicked: controller.global.increment() }`
  );
  const out = generateQMLSource(
    instance,
    meta,
    undefined,
    new Map([["global", "GlobalState"]])
  );
  assert(
    out.includes('GlobalState.bridgeCall("increment")'),
    `expected bridgeCall: ${out}`
  );
});

test("controller.<field>.method(args) preserves arguments", () => {
  const { instance, meta } = makeController(
    qml`Button { onClicked: controller.counter.setValue(42) }`
  );
  const out = generateQMLSource(
    instance,
    meta,
    undefined,
    new Map([["counter", "CounterState"]])
  );
  assert(
    out.includes('CounterState.bridgeCall(JSON.stringify(["setValue", 42]))'),
    `expected bridgeCall with args: ${out}`
  );
});

test("unaliased controller.X is left untouched", () => {
  const { instance, meta } = makeController(
    qml`Text { text: controller.count.value }`
  );
  const out = generateQMLSource(
    instance,
    meta,
    undefined,
    new Map([["global", "GlobalState"]])
  );
  assert(out.includes("controller.count"), `expected controller.count untouched: ${out}`);
});

test("bridgeCall on injected fields is preserved verbatim", () => {
  const { instance, meta } = makeController(
    qml`Item { Component.onCompleted: controller.global.bridgeCall("manual") }`
  );
  const out = generateQMLSource(
    instance,
    meta,
    undefined,
    new Map([["global", "GlobalState"]])
  );
  assert(
    out.includes("controller.global.bridgeCall"),
    `expected raw bridgeCall preserved: ${out}`
  );
});

test("multiple injected fields all get rewritten", () => {
  const { instance, meta } = makeController(
    qml`Item { Text { text: controller.auth.user }; Text { text: controller.cart.total.value } }`
  );
  const out = generateQMLSource(
    instance,
    meta,
    undefined,
    new Map([
      ["auth", "AuthService"],
      ["cart", "CartService"],
    ])
  );
  assert(out.includes("AuthService.user"), `auth→AuthService: ${out}`);
  assert(out.includes("CartService.total"), `cart→CartService: ${out}`);
});

test("inject() result in controller becomes live (no longer dead code)", () => {
  @Injectable({ providedIn: "root" })
  class GlobalState extends QObject {
    @qproperty count = new QProperty(0);
  }

  @QMLComponent({ qml: qml`Item {}` })
  class App extends QObject {
    global = inject(GlobalState);
  }

  const app = new App();
  assert(app.global instanceof GlobalState, "injected field is the service instance");
  assert(app.global.count.value === 0, "injected field shares QProperty state");
});

console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
}

run();
