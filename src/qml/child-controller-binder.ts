import { Logger } from "../utils/index.js";
import {
  QObject,
  QProperty,
  QComputedProperty,
  effect,
  isInputRef,
  isOutputRef,
  isModelRef,
  type InputRef,
  type OutputRef,
  type ModelRef,
} from "../index.js";
import { findChildComponentUsages, type ChildComponentUsage } from "./child-component-walker.js";
import { getQMLComponentMetadata, type ProxyEntry } from "./qml-component.js";
import { scanProperties } from "./run-app.js";

const logger = new Logger("child-binder");

export interface ChildBindingEntry {
  /** The child controller instance. */
  instance: QObject;
  /** The class constructor. */
  classCtor: Function;
  /** The QML tag name. */
  tag: string;
  /** The component name (e.g. `ChildController`). */
  componentName: string;
  /** The proxy ID for the child's bridge. */
  proxyId: number;
  /** The context property name (e.g. `controller` or `childController`). */
  contextName: string;
  /** Cleanup function to release effects/subscriptions. */
  dispose: () => void;
}

export interface ChildBindingResult {
  /** All bound child controllers. */
  children: ChildBindingEntry[];
  /** QML source — unchanged for now; child tag wiring is via context property. */
  qml: string;
}

/**
 * Bind child controllers found in the parent QML template.
 *
 * For each `<Child { name: controller.foo }>` usage:
 * 1. Instantiate the child controller (if not already).
 * 2. Create a bridge proxy for it.
 * 3. Bind `qproperty`/`input`/`model` fields on the child to the proxy.
 * 4. Set up one-way or two-way reactive bindings from parent expression → child.
 * 5. Register the child as a context property so the QML can reference it.
 *
 * For now, the binding is purely TS-side (parent controller → child controller).
 * The QML `controller.<child>.<field>` syntax resolves via the child's proxy.
 */
export function bindChildControllers(
  parent: QObject,
  parentQML: string,
  nativeApp: any,
  parentProxyEntries: ProxyEntry[]
): ChildBindingResult {
  const usages = findChildComponentUsages(parentQML);
  if (usages.length === 0) {
    return { children: [], qml: parentQML };
  }

  logger.info(`[child-bind] found ${usages.length} child component usage(s)`);

  const children: ChildBindingEntry[] = [];

  for (const usage of usages) {
    const entry = bindOneChild(parent, usage, nativeApp, parentProxyEntries);
    if (entry) children.push(entry);
  }

  return { children, qml: parentQML };
}

function bindOneChild(
  parent: QObject,
  usage: ChildComponentUsage,
  nativeApp: any,
  parentProxyEntries: ProxyEntry[]
): ChildBindingEntry | null {
  const { classCtor, componentName, tag, attrs } = usage;
  const meta = getQMLComponentMetadata(classCtor);
  if (!meta) {
    logger.warn(`[child-bind] no @QMLComponent metadata for ${componentName}`);
    return null;
  }

  // Reuse existing instance if parent already has one assigned to a field
  // matching the tag (e.g. `childController = new ChildController()`).
  const found: QObject | null = findExistingChildInstance(parent, tag, componentName);
  if (!found) {
    let fresh: QObject;
    try {
      fresh = new (classCtor as any)();
    } catch (err) {
      logger.error(`[child-bind] failed to instantiate ${componentName}: ${(err as Error).message}`);
      return null;
    }
    return wireChild(parent, fresh, classCtor, componentName, tag, attrs, nativeApp, parentProxyEntries);
  }
  return wireChild(parent, found, classCtor, componentName, tag, attrs, nativeApp, parentProxyEntries);
}

function wireChild(
  parent: QObject,
  instance: QObject,
  classCtor: Function,
  componentName: string,
  tag: string,
  attrs: Record<string, string>,
  nativeApp: any,
  parentProxyEntries: ProxyEntry[]
): ChildBindingEntry {
  // Make the instance a child of `parent` for lifecycle.
  try {
    (instance as any).parent = parent;
  } catch {
    // QObject.parent setter may throw if not yet initialized; ignore.
  }

  // Create bridge proxy for the child.
  const proxyId: number = nativeApp.createProxy();
  parentProxyEntries.push({ proxyId, instance, componentName });

  // Bind the child's @qproperty, @input, @model fields to its proxy.
  const disposers: Array<() => void> = [];
  bindChildFieldsToProxy(instance, proxyId, nativeApp, disposers);

  // Bind parent QML attributes (e.g. `name: controller.foo`) to child inputs.
  bindParentAttributesToChild(parent, instance, attrs, disposers);

  // Wire child outputs / model changes to parent if parent has a matching handler.
  wireChildOutputsToParent(parent, instance, disposers);

  const contextName = lowerFirst(tag);
  nativeApp.setContextProperty(contextName, proxyId);

  const dispose = () => {
    for (const d of disposers) {
      try { d(); } catch { /* ignore */ }
    }
  };

  logger.info(`[child-bind] bound <${tag}> (${componentName}) as context property "${contextName}", proxyId=${proxyId}`);

  return {
    instance,
    classCtor,
    tag,
    componentName,
    proxyId,
    contextName,
    dispose,
  };
}

function findExistingChildInstance(
  parent: QObject,
  tag: string,
  componentName: string
): QObject | null {
  const candidates = [
    lowerFirst(tag),
    lowerFirst(componentName),
    tag,
    componentName,
  ];
  for (const key of candidates) {
    const val = (parent as any)[key];
    if (val && val instanceof QObject && val.constructor === (parent as any)[key]?.constructor) {
      // Heuristic: skip if the constructor is the parent class itself.
      if (val.constructor === parent.constructor) continue;
    }
    if (val instanceof QObject && val !== parent) {
      return val;
    }
  }
  return null;
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

function bindChildFieldsToProxy(
  child: QObject,
  proxyId: number,
  nativeApp: any,
  disposers: Array<() => void>
): void {
  const props = scanProperties(child);
  for (const { name, qp } of props) {
    if (qp instanceof QComputedProperty) {
      const conn = qp.changed.connect((val: any) => nativeApp.proxySetValue(proxyId, name, val));
      nativeApp.proxySetValue(proxyId, name, qp.value);
      disposers.push(() => conn.disconnect());
    } else if (qp instanceof QProperty) {
      const eff = effect(() => {
        nativeApp.proxySetValue(proxyId, name, qp.value);
      });
      disposers.push(() => eff.destroy());
    }
  }

  // Bind InputRef fields.
  for (const key of Object.keys(child)) {
    const val = (child as any)[key];
    if (isInputRef(val)) {
      const ref = val as InputRef<unknown>;
      const eff = effect(() => {
        nativeApp.proxySetValue(proxyId, key, ref.value);
      });
      disposers.push(() => eff.destroy());
    } else if (isModelRef(val)) {
      const ref = val as ModelRef<unknown>;
      const eff = effect(() => {
        nativeApp.proxySetValue(proxyId, key, ref.value);
      });
      disposers.push(() => eff.destroy());
    }
  }

  // Walk prototype for class-level field declarations.
  let proto = Object.getPrototypeOf(child);
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key.startsWith("_") || key === "constructor") continue;
      const val = (child as any)[key];
      if (isInputRef(val)) {
        const ref = val as InputRef<unknown>;
        const eff = effect(() => {
          nativeApp.proxySetValue(proxyId, key, ref.value);
        });
        disposers.push(() => eff.destroy());
      } else if (isModelRef(val)) {
        const ref = val as ModelRef<unknown>;
        const eff = effect(() => {
          nativeApp.proxySetValue(proxyId, key, ref.value);
        });
        disposers.push(() => eff.destroy());
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
}

function bindParentAttributesToChild(
  parent: QObject,
  child: QObject,
  attrs: Record<string, string>,
  disposers: Array<() => void>
): void {
  for (const [attrName, attrExpr] of Object.entries(attrs)) {
    const target = resolveChildField(child, attrName);
    if (!target) {
      logger.debug(`[child-bind] no InputRef/ModelRef/QProperty on child for attribute "${attrName}"`);
      continue;
    }

    const resolved = resolveParentExpression(parent, attrExpr);
    if (!resolved) {
      logger.debug(`[child-bind] could not resolve parent expression "${attrExpr}"`);
      continue;
    }

    // One-way: parent → child input.
    const eff = effect(() => {
      const val = resolved.read();
      target.set(val);
    });
    disposers.push(() => eff.destroy());

    // Two-way: if target is a ModelRef, also propagate child → parent.
    if (isModelRef(target)) {
      const modelRef = target as ModelRef<unknown>;
      const sub = modelRef.change.subscribe((val: unknown) => {
        resolved.write(val);
      });
      disposers.push(() => sub());
    }
  }
}

function resolveChildField(child: QObject, name: string): InputRef<unknown> | ModelRef<unknown> | QProperty<unknown> | null {
  const val = (child as any)[name];
  if (isInputRef(val)) return val as InputRef<unknown>;
  if (isModelRef(val)) return val as ModelRef<unknown>;
  if (val instanceof QProperty) return val as QProperty<unknown>;
  // Walk prototype.
  let proto = Object.getPrototypeOf(child);
  while (proto && proto !== Object.prototype) {
    const v = (proto as any)[name];
    if (isInputRef(v)) return v as InputRef<unknown>;
    if (isModelRef(v)) return v as ModelRef<unknown>;
    if (v instanceof QProperty) return v as QProperty<unknown>;
    proto = Object.getPrototypeOf(proto);
  }
  return null;
}

interface ResolvedExpression {
  read(): unknown;
  write(value: unknown): void;
}

function resolveParentExpression(parent: QObject, expr: string): ResolvedExpression | null {
  const trimmed = expr.trim();

  // controller.<name>  → parent.<name>
  if (trimmed.startsWith("controller.")) {
    const path = trimmed.slice("controller.".length);
    return resolvePath(parent, path);
  }

  // Direct dotted path → parent resolve
  if (trimmed.includes(".")) {
    return resolvePath(parent, trimmed);
  }

  // Reserved keyword literals
  if (trimmed === "true") return { read: () => true, write: () => {} };
  if (trimmed === "false") return { read: () => false, write: () => {} };
  if (trimmed === "null") return { read: () => null, write: () => {} };
  if (trimmed === "undefined") return { read: () => undefined, write: () => {} };

  // Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    return { read: () => n, write: () => {} };
  }

  // String literal (parser may have stripped quotes)
  if (/^["'].*["']$/.test(trimmed)) {
    const s = trimmed.slice(1, -1);
    return { read: () => s, write: () => {} };
  }

  // Bare identifier: try as parent field first, fall back to string literal
  if (/^\w+$/.test(trimmed)) {
    const direct = (parent as any)[trimmed];
    if (direct !== undefined) {
      return resolvePath(parent, trimmed);
    }
    return { read: () => trimmed, write: () => {} };
  }

  // Unsupported (e.g. method calls, complex expressions)
  logger.debug(`[child-bind] unsupported parent expression: "${expr}"`);
  return null;
}

function resolvePath(parent: QObject, path: string): ResolvedExpression | null {
  const segments = path.split(".");
  let current: any = parent;
  for (const seg of segments) {
    if (current == null) return null;
    current = current[seg];
  }
  if (current == null) return null;

  // If it's a QProperty, read its `.value` and write by setting `.value`.
  if (current instanceof QProperty) {
    return {
      read: () => current.value,
      write: (v: unknown) => { current.value = v; },
    };
  }

  // If it's an InputRef / ModelRef, expose its value.
  if (isInputRef(current) || isModelRef(current)) {
    const ref = current as InputRef<unknown> | ModelRef<unknown>;
    return {
      read: () => ref.value,
      write: (v: unknown) => { ref.set(v); },
    };
  }

  // Plain value
  return {
    read: () => current,
    write: (v: unknown) => { current = v; },
  };
}

function wireChildOutputsToParent(
  parent: QObject,
  child: QObject,
  disposers: Array<() => void>
): void {
  // For each @OutputRef on the child, look for a matching handler on the parent.
  // Convention: parent has a method named `onChild<OutputName>` (e.g. `onChildClicked`).
  // For class-level fields, only walk the prototype to find the OutputRef.
  let proto = Object.getPrototypeOf(child);
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key.startsWith("_") || key === "constructor") continue;
      const val = (child as any)[key];
      if (!isOutputRef(val)) continue;
      const outRef = val as OutputRef<unknown>;
      const handlerName = `on${capitalize(key)}`;
      const handler = (parent as any)[handlerName];
      if (typeof handler === "function") {
        const sub = outRef.subscribe((v: unknown) => handler.call(parent, v));
        disposers.push(() => sub());
        logger.debug(`[child-bind] wired child.${key} → parent.${handlerName}`);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }

  // Same for own properties.
  for (const key of Object.keys(child)) {
    const val = (child as any)[key];
    if (!isOutputRef(val)) continue;
    const outRef = val as OutputRef<unknown>;
    const handlerName = `on${capitalize(key)}`;
    const handler = (parent as any)[handlerName];
    if (typeof handler === "function") {
      const sub = outRef.subscribe((v: unknown) => handler.call(parent, v));
      disposers.push(() => sub());
      logger.debug(`[child-bind] wired child.${key} → parent.${handlerName}(own)`);
    }
  }
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
