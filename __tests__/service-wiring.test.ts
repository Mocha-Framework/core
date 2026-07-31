import { QObject, QProperty, qproperty, inject, Injectable, globalContainer, rootInjector } from "@mocha/core";
import { scanInjectedFields } from "@mocha/core/qml";

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

async function run(): Promise<void> {

// ════════════════════════════════════════════════════════════
// Service wiring: scanInjectedFields + Injectable registration
// ════════════════════════════════════════════════════════════

@Injectable({ providedIn: "root" })
class AuthService extends QObject {
  @qproperty user = new QProperty("alice");
}

@Injectable({ providedIn: "root" })
class CartService extends QObject {
  @qproperty total = new QProperty(0);
}

@Injectable()
class ViewScopedService extends QObject {
  @qproperty value = new QProperty(0);
}

test("scanInjectedFields detects fields whose type matches a root service", () => {
  class Controller extends QObject {
    @qproperty count = new QProperty(0);
    auth = inject(AuthService);
    cart = inject(CartService);
  }
  const c = new Controller();
  const aliases = scanInjectedFields(
    c,
    new Set(["AuthService", "CartService"])
  );
  assert(aliases.get("auth") === "AuthService", "auth → AuthService");
  assert(aliases.get("cart") === "CartService", "cart → CartService");
  assert(aliases.size === 2, `only 2 aliases, got ${aliases.size}`);
});

test("scanInjectedFields skips qproperties and computed", () => {
  class Controller extends QObject {
    @qproperty count = new QProperty(0);
    auth = inject(AuthService);
  }
  const c = new Controller();
  const aliases = scanInjectedFields(c, new Set(["AuthService", "QProperty"]));
  assert(aliases.has("auth"), "auth detected");
  assert(!aliases.has("count"), "qproperty count is not aliased");
});

test("scanInjectedFields skips view-scoped services (not in rootServiceNames)", () => {
  class Controller extends QObject {
    @qproperty count = new QProperty(0);
    viewSvc = inject(ViewScopedService);
  }
  const c = new Controller();
  const aliases = scanInjectedFields(c, new Set(["AuthService"]));
  assert(
    !aliases.has("viewSvc"),
    "view-scoped service not aliased (not in rootServiceNames)"
  );
});

test("scanInjectedFields handles controller without any inject fields", () => {
  class Controller extends QObject {
    @qproperty count = new QProperty(0);
  }
  const c = new Controller();
  const aliases = scanInjectedFields(c, new Set(["AuthService"]));
  assert(aliases.size === 0, "no aliases when no inject fields");
});

test("rootInjector.list returns all registered root services", () => {
  // AuthService, CartService, ViewScopedService are all registered
  // (Injectable defaults to "root" scope, only the providedIn check
  // differentiates them in our application logic).
  const tokens = rootInjector.list();
  const names = tokens.map((t: any) => t.name);
  assert(names.includes("AuthService"), "AuthService listed");
  assert(names.includes("CartService"), "CartService listed");
  assert(names.includes("ViewScopedService"), "ViewScopedService listed");
});

test("globalContainer.resolve returns the same singleton for repeated inject calls", () => {
  const a = globalContainer.resolve(AuthService as any);
  const b = globalContainer.resolve(AuthService as any);
  assert(a === b, "singleton reused across resolutions");
});

console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
}

run();
