import { createRequire } from "node:module";
import { QObject, QProperty } from "../index.js";
import { Logger } from "../utils/index.js";
import type { QMLComponentMetadata } from "./qml-component.js";
import { getQMLComponentMetadata, generateQMLSource } from "./qml-component.js";
import { BindingEngine } from "./binding.js";

const _hrRequire = createRequire(import.meta.url);

const logger = new Logger("HotReload");

/*
 * ═══════════════════════════════════════════════════════════
 * DEPRECATED — Use run-app.ts startWatchMode instead.
 *
 * The actual hot-reload system lives in:
 *   packages/qml/src/run-app.ts → startWatchMode() + bindControllerToQML()
 *
 * This class was an earlier attempt at stateful HMR with manual
 * capture/restore. It is no longer wired into the app lifecycle.
 * The `hotReload: true` option on @QMLComponent is a metadata flag
 * only — the runtime HMR does NOT use HotReloadManager.
 *
 * Kept for backward-compatible exports (public API).
 * ═══════════════════════════════════════════════════════════
 */

export interface HotReloadEntry {
  modulePath: string;
  component: QObject;
  metadata: QMLComponentMetadata;
  state: Map<string, unknown>;
  lastModified: number;
}

export class HotReloadManager {
  private _entries = new Map<string, HotReloadEntry>();
  private _bindingEngine = new BindingEngine();
  private _watchers = new Map<string, any>();
  private _enabled = false;

  enable(): void {
    this._enabled = true;
    logger.info("Hot reload enabled");
  }

  disable(): void {
    this._enabled = false;
    this._watchers.clear();
    logger.info("Hot reload disabled");
  }

  get isEnabled(): boolean {
    return this._enabled;
  }

  register(modulePath: string, component: QObject): void {
    const metadata = getQMLComponentMetadata(component.constructor);
    if (!metadata) {
      logger.warn(`No QML metadata found for ${component.constructor.name}`);
      return;
    }

    const state = new Map<string, unknown>();
    this._captureState(component, state);

    const entry: HotReloadEntry = {
      modulePath,
      component,
      metadata,
      state,
      lastModified: Date.now(),
    };

    this._entries.set(modulePath, entry);
    logger.debug(`Registered hot reload entry: ${modulePath}`);
  }

  unregister(modulePath: string): void {
    const entry = this._entries.get(modulePath);
    if (entry) {
      this._bindingEngine = new BindingEngine();
      this._entries.delete(modulePath);
    }
  }

  async reload(modulePath: string): Promise<boolean> {
    const entry = this._entries.get(modulePath);
    if (!entry) {
      logger.warn(`No hot reload entry for: ${modulePath}`);
      return false;
    }

    logger.info(`Hot reloading: ${modulePath}`);

    try {
      // Resolve to absolute path and clear CJS cache
      const resolvedPath = _hrRequire.resolve(modulePath);
      delete _hrRequire.cache[resolvedPath];

      const newModule = _hrRequire(modulePath);
      const componentClass = this._findComponentClass(newModule);

      if (!componentClass) {
        logger.warn("No component class found in module");
        return false;
      }

      const newComponent = new componentClass();
      this._restoreState(newComponent, entry.state);
      this._applyQMLChanges(newComponent, entry);

      entry.component = newComponent;
      entry.lastModified = Date.now();
      this._captureState(newComponent, entry.state);

      logger.info(`Hot reload successful: ${modulePath}`);
      return true;
    } catch (err) {
      logger.error(`Hot reload failed for ${modulePath}:`, err);
      return false;
    }
  }

  getEntry(modulePath: string): HotReloadEntry | undefined {
    return this._entries.get(modulePath);
  }

  getAllEntries(): Map<string, HotReloadEntry> {
    return new Map(this._entries);
  }

  private _captureState(component: QObject, state: Map<string, unknown>): void {
    state.clear();
    for (const key of Object.keys(component)) {
      const value = (component as any)[key];
      if (value instanceof QProperty) {
        state.set(key, value.value);
      }
    }
  }

  private _restoreState(component: QObject, state: Map<string, unknown>): void {
    for (const [key, value] of state) {
      const prop = (component as any)[key];
      if (prop instanceof QProperty) {
        prop.value = value;
      } else {
        (component as any)[key] = value;
      }
    }
  }

  private _applyQMLChanges(
    newComponent: QObject,
    oldEntry: HotReloadEntry
  ): void {
    const newMetadata = getQMLComponentMetadata(newComponent.constructor);
    if (newMetadata) {
      const newQML = generateQMLSource(newComponent, newMetadata);
      oldEntry.metadata = newMetadata;
      logger.debug(`QML updated for ${newComponent.constructor.name}`);
    }
  }

  private _findComponentClass(module: any): { new (...args: any[]): QObject } | null {
    for (const key of Object.keys(module)) {
      const exported = module[key];
      if (
        typeof exported === "function" &&
        exported.prototype instanceof QObject
      ) {
        return exported;
      }
    }
    return null;
  }

  dispose(): void {
    this._entries.clear();
    this._watchers.clear();
    this._bindingEngine.disposeAll();
    this._enabled = false;
  }
}

export const hotReload = new HotReloadManager();

export function hotreload<T extends { new (...args: any[]): QObject }>(
  target: T
): T {
  (target as any).__hotReload = true;
  return target;
}

export function isHotReloadable(target: Function): boolean {
  return !!(target as any).__hotReload;
}
