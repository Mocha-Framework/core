import { QObject, QProperty } from "../index.js";
import { Logger } from "../utils/index.js";
import { QMLTemplateParser, type ParsedQMLDocument, type QMLBindingMap } from "./qml-parser.js";
import { BindingEngine } from "./binding.js";
import { QmlAstParser, type QmlDocument } from "./qml-ast-parser.js";
import { analyzeQmlStructure } from "./qml-structure.js";
import { encodeBridgeCall } from "@mocha/bridge-api";

const logger = new Logger("QMLComponent");
const parser = new QMLTemplateParser();
const astParser = new QmlAstParser();

export interface QMLComponentOptions {
  /**
   * The QML template body. Optional — omit when the class is a pure
   * service (use `@Injectable({ providedIn: "root" })` instead).
   */
  qml?: string;
  imports?: string[];
  autoBind?: boolean;
  hotReload?: boolean;
  providedIn?: "root" | "view";
  /**
   * The QML tag name that this component is registered as.
   *
   * Allows a parent controller's QML template to use `<Child>` shorthand
   * to instantiate this controller. If omitted, the tag is derived from
   * the class name by stripping a trailing `Controller` suffix
   * (e.g. `ChildController` → `Child`).
   */
  as?: string;
}

export interface QMLComponentMetadata {
  options: QMLComponentOptions;
  document: ParsedQMLDocument;
  bindings: QMLBindingMap;
  componentName: string;
  /** The tag name used in QML templates to instantiate this component. */
  tagName: string;
  providedIn: "root" | "view";
}

const componentRegistry = new Map<Function, QMLComponentMetadata>();
const tagToClass = new Map<string, Function>();

export interface ProxyEntry {
  proxyId: number;
  instance: QObject;
  componentName: string;
}

export function QMLComponent(options: QMLComponentOptions) {
  return function <T extends { new (...args: any[]): any }>(target: T): T {
    const componentName = target.name;
    const hasTemplate = typeof options.qml === "string" && options.qml.length > 0;
    const document: ParsedQMLDocument = hasTemplate
      ? parser.parse(options.qml as string)
      : { imports: [], root: { type: "", properties: {}, children: [], signalHandlers: {} } };
    const bindings: QMLBindingMap = hasTemplate
      ? parser.generateBindings(document, "controller")
      : {};

    const tagName = options.as ?? deriveTagName(componentName);

    const metadata: QMLComponentMetadata = {
      options,
      document,
      bindings,
      componentName,
      tagName,
      providedIn: options.providedIn || "view",
    };

    componentRegistry.set(target, metadata);
    if (hasTemplate) tagToClass.set(tagName, target);
    logger.debug(`Registered QML component: ${componentName} as <${tagName}>`);

    (target as any).__qmlComponent = metadata;
    (target as any).__qmlTemplate = options.qml ?? "";
    (target as any).__qmlDocument = document;
    (target as any).__qmlBindings = bindings;
    (target as any).__qmlTag = tagName;

    return target;
  };
}

/**
 * Derive a tag name from a class name. Strips a trailing `Controller`
 * suffix if present, e.g. `ChildController` → `Child`.
 */
export function deriveTagName(className: string): string {
  if (className.endsWith("Controller")) {
    return className.slice(0, -"Controller".length);
  }
  return className;
}

export function getQMLComponentMetadata(
  component: Function
): QMLComponentMetadata | undefined {
  return componentRegistry.get(component);
}

export function getAllQMLComponents(): Map<Function, QMLComponentMetadata> {
  return new Map(componentRegistry);
}

/**
 * Look up a registered controller class by its QML tag name.
 * Returns `undefined` if no controller is registered for that tag.
 */
export function getClassByTag(tag: string): Function | undefined {
  return tagToClass.get(tag);
}

/**
 * Get the full tag → class registry. Used by the child component walker.
 */
export function getTagRegistry(): Map<string, Function> {
  return new Map(tagToClass);
}

export function generateInnerQML(
  qml: string,
  templateForImports?: string
): { innerQML: string; imports: string[] } {
  const analysis = analyzeQmlStructure(qml, templateForImports);
  if (!analysis.rootTag || (analysis.rootTag !== "ApplicationWindow" && analysis.rootTag !== "Window")) {
    logger.info("[generateInnerQML] No Window/ApplicationWindow root found, returning full qml");
    return { innerQML: analysis.innerQML, imports: analysis.imports };
  }

  logger.info(`[generateInnerQML] ${analysis.rootTag} → inner: ${qml.length}b→${analysis.innerQML.length}b`);
  return { innerQML: analysis.innerQML, imports: analysis.imports };
}

export function generateQMLSource(
  component: QObject,
  metadata: QMLComponentMetadata,
  rootProxies?: ProxyEntry[],
  injectedFieldAliases?: Map<string, string>
): string {
  let qml = metadata.options.qml ?? "";

  // ── Deprecation: warn if user wrote controller.bridgeCall in their template ──
  // Non-controller proxies (CounterState, etc.) still need bridgeCall.
  if (/controller\.bridgeCall\b/.test(qml)) {
    logger.warn(
      `[deprecated] controller.bridgeCall found in QML template of ${metadata.componentName}. ` +
      "Use controller.methodName() directly — the framework routes it internally. " +
      'Example: controller.echo() instead of controller.bridgeCall("echo").'
    );
  }

  // ── Inject field rewrites: controller.<field>.X → <ClassName>.X ──
  // Strips trailing `.value` when rewriting QProperty reads, matching
  // the controller.X.value → controller.X behavior so the resolved
  // proxy access uses the underlying QQmlPropertyMap property directly.
  const injectedClassNames = new Set<string>();
  if (injectedFieldAliases && injectedFieldAliases.size > 0) {
    for (const [field, className] of injectedFieldAliases) {
      const reProp = new RegExp(`controller\\.${field}\\.(?!bridgeCall\\b)(\\w+)\\.value\\b`, "g");
      qml = qml.replace(reProp, `${className}.$1`);
      const reMethod = new RegExp(`controller\\.${field}\\.(?!bridgeCall\\b)(\\w+)`, "g");
      qml = qml.replace(reMethod, `${className}.$1`);
      injectedClassNames.add(className);
    }
  }

  // ── Property access: controller.xxx.value → controller.xxx ──
  qml = qml.replace(/controller\.(\w+)\.value\b/g, 'controller.$1');

  // ── Method calls: controller.xxx(args) → bridgeCall ──
  // Handles nested parens (e.g. controller.foo(a, bar(b), c)) via depth counting.
  qml = replaceBridgeCalls(qml, "controller", (method, rawArgs) => {
    const trimmed = rawArgs.trim();
    if (!trimmed) return `controller.bridgeCall("${method}")`;
    return `controller.bridgeCall(JSON.stringify(["${method}", ${trimmed}]))`;
  });

  // ── Transform .get("X") + method() calls for root proxies ──
  // Injected services participate in the same proxy transforms as
  // root services declared via `@QMLComponent({ providedIn: "root" })`.
  const rootNames = new Set<string>();
  if (rootProxies) for (const proxy of rootProxies) rootNames.add(proxy.componentName);
  for (const name of injectedClassNames) rootNames.add(name);

  if (rootNames.size > 0) {
    for (const name of rootNames) {
      // Property access: Xxx.get("prop") → Xxx.prop
      qml = qml.replace(
        new RegExp(name + '\\.get\\("([^"]*)"\\)', 'g'),
        `${name}.$1`
      );
      // Method calls: Xxx.method() → Xxx.bridgeCall("method")
      qml = replaceBridgeCalls(qml, name, (method, rawArgs) => {
        const trimmed = rawArgs.trim();
        if (!trimmed) return `${name}.bridgeCall("${method}")`;
        return `${name}.bridgeCall(JSON.stringify(["${method}", ${trimmed}]))`;
      });
    }
  }

  return qml;
}

// ── Helper: depth-aware method call → bridgeCall replacer ──

function replaceBridgeCalls(
  qml: string,
  target: string,
  map: (method: string, rawArgs: string) => string
): string {
  let result = "";
  let i = 0;
  const prefix = target + ".";
  const bridgeCallPrefix = target + ".bridgeCall(";

  while (i < qml.length) {
    const next = qml.indexOf(prefix, i);
    if (next === -1) { result += qml.slice(i); break; }

    result += qml.slice(i, next);
    i = next + prefix.length;

    // Skip if it's bridgeCall (already transformed or legacy)
    if (qml.startsWith("bridgeCall", i)) {
      result += target + ".bridgeCall";
      i += "bridgeCall".length;
      continue;
    }

    // Read method name: target.METHOD(
    const methodMatch = /^(\w+)\s*\(/.exec(qml.slice(i));
    if (!methodMatch) { result += qml.slice(next, i + 1); i = next + prefix.length + 1; continue; }

    const method = methodMatch[1];
    i += method.length;
    while (i < qml.length && qml[i] === " ") i++;
    i++; // skip (

    let depth = 1;
    const argsStart = i;
    let inString: string | null = null;
    while (i < qml.length && depth > 0) {
      const ch = qml[i];
      if (inString) {
        if (ch === "\\") { i += 2; continue; }
        if (ch === inString) inString = null;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") { inString = ch; i++; continue; }
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }

    const rawArgs = qml.slice(argsStart, i - 1);
    result += map(method, rawArgs);
  }

  return result;
}

// ── Post-extraction injections (operate on inner QML, no Window wrapper) ──

export function applyInjections(
  innerQML: string,
  component: QObject,
  metadata: QMLComponentMetadata
): string {
  let result = innerQML;

  // Inject objectNames via string scanning (no AST dependency).
  // Finds every `id: "name"` or `id: name` and injects
  // `objectName: "name"` right after the opening { of its element.
  result = injectObjectNamesString(result);

  // Inject router hooks — uses bridgeCall internally.
  // bridgeCall here is injected code, not user-written, so no deprecation warning.
  const hasLeave = typeof (component as any).routeLeave === "function";
  const hasEnter = typeof (component as any).routeEnter === "function";
  if (hasLeave || hasEnter) {
    let hooks = "";
    if (hasLeave) hooks += `\n        onRouteLeave: (path) => controller.bridgeCall(JSON.stringify(["routeLeave", path]))`;
    if (hasEnter) hooks += `\n        onRouteEnter: (path) => controller.bridgeCall(JSON.stringify(["routeEnter", path]))`;
    result = result.replace(/Router\s*\{/, `Router {${hooks}`);
  }

  // Inject autoBind via string scanning (no AST dependency).
  if (metadata.options.autoBind) {
    result = injectAutoBindString(result, component);
  }

  return result;
}

// ── String-based injectors (no AST dependency) ──

function injectObjectNamesString(qml: string): string {
  // Match id: "name" or id: name and inject objectName right after it
  return qml.replace(/\bid\s*:\s*"?(\w+)"?/g, (match, name) => {
    return `${match}; objectName: "${name}"`;
  });
}

function injectAutoBindString(qml: string, component: QObject): string {
  // Collect @qproperty names
  const qprops = new Set<string>();
  let proto = Object.getPrototypeOf(component);
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key.startsWith("__qproperty_")) {
        qprops.add(key.replace("__qproperty_", ""));
      }
    }
    proto = Object.getPrototypeOf(proto);
  }

  const elementBindings: Record<string, { signal: string; prop: string }> = {
    TextField: { signal: "onTextChanged", prop: "text" },
    TextInput: { signal: "onTextEdited", prop: "text" },
    TextArea: { signal: "onTextChanged", prop: "text" },
    Checkbox: { signal: "onCheckedChanged", prop: "checked" },
    Switch: { signal: "onCheckedChanged", prop: "checked" },
    Slider: { signal: "onValueChanged", prop: "value" },
    SpinBox: { signal: "onValueChanged", prop: "value" },
  };

  const result = qml.split("\n");
  // Find elements whose id matches a qproperty.
  // Pattern: TagName { (possibly on same line as id)
  const idRe = /\bid\s*:\s*"?(\w+)"?/g;

  // Collect bottom-to-top
  const hits: { name: string; line: number; tag: string }[] = [];
  for (let i = 0; i < result.length; i++) {
    const m = idRe.exec(result[i]);
    if (m && qprops.has(m[1])) {
      // Find the tag on this line or the line above (where { is)
      let tagLine = i;
      while (tagLine >= 0 && !result[tagLine].includes("{")) tagLine--;
      if (tagLine < 0) continue;
      const tagMatch = result[tagLine].trim().match(/^(\w+)\s*\{/);
      if (!tagMatch) continue;
      const tag = tagMatch[1];
      const binding = elementBindings[tag];
      if (!binding) continue;
      hits.push({ name: m[1], line: tagLine, tag });
    }
    idRe.lastIndex = 0;
  }

  hits.sort((a, b) => b.line - a.line);

  for (const hit of hits) {
    const indent = result[hit.line].match(/^\s*/)?.[0] ?? "    ";
    const prop = elementBindings[hit.tag].prop;
    const signal = elementBindings[hit.tag].signal;

    // Inject two-way binding: property = controller.xxx
    // This makes the QML property react to controller changes.
    const bindingLine = `${indent}  ${prop}: controller.${hit.name}`;
    result.splice(hit.line + 1, 0, bindingLine);
    hits.forEach(h => { if (h.line >= hit.line + 1) h.line++; });

    // Inject one-way signal: onXxxChanged → bridgeCall
    // This sends QML property changes to the controller.
    const signalLine = `${indent}  ${signal}: controller.bridgeCall(JSON.stringify(["_bind_${hit.name}", ${prop}]))`;
    result.splice(hit.line + 2, 0, signalLine);
    hits.forEach(h => { if (h.line >= hit.line + 2) h.line++; });
  }

  return result.join("\n");
}

function injectObjectNames(qml: string, doc: QmlDocument): string {
  if (!doc.root) return qml;
  const elements = astParser.findElements(doc.root, (el) => el.id !== null && el.tag !== "#text");
  elements.sort((a, b) => b.startLine - a.startLine);
  let result = qml;
  for (const el of elements) {
    if (!el.id) continue;
    const lineIdx = el.startLine - 1;
    const lines = result.split("\n");
    if (lineIdx >= lines.length) continue;
    const line = lines[lineIdx];
    if (line.includes("objectName:")) continue;
    const indent = line.match(/^\s*/)?.[0] ?? "    ";
    lines.splice(lineIdx + 1, 0, `${indent}  objectName: "${el.id}"`);
    result = lines.join("\n");
  }
  return result;
}

function injectRouterHooks(qml: string, doc: QmlDocument, hasLeave: boolean, hasEnter: boolean): string {
  if (!hasLeave && !hasEnter) return qml;
  const routers = doc.root ? astParser.findElements(doc.root, (el) => el.tag === "Router") : [];
  if (routers.length === 0) return qml;
  let hooks = "";
  if (hasLeave) {
    hooks += `\n        onRouteLeave: (path) => controller.bridgeCall(JSON.stringify(["routeLeave", path]))`;
  }
  if (hasEnter) {
    hooks += `\n        onRouteEnter: (path) => controller.bridgeCall(JSON.stringify(["routeEnter", path]))`;
  }
  return qml.replace(/Router\s*\{/, `Router {${hooks}`);
}

function injectAutoBind(qml: string, doc: QmlDocument, component: QObject): string {
  const qprops = new Set<string>();
  let proto = Object.getPrototypeOf(component);
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key.startsWith("__qproperty_")) {
        qprops.add(key.replace("__qproperty_", ""));
      }
    }
    proto = Object.getPrototypeOf(proto);
  }

  const elementBindings: Record<string, { signal: string; prop: string }> = {
    TextField: { signal: "onTextChanged", prop: "text" },
    TextInput: { signal: "onTextEdited", prop: "text" },
    TextArea: { signal: "onTextChanged", prop: "text" },
    Checkbox: { signal: "onCheckedChanged", prop: "checked" },
    Switch: { signal: "onCheckedChanged", prop: "checked" },
    Slider: { signal: "onValueChanged", prop: "value" },
    SpinBox: { signal: "onValueChanged", prop: "value" },
  };

  if (!doc.root) return qml;
  const targets = astParser.findElements(doc.root, (el) => el.id !== null && qprops.has(el.id!));
  targets.sort((a, b) => b.startLine - a.startLine);

  let result = qml;
  for (const el of targets) {
    if (!el.id) continue;
    const binding = elementBindings[el.tag];
    if (!binding) continue;
    const lineIdx = el.startLine - 1;
    const lines = result.split("\n");
    if (lineIdx >= lines.length) continue;
    const line = lines[lineIdx];
    const indent = line.match(/^\s*/)?.[0] ?? "    ";
    const inject = `${indent}  ${binding.signal}: controller.bridgeCall(JSON.stringify(["_bind_${el.id}", ${binding.prop}]))`;
    lines.splice(lineIdx + 1, 0, inject);
    result = lines.join("\n");
  }

  return result;
}

export function generateQMLFile(
  component: QObject,
  metadata: QMLComponentMetadata
): string {
  const header = [
    "import QtQuick",
    "import QtQuick.Controls",
    "import QtQuick.Layouts",
  ].join("\n");

  const body = generateQMLSource(component, metadata);

  return `${header}\n\n${body}`;
}
