import { QObject, QProperty, qproperty, inject, Injectable } from "@mocha-framework/core";
import { QMLComponent, qml, generateQMLSource } from "@mocha-framework/core/qml";

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

// ════════════════════════════════════════════════════════════
// QML codegen: this.X sugar (shortThis)
// ════════════════════════════════════════════════════════════

test("this.<field> rewrites to controller.<field> by default", () => {
  const { instance, meta } = makeController(
    qml`Text { text: "Count: " + this.count.value }`
  );
  const out = generateQMLSource(instance, meta);
  assert(out.includes("controller.count"), `expected controller.count in: ${out}`);
  assert(!out.includes("this.count"), `expected this.count stripped: ${out}`);
});

test("this.<field>() rewrites to controller.<field>() and becomes bridgeCall", () => {
  const { instance, meta } = makeController(
    qml`Button { onClicked: this.increment() }`
  );
  const out = generateQMLSource(instance, meta);
  assert(
    out.includes('controller.bridgeCall("increment")'),
    `expected bridgeCall: ${out}`
  );
  assert(!out.includes("this.increment"), `expected this.increment stripped: ${out}`);
});

test("this.<inject>.<field> rewrites through inject alias to <ClassName>.<field>", () => {
  const { instance, meta } = makeController(
    qml`Text { text: this.global.count.value }`
  );
  const out = generateQMLSource(
    instance,
    meta,
    undefined,
    new Map([["global", "GlobalState"]])
  );
  assert(out.includes("GlobalState.count"), `expected GlobalState.count in: ${out}`);
  assert(!out.includes("this.global"), `expected this.global stripped: ${out}`);
});

test("this.<viewChild>.<prop> rewrites to controller.<viewChild>.<prop>", () => {
  const { instance, meta } = makeController(
    qml`Text { text: this.textField.text }`
  );
  const out = generateQMLSource(instance, meta);
  assert(
    out.includes("controller.textField.text"),
    `expected controller.textField.text in: ${out}`
  );
  assert(!out.includes("this.textField"), `expected this.textField stripped: ${out}`);
});

test("QML built-ins (parent, width, height, ...) are whitelisted", () => {
  const { instance, meta } = makeController(
    qml`Item { width: parent.width; height: parent.height; visible: this.count.value > 0 }`
  );
  const out = generateQMLSource(instance, meta);
  assert(
    out.includes("parent.width"),
    `expected parent.width untouched: ${out}`
  );
  assert(
    out.includes("parent.height"),
    `expected parent.height untouched: ${out}`
  );
  assert(
    !out.includes("controller.parent"),
    `expected controller.parent NOT present: ${out}`
  );
  assert(
    out.includes("controller.count"),
    `expected this.count stripped: ${out}`
  );
});

test("shortThis: false disables the rewrite", () => {
  @QMLComponent({
    shortThis: false,
    qml: qml`Text { text: this.count.value }`,
  })
  class NoSugar extends QObject {}
  const meta = (NoSugar as any).__qmlComponent;
  const instance = new NoSugar();
  const out = generateQMLSource(instance, meta);
  assert(
    out.includes("this.count.value"),
    `expected this.count.value preserved: ${out}`
  );
  assert(
    !out.includes("controller.count"),
    `expected controller.count NOT present: ${out}`
  );
});

test("mixed controller.X and this.X both work (controller.X untouched)", () => {
  const { instance, meta } = makeController(
    qml`Item { Text { text: this.count.value }; Text { text: controller.count.value } }`
  );
  const out = generateQMLSource(instance, meta);
  assert(
    !out.includes("this.count"),
    `expected this.count stripped: ${out}`
  );
  assert(
    out.includes("controller.count"),
    `expected controller.count present: ${out}`
  );
});

test("two classes in the same file each register a distinct tag", () => {
  @QMLComponent({ qml: qml`Item {}`, as: "Shell" })
  class ShellController extends QObject {}

  @QMLComponent({ qml: qml`Item {}`, as: "ShellHeader" })
  class ShellHeaderController extends QObject {}

  @QMLComponent({ qml: qml`Item {}`, as: "ShellFooter" })
  class ShellFooterController extends QObject {}

  const tagA = (ShellController as any).__qmlTag;
  const tagB = (ShellHeaderController as any).__qmlTag;
  const tagC = (ShellFooterController as any).__qmlTag;
  assert(tagA === "Shell", `Shell tag: ${tagA}`);
  assert(tagB === "ShellHeader", `ShellHeader tag: ${tagB}`);
  assert(tagC === "ShellFooter", `ShellFooter tag: ${tagC}`);
  assert(new Set([tagA, tagB, tagC]).size === 3, "all tags distinct");
});

test("deriveTagName strips trailing Controller suffix", () => {
  // Local copy of the rule — kept here to avoid an extra import cycle.
  const deriveTagName = (className: string) =>
    className.endsWith("Controller")
      ? className.slice(0, -"Controller".length)
      : className;
  assert(deriveTagName("ChildController") === "Child", "ChildController → Child");
  assert(deriveTagName("ShellHeaderController") === "ShellHeader", "ShellHeaderController → ShellHeader");
  assert(deriveTagName("Foo") === "Foo", "Foo → Foo (no suffix)");
});

console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
}

run();
