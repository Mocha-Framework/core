import { Logger } from "../utils/index.js";
import { QObject, QProperty, QComputedProperty, effect, globalContainer, DebugServer, MochaForm } from "../index.js";
import { getQMLComponentMetadata, getAllQMLComponents, generateQMLSource, applyInjections, type ProxyEntry } from "./qml-component.js";
import { bindChildControllers } from "./child-controller-binder.js";
import {
  setNativeAppRef,
  createLazyViewChild,
  getViewChildStateProps,
  invalidateAllViewChildren,
  type ViewChildRef,
} from "./view-child.js";
import { analyzeQmlStructure, extractLatestTaggedQmlTemplate, type QmlWindowProps } from "./qml-structure.js";
import { parseBridgeCall, validateBridgeCall, serializePropertyValue, deserializePropertyValue } from "@mocha/bridge-api";
import * as path from "node:path";
import * as fs from "node:fs";

// ThemeData interface — duck-typed, avoids composit-build import issues with @mocha/tokens
export interface ThemeLike {
  toQMLOverrides(): Record<string, string>;
}

const logger = new Logger("runApp");

let _debugServer: DebugServer | null = null;

let _brandThemeProxyId: number | null = null;
let _brandThemeNativeApp: any = null;

export function switchTheme(theme: ThemeLike): void {
  if (!_brandThemeNativeApp || _brandThemeProxyId === null) {
    logger.warn("[theme] switchTheme called but _brandTheme not initialized");
    return;
  }
  const overrides = theme.toQMLOverrides();
  for (const [key, value] of Object.entries(overrides)) {
    _brandThemeNativeApp.proxySetValue(_brandThemeProxyId, key, value);
  }
  logger.info(`[theme] switchTheme: updated ${Object.keys(overrides).length} overrides`);
}

export function getDebugServer() {
  return _debugServer;
}

export function getCurrentNativeApp(): any | null {
  return _currentCtx?.nativeApp ?? null;
}

export function stopApp(): void {
  if (!_currentCtx) return;
  _currentCtx.stopRequested = true;
  try {
    _currentCtx.cleanupWatchMode?.();
  } catch (err) {
    logger.warn(`[HMR] Failed to cleanup watch mode: ${(err as any)?.message ?? err}`);
  }
  try {
    _currentCtx.nativeApp?.quit?.();
  } catch (err) {
    logger.warn(`[app] Failed to quit native app: ${(err as any)?.message ?? err}`);
  }
}

export interface RunAppOptions {
  mode?: "development" | "production";
  basePath?: string;
  onReady?: () => void;
  devtools?: DevToolsIntegration;
  fallbackMode?: "warn" | "error" | "silent" | "mock";
  watch?: boolean;
  theme?: ThemeLike;
}

export interface DevToolsIntegration {
  port?: number;
  host?: string;
  autoStart?: boolean;
}

interface AppContext {
  nativeApp: any;
  proxyEntries: ProxyEntry[];
  controller: any;
  meta: any;
  componentClass: any;
  options?: RunAppOptions;
  propsSnapshot: Map<string, unknown>;
  shellLoaded: boolean;
  lastGoodShellSource: string | null;
  lastGoodWindowProps: QmlWindowProps | null;
  lastReloadError: HMRReloadError | null;
  stopRequested: boolean;
  cleanupWatchMode?: () => void;
}

type HMRReloadPhase = "extract" | "generate" | "swap" | "restore";

interface HMRReloadError {
  phase: HMRReloadPhase;
  message: string;
  file?: string;
  details?: string;
}

interface CompiledDevelopmentShell {
  shellSource: string;
  innerQML: string;
  imports: string[];
  windowProps: QmlWindowProps;
}

let _currentCtx: AppContext | null = null;

export async function runApp<T extends QObject>(
  componentClass: new (...args: any[]) => T,
  options?: RunAppOptions
): Promise<void> {
  const meta = getQMLComponentMetadata(componentClass);
  if (!meta) {
    throw new Error(
      `No QML metadata found for "${componentClass.name}". ` +
      "Did you forget the @QMLComponent decorator?"
    );
  }

  if (_currentCtx) {
    logger.info(`[HMR] runApp() called again — reusing existing ctx (shellLoaded=${_currentCtx.shellLoaded})`);
    _currentCtx.componentClass = componentClass;
    if (options) _currentCtx.options = options;
    await bindControllerToQML(_currentCtx);
    return;
  }

  let nativeApp: any = null;
  try {
    const { createNativeApp } = await import("@mocha/bridge-napi");
    nativeApp = await createNativeApp();
  } catch (err) {
    const platform = `${process.platform}-${process.arch}`;
    const candidate = `mocha-native.${process.platform}-${process.arch}-gnu.node`;
    const msg = [
      `[Mocha] Failed to load native bridge (platform: ${platform})`,
      `  Tried binary: ${candidate}`,
      `  Error: ${(err as Error)?.message ?? err}`,
      `  Qt6 required: ensure Qt6 is installed (qmake6 --version to check)`,
      `  Build: cd packages/bridge-napi && npm run build`,
      ``,
      `  Set MOCHA_FALLBACK_MOCK=1 to run with mock backend (no window)`,
    ].join("\n");

    const useMock = options?.fallbackMode === "mock" || process.env.MOCHA_FALLBACK_MOCK;
    if (!useMock) {
      throw new Error(msg);
    }
    logger.warn(msg + "\n  → Continuing with mock backend (MOCHA_FALLBACK_MOCK=1)");
    nativeApp = createMockNativeApp();
  }
  setNativeAppRef(nativeApp);
  // Expose for inspection in dev/test scripts
  (globalThis as any).__mochaNative = nativeApp;

  const ctx: AppContext = {
    nativeApp,
    proxyEntries: [],
    controller: null,
    meta,
    componentClass,
    options,
    propsSnapshot: new Map(),
    shellLoaded: false,
    lastGoodShellSource: null,
    lastGoodWindowProps: null,
    lastReloadError: null,
    stopRequested: false,
  };
  _currentCtx = ctx;

  const isDevelopmentWatch = ctx.options?.mode !== "production" &&
    (options?.watch || process.env.MOCHA_ENV === "development");
  if (isDevelopmentWatch) {
    ctx.cleanupWatchMode = startWatchMode(ctx);
  }

  await bindControllerToQML(ctx);

  try {
    await startDebugServer(ctx);
  } catch (err) {
    logger.warn(`Debug server failed to start (app will run without debugger): ${(err as any)?.message ?? err}`);
  }

  const isProduction = ctx.options?.mode === "production" || process.env.NODE_ENV === "production";
  if (!isProduction && !ctx.cleanupWatchMode && (options?.watch || process.env.MOCHA_ENV === "development")) {
    ctx.cleanupWatchMode = startWatchMode(ctx);
  }

  await runEventLoop(ctx, nativeApp, ctx.proxyEntries);

  if (_debugServer) {
    try { await _debugServer.stop(); } catch {}
  }
}

async function bindControllerToQML(ctx: AppContext): Promise<void> {
  const { nativeApp } = ctx;
  const rootServices = scanRootServices();
  const controller = new ctx.componentClass();
  const newMeta = ctx.meta || getQMLComponentMetadata(controller.constructor);
  const compileEntries = rootServices.map((service) => ({
    proxyId: 0,
    instance: service.instance,
    componentName: service.componentName,
  }));
  const qmlSource = generateQMLSource(controller, newMeta, compileEntries);
  const isProduction = ctx.options?.mode === "production" || process.env.NODE_ENV === "production";
  const compiledShell = isProduction
    ? null
    : compileDevelopmentShell(qmlSource, controller, newMeta);

  ctx.proxyEntries.length = 0;

  for (const service of rootServices) {
    const proxyId = nativeApp.createProxy();
    ctx.proxyEntries.push({ proxyId, instance: service.instance, componentName: service.componentName });

    const props = scanProperties(service.instance);
    for (const { name, qp } of props) {
      if (qp instanceof QComputedProperty) {
        qp.changed.connect((val: any) => nativeApp.proxySetValue(proxyId, name, val));
        nativeApp.proxySetValue(proxyId, name, qp.value);
      } else {
        effect(() => {
          const val = qp.value;
          nativeApp.proxySetValue(proxyId, name, val);
        });
      }
    }
    nativeApp.setContextProperty(service.componentName, proxyId);
  }

  ctx.controller = controller;
  const CONTEXT_NAME = "controller";
  const mainProxyId = nativeApp.createProxy();
  ctx.proxyEntries.push({ proxyId: mainProxyId, instance: controller, componentName: CONTEXT_NAME });

  const mainProps = scanProperties(controller);
  logger.info(`[scanProperties] found ${mainProps.length} props on ${controller.constructor.name}`);
  for (const p of mainProps) {
    logger.info(`  - ${p.name}: initial=${JSON.stringify(p.qp.value)}${p.qp instanceof QComputedProperty ? " [computed]" : ""}`);
    if (ctx.propsSnapshot.has(p.name) && !(p.qp instanceof QComputedProperty)) {
      p.qp.value = ctx.propsSnapshot.get(p.name);
    }
  }
  for (const { name, qp } of mainProps) {
    if (qp instanceof QComputedProperty) {
      qp.changed.connect((val: any) => {
        logger.debug(`[computed] ${name} = ${JSON.stringify(val)}`);
        nativeApp.proxySetValue(mainProxyId, name, val);
      });
      nativeApp.proxySetValue(mainProxyId, name, qp.value);
    } else {
      effect(() => {
        const val = qp.value;
        logger.debug(`[effect] ${name} = ${JSON.stringify(val)}`);
        nativeApp.proxySetValue(mainProxyId, name, val);
      });
    }
  }
  nativeApp.setContextProperty(CONTEXT_NAME, mainProxyId);
  logger.info(`[setContextProperty] set ${CONTEXT_NAME} = proxyId ${mainProxyId}`);

  // Bind child controllers referenced via <Child { … }> tags in the QML template.
  // Runs after the main proxy so child proxies don't interfere with the main one.
  bindChildControllers(controller, qmlSource, nativeApp, ctx.proxyEntries);

  // Register MochaForm instances
  const forms: Array<{ instance: any; name: string }> = [];
  for (const key of Object.keys(controller)) {
    const val = (controller as any)[key];
    if (val && val instanceof MochaForm) {
      forms.push({ instance: val, name: key });
    }
  }
  for (const { instance: form, name } of forms) {
    const formProxyId = nativeApp.createProxy();
    ctx.proxyEntries.push({ proxyId: formProxyId, instance: form, componentName: name });

    const formProps = [
      { key: "valid", kind: "qc" as const },
      { key: "submitting", kind: "qp" as const },
    ];
    for (const { key, kind } of formProps) {
      const prop = (form as any)[key];
      if (!prop) continue;
      if (kind === "qc") {
        (prop as QComputedProperty<any>).changed.connect((val: any) =>
          nativeApp.proxySetValue(formProxyId, key, val)
        );
        nativeApp.proxySetValue(formProxyId, key, (prop as QComputedProperty<any>).value);
      } else {
        effect(() => {
          nativeApp.proxySetValue(formProxyId, key, (prop as QProperty<any>).value);
        });
      }
    }

    // Per-field value QPropertys — sync to proxy AND directly to QML element
    const fieldNames: string[] = form.fieldNames?.() ?? [];
    for (const fieldName of fieldNames) {
      const errProp = form.errorField?.(fieldName) as QProperty<string | null> | undefined;
      if (errProp) {
        const errorKey = `error_${fieldName}`;
        effect(() => {
          const v = errProp.value;
          nativeApp.proxySetValue(formProxyId, errorKey, v ?? "");
        });
      }
      const valProp = form.field?.(fieldName) as QProperty<any> | undefined;
      if (valProp) {
        const valueKey = `value_${fieldName}`;
        effect(() => {
          const v = valProp.value;
          nativeApp.proxySetValue(formProxyId, valueKey, v);
          // Directly set the QML TextField text (QQmlPropertyMap bindings are unreliable)
          const objHandle = nativeApp.findChild(fieldName + "Field");
          if (objHandle) {
            nativeApp.setQmlProperty(objHandle, "text", v ?? "");
          }
        });
      }
    }

    nativeApp.setContextProperty(name, formProxyId);
    logger.info(`[form] registered "${name}" as context property, proxyId=${formProxyId}`);
  }

  // Always inject _brandTheme before QML loads to prevent ReferenceError
  injectBrandTheme(nativeApp, ctx.options?.theme);
  const qmlWithImports = [
    "import QtQuick",
    "import QtQuick.Controls",
    "import QtQuick.Layouts",
    "",
    qmlSource,
  ].join("\n");
  logger.info(`[QML generated] ${qmlWithImports.length} bytes, preview: ${qmlWithImports.slice(0, 300).replace(/\n/g, "\\n")}`);

  if (isProduction) {
    const allImports = [...new Set([
      "import QtQuick",
      "import QtQuick.Controls",
      "import QtQuick.Layouts",
      ...(newMeta.options.imports || []),
    ])];
    const fullQML = [...allImports, "", qmlSource].join("\n");
    logger.info(`[QML production] ${fullQML.length} bytes, loading directly (no shell)`);
    nativeApp.loadQML(fullQML, ctx.options?.basePath || process.cwd());
    nativeApp.registerAppObjects?.();

    ctx.meta = newMeta;
    applyDarkTitleBar(nativeApp);
    resolveViewChildren(controller);
    ctx.options?.onReady?.();
    return;
  }

  if (!ctx.shellLoaded) {
    ctx.nativeApp.loadShell(ctx.options?.basePath || process.cwd());
    ctx.shellLoaded = true;
    logger.info("[HMR shell] First load: shell created + content injected");
  }

  applyCompiledShell(ctx, compiledShell!);
  invalidateAllViewChildren();
  logger.info("[HMR shell] Shell content applied and viewChild cache invalidated");

  ctx.meta = newMeta;

  applyDarkTitleBar(nativeApp);

  resolveViewChildren(controller);

  ctx.options?.onReady?.();
}

function compileDevelopmentShell(
  qmlSource: string,
  controller: QObject,
  metadata: any
): CompiledDevelopmentShell {
  const analysis = analyzeQmlStructure(qmlSource, metadata.options.qml);

  const injectedInner = applyInjections(analysis.innerQML, controller, metadata);
  const normalizedInner = analysis.imports.map((imp: string) => imp.replace(/\s+\d+\.\d+$/, "").trim());
  const allImports = [...new Set([
    "import QtQuick",
    "import QtQuick.Controls",
    "import QtQuick.Layouts",
    ...normalizedInner,
    ...(metadata.options.imports || []).map((i: string) => i.replace(/\s+\d+\.\d+$/, "").trim()),
  ])];
  const shellSource = [...allImports, "", injectedInner].join("\n");

  logger.info(`[HMR shell] innerQML=${analysis.innerQML.length}b→${injectedInner.length}b, imports=[${allImports.join(", ")}], shellSource=${shellSource.length}b`);
  logger.info(`[HMR shell] content preview: ${shellSource.slice(0, 500).replace(/\n/g, "\\n")}`);

  return {
    shellSource,
    innerQML: analysis.innerQML,
    imports: allImports,
    windowProps: analysis.windowProps,
  };
}

function applyCompiledShell(ctx: AppContext, compiled: CompiledDevelopmentShell): void {
  ctx.nativeApp.setShellSource(compiled.shellSource);
  applyShellWindowProps(ctx.nativeApp, compiled.windowProps);
  ctx.nativeApp.registerAppObjects?.();
  clearShellError(ctx);
  ctx.lastGoodShellSource = compiled.shellSource;
  ctx.lastGoodWindowProps = compiled.windowProps;
  ctx.lastReloadError = null;
}

function setShellError(ctx: AppContext, error: HMRReloadError): void {
  ctx.lastReloadError = error;
  try {
    ctx.nativeApp.setProperty("hmrExplicitErrorVisible", true);
    ctx.nativeApp.setProperty("hmrErrorTitle", `HMR ${error.phase} failed`);
    ctx.nativeApp.setProperty("hmrErrorMessage", error.message);
    ctx.nativeApp.setProperty("hmrErrorDetails", error.details ?? error.file ?? "");
  } catch (err) {
    logger.warn(`[HMR] Failed to surface shell error: ${(err as any)?.message ?? err}`);
  }
}

function clearShellError(ctx: AppContext): void {
  try {
    ctx.nativeApp.setProperty("hmrExplicitErrorVisible", false);
    ctx.nativeApp.setProperty("hmrErrorTitle", "");
    ctx.nativeApp.setProperty("hmrErrorMessage", "");
    ctx.nativeApp.setProperty("hmrErrorDetails", "");
  } catch {
    // Shell may not be loaded yet.
  }
}

function applyShellWindowProps(nativeApp: any, props: QmlWindowProps): void {
  nativeApp.setShellWindowProps({
    title: props.title,
    width: props.width,
    height: props.height,
  });
}

function normalizeReloadError(
  err: unknown,
  phase: HMRReloadPhase,
  file?: string
): HMRReloadError {
  if (err instanceof Error) {
    return {
      phase,
      file,
      message: err.message,
      details: err.stack,
    };
  }

  return {
    phase,
    file,
    message: String(err),
  };
}

function startWatchMode(ctx: AppContext): () => void {
  const basePath = process.env.MOCHA_ENTRY_DIR || ctx.options?.basePath || process.cwd();

  let srcDir = path.join(basePath, "src");
  if (!fs.existsSync(srcDir)) {
    srcDir = basePath;
  }

  if (!fs.existsSync(srcDir)) {
    logger.warn(`Watch directory not found: ${srcDir} — watch mode disabled`);
    return () => {};
  }

  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  const cleanupFns: Array<() => void> = [];

  const handleFileChange = async (filename: string) => {
    if (!filename || !filename.endsWith(".qml.ts")) return;

    if (reloadTimer) clearTimeout(reloadTimer);

    reloadTimer = setTimeout(async () => {
      const changedPath = path.resolve(srcDir, filename);
      logger.info(`[HMR] File changed: ${filename}`);

      const snapshot = captureState(ctx.controller);
      const vcSnapshot = captureViewChildState(ctx.controller);
      ctx.propsSnapshot = snapshot;
      const previousTemplate = ctx.meta.options.qml;
      let phase: HMRReloadPhase = "extract";

      try {
        const start = Date.now();
        const source = fs.readFileSync(changedPath, "utf-8");
        const extracted = extractLatestTaggedQmlTemplate(source);
        ctx.meta.options.qml = extracted.template;
        logger.debug(`[HMR] Updated QML template (${ctx.meta.options.qml.length}b)`);

        phase = "generate";
        await bindControllerToQML(ctx);
        phase = "restore";
        await restoreViewChildState(ctx.controller, vcSnapshot);
        const elapsed = Date.now() - start;
        logger.info(`[HMR] Reloaded in ${elapsed}ms`);
      } catch (err) {
        ctx.meta.options.qml = previousTemplate;
        const reloadError = normalizeReloadError(err, phase, filename);
        setShellError(ctx, reloadError);
        logger.error(`[HMR] Reload failed: ${filename}`, err);
      }
    }, 100);
  };

  // Primary: fs.watch (event-driven, instant)
  try {
    const watcher = fs.watch(srcDir, { recursive: true }, (_event, filename) => {
      if (filename) handleFileChange(filename);
    });
    watcher.on("error", (err) => {
      logger.warn(`[HMR] fs.watch error: ${(err as any)?.message ?? err} — falling back to polling`);
      cleanupFns.push(startPollingFallback(srcDir, handleFileChange));
    });
    cleanupFns.push(() => watcher.close());
    logger.info(`[HMR] Watching ${srcDir} for .qml.ts changes (fs.watch)...`);
  } catch (err) {
    logger.warn(`[HMR] fs.watch failed: ${(err as any)?.message ?? err} — using polling`);
    cleanupFns.push(startPollingFallback(srcDir, handleFileChange));
  }

  return () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    for (const cleanup of cleanupFns) {
      try { cleanup(); } catch {}
    }
  };
}

function startPollingFallback(srcDir: string, onChange: (filename: string) => void): () => void {
  // Poll all .qml.ts files in the directory using fs.watchFile (stat-based)
  const files: string[] = [];
  const fullPaths: string[] = [];
  try {
    for (const entry of fs.readdirSync(srcDir, { recursive: true })) {
      const name = String(entry);
      if (name.endsWith(".qml.ts")) {
        files.push(name);
        const fullPath = path.join(srcDir, name);
        fullPaths.push(fullPath);
        fs.watchFile(fullPath, { interval: 500 }, (curr, prev) => {
          if (curr.mtimeMs !== prev.mtimeMs) {
            onChange(name);
          }
        });
      }
    }
    logger.info(`[HMR] Polling ${files.length} .qml.ts files in ${srcDir}...`);
  } catch (err) {
    logger.error(`[HMR] Polling setup failed: ${(err as any)?.message ?? err}`);
  }

  return () => {
    for (const fullPath of fullPaths) {
      try { fs.unwatchFile(fullPath); } catch {}
    }
  };
}

function findComponentClass(mod: any): any | null {
  for (const key of Object.keys(mod)) {
    const exported = mod[key];
    if (typeof exported === "function" && exported.prototype instanceof QObject) {
      return exported;
    }
  }
  return null;
}

function captureState(controller: any): Map<string, unknown> {
  const state = new Map<string, unknown>();
  if (!controller) return state;
  for (const key of Object.keys(controller)) {
    const value = (controller as any)[key];
    if (value instanceof QProperty) {
      state.set(key, value.value);
    }
  }
  return state;
}

// Capture viewChild state before HMR so we can restore it after reload.
// Reads the current value of each viewChild-backed QML node.
function captureViewChildState(controller: any): Map<string, any> {
  const state = new Map<string, any>();
  if (!controller) return state;
  const keys = getViewChildKeys(controller);
  for (const key of keys) {
    const ref = (controller as any)[key];
    if (ref && ref.__viewChild) {
      const stateProps = getViewChildStateProps(ref);
      if (stateProps.length === 0) continue;

      try {
        const snapshot: Record<string, unknown> = {};
        for (const prop of stateProps) {
          const value = (ref as any)[prop];
          if (value !== undefined) {
            snapshot[prop] = value;
          }
        }

        if (Object.keys(snapshot).length > 0) {
          state.set(key, snapshot);
        }
      } catch { /* node already destroyed by HMR */ }
    }
  }
  return state;
}

// Restore viewChild state after HMR reload.
// Polls until findChild succeeds (Loader may still be creating nodes).
async function restoreViewChildState(
  controller: any,
  state: Map<string, any>
): Promise<void> {
  if (state.size === 0) return;

  const MAX_ATTEMPTS = 30;
  const POLL_MS = 64;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let unresolved = 0;
    for (const [key, saved] of state) {
      const ref = (controller as any)[key];
      if (!ref || !ref.__viewChild) { unresolved++; continue; }

      try {
        const stateProps = getViewChildStateProps(ref);
        if (stateProps.length === 0) {
          unresolved++;
          continue;
        }

        let applied = false;
        for (const prop of stateProps) {
          if ((saved as Record<string, unknown>)[prop] === undefined) continue;
          if ((ref as any)[prop] === undefined) continue;
          (ref as any)[prop] = (saved as Record<string, unknown>)[prop];
          applied = true;
        }
        if (!applied) { unresolved++; }
      } catch { unresolved++; }
    }

    if (unresolved === 0) {
      logger.debug(`[HMR] viewChild state restored (attempt ${attempt + 1})`);
      return;
    }

    await new Promise(r => setTimeout(r, POLL_MS));
  }

  logger.warn(`[HMR] viewChild state restore timed out after ${MAX_ATTEMPTS} attempts`);
}

function getViewChildKeys(controller: any): string[] {
  const keys: string[] = [];
  let proto = Object.getPrototypeOf(controller);
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (desc && (desc.value as any)?.__viewChild) {
        keys.push(key);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  for (const key of Object.getOwnPropertyNames(controller)) {
    const val = (controller as any)[key];
    if (val && val.__viewChild) keys.push(key);
  }
  return [...new Set(keys)];
}

async function startDebugServer(ctx: AppContext): Promise<void> {
  const dt = ctx.options?.devtools ?? (process.env.MOCHA_DEVTOOLS ? { autoStart: true } : undefined);
  if (dt) {
    const dtPort = dt.port ?? parseInt(process.env.MOCHA_DEVTOOLS_PORT ?? "9229", 10);
    const dtHost = dt.host ?? process.env.MOCHA_DEVTOOLS_HOST ?? "localhost";
    _debugServer = new DebugServer({ port: dtPort, host: dtHost });
    if (dt.autoStart ?? true) {
      await _debugServer.start();
      _debugServer.attach(ctx.controller);
      _debugServer.startConsoleCapture();
      if (ctx.meta?.document?.root) {
        _debugServer.setQmlTree([ctx.meta.document.root]);
      }
      logger.info(`Debug server available at http://localhost:${_debugServer.port}`);
    }
  }
}

function drainPendingCalls(nativeApp: any, entries: ProxyEntry[]): boolean {
  for (const entry of entries) {
    const calls: string[] = nativeApp.proxyDrainPendingCalls(entry.proxyId);
    if (calls && calls.length > 0) {
      logger.info(`[drain] ${entry.componentName}: ${calls.length} calls`);
      for (const call of calls) {
        const validation = validateBridgeCall(call);
        if (!validation.ok) {
          logger.warn(`[bridge] Invalid bridge call from ${entry.componentName}: ${validation.error}`);
          continue;
        }

        const bc = validation.call;

        if (_debugServer) {
          const breakpointName = bc.type === "method" ? bc.method : bc.type === "bind" ? bc.property : bc.hook;
          if (_debugServer.interruptIfBreakpoint(breakpointName)) {
            logger.info(`[debug] Paused at breakpoint: ${breakpointName}`);
            return true;
          }
        }

        if (bc.type === "bind") {
          const propName = bc.property;
          const qp = (entry.instance as any)[propName];
          if (qp instanceof QProperty) {
            qp.value = bc.value ?? "";
            logger.debug(`[autoBind] ${propName} = ${JSON.stringify(qp.value)}`);
          } else {
            logger.warn(`[autoBind] _bind_ target "${propName}" is not a QProperty on ${entry.componentName}`);
          }
          continue;
        }

        if (bc.type === "route") {
          const fn = (entry.instance as any)[bc.hook];
          if (typeof fn === "function") {
            fn.call(entry.instance, bc.path);
          }
          continue;
        }

        logger.info(`  → ${bc.method}(${bc.args.map(a => JSON.stringify(a)).join(", ")})`);

        const fn = (entry.instance as any)[bc.method];
        if (typeof fn === "function") {
          fn.call(entry.instance, ...bc.args);
        }
      }
    }
  }
  return false;
}

function runEventLoop(ctx: AppContext, nativeApp: any, entries: ProxyEntry[]): Promise<void> {
  return new Promise((resolve) => {
    let running = true;

    const tick = async () => {
      if (!running || ctx.stopRequested) { resolve(); return; }
      try { nativeApp.processEvents(); } catch { running = false; resolve(); return; }
      const breakpointHit = drainPendingCalls(nativeApp, entries);
      if (breakpointHit || (_debugServer && _debugServer.isPaused)) {
        await _debugServer!.waitWhilePaused();
      }
      if (running && !ctx.stopRequested) setTimeout(tick, 8);
    };

    process.once("SIGINT", () => { running = false; });
    process.once("SIGTERM", () => { running = false; });
    tick();
  });
}

function scanRootServices(): Array<{ instance: QObject; componentName: string }> {
  const results: Array<{ instance: QObject; componentName: string }> = [];
  const all = getAllQMLComponents();
  for (const [cls, meta] of all.entries()) {
    if (meta.providedIn === "root") {
      const name = meta.componentName;
      let instance: QObject;
      if (globalContainer.has(cls as any)) instance = globalContainer.resolve(cls as any);
      else instance = new (cls as any)();
      results.push({ instance, componentName: name });
    }
  }
  return results;
}

export function scanProperties(instance: QObject): Array<{ name: string; qp: QProperty | QComputedProperty<any> }> {
  const props: Array<{ name: string; qp: QProperty | QComputedProperty<any> }> = [];
  const visited = new Set<string>();

  let proto = Object.getPrototypeOf(instance);
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key.startsWith("__qproperty_")) {
        const propName = key.replace("__qproperty_", "");
        if (visited.has(propName)) continue;
        visited.add(propName);
        const val = (instance as any)[propName];
        if (val instanceof QProperty) props.push({ name: propName, qp: val });
      }
      if (key.startsWith("__qcomputed_")) {
        const propName = key.replace("__qcomputed_", "");
        if (visited.has(propName)) continue;
        visited.add(propName);
        const val = (instance as any)[propName];
        if (val instanceof QComputedProperty) props.push({ name: propName, qp: val });
      }
    }
    proto = Object.getPrototypeOf(proto);
  }

  for (const key of Object.getOwnPropertyNames(instance)) {
    if (visited.has(key)) continue;
    if (key.startsWith("_")) continue;
    const val = (instance as any)[key];
    if (val instanceof QProperty || val instanceof QComputedProperty) {
      visited.add(key);
      props.push({ name: key, qp: val });
    }
  }

  return props;
}

function extractWindowProps(qml: string, nativeApp: any): void {
  const titleMatch = qml.match(/title:\s*["']([^"']+)["']/);
  const widthMatch = qml.match(/width:\s*(\d+)/);
  const heightMatch = qml.match(/height:\s*(\d+)/);
  nativeApp.setShellWindowProps({
    title: titleMatch?.[1],
    width: widthMatch ? parseInt(widthMatch[1]) : undefined,
    height: heightMatch ? parseInt(heightMatch[1]) : undefined,
  });
}

function resolveViewChildren(controller: QObject): void {
  const proto = Object.getPrototypeOf(controller);
  const keys = Object.getOwnPropertyNames(controller).concat(
    ...getAllProtoKeys(controller)
  );
  for (const key of keys) {
    const val = (controller as any)[key];
    if (val && val.__viewChild) {
      (controller as any)[key] = createLazyViewChild(val as ViewChildRef<any>);
    }
  }
}

function getAllProtoKeys(obj: any): string[] {
  const result: string[] = [];
  let proto = Object.getPrototypeOf(obj);
  while (proto && proto !== Object.prototype) {
    result.push(...Object.getOwnPropertyNames(proto));
    proto = Object.getPrototypeOf(proto);
  }
  return result;
}

function applyDarkTitleBar(nativeApp: any): void {
  try {
    const dark = nativeApp.getProperty("darkTitleBar");
    if (dark === "true" || dark === true) {
      nativeApp.setDarkTitleBar(true);
      logger.info("[darkTitleBar] Applied dark native title bar");
    }
  } catch {
    // ApplicationWindow may not be the root object — skip silently
  }
}

function injectBrandTheme(nativeApp: any, theme?: ThemeLike): void {
  const proxyId = nativeApp.createProxy();
  _brandThemeProxyId = proxyId;
  _brandThemeNativeApp = nativeApp;
  if (theme) {
    const overrides = theme.toQMLOverrides();
    for (const [key, value] of Object.entries(overrides)) {
      nativeApp.proxySetValue(proxyId, key, value);
    }
    logger.info(`[theme] Injected ${Object.keys(overrides).length} brand theme overrides`);
  } else {
    logger.info(`[theme] No theme provided, injected empty _brandTheme proxy (Catppuccin defaults)`);
  }
  nativeApp.setContextProperty("_brandTheme", proxyId);
}

function createMockNativeApp() {
  return {
    loadQML: () => {}, reloadQML: () => 0, setProperty: () => {}, getProperty: () => "",
    createProxy: () => 0, proxySetValue: () => {}, proxyGetValue: () => "",
    proxyDrainPendingCalls: () => [], setContextProperty: () => {},
    processEvents: () => {}, exec: () => 0, quit: () => {},
    registerAppObjects: () => {},
    listRootObjects: () => [] as any[],
    listChildren: () => [] as any[],
    getQmlProperty: () => "",
    getQmlProperties: () => [] as any[],
    setQmlProperty: () => {},
    findChild: () => 0,
    getRootObject: () => 0,
    setDarkTitleBar: () => {},
    startSystemMove: () => {},
    loadShell: () => {},
    setShellSource: () => {},
    setShellWindowProps: () => {},
  };
}
