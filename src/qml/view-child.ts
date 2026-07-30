import { getQMLNodeStateProps, type QMLNode, type QMLNodeClass } from "./widget-wrappers.js";

let _nativeAppRef: any = null;

export function setNativeAppRef(app: any): void {
  _nativeAppRef = app;
}

export interface ViewChildRef<T extends QMLNode> {
  __viewChild: true;
  selector: string;
  wrapperClass: QMLNodeClass<T>;
}

export function viewChild<T extends QMLNode>(
  selector: string,
  wrapperClass: QMLNodeClass<T>
): T {
  const ref: ViewChildRef<T> = {
    __viewChild: true,
    selector,
    wrapperClass,
  };
  return ref as unknown as T;
}

export function getViewChildStateProps(value: unknown): readonly string[] {
  if (!value || typeof value !== "object") return [];

  const maybeRef = value as Partial<ViewChildRef<QMLNode>> & {
    __viewChildWrapperClass?: QMLNodeClass;
  };

  if (!maybeRef.__viewChild) return [];

  return getQMLNodeStateProps(
    maybeRef.wrapperClass ?? maybeRef.__viewChildWrapperClass ?? null
  );
}

// ── Resolved ViewChild with cache ──────────────────────────
// Resolves findChild ONCE, caches the wrapper, and exposes
// invalidate() for HMR to force re-resolution after QML reload.

class CachedViewChild<T extends QMLNode> {
  private _wrapper: T | null = null;
  private _resolved = false;
  private _pending: Array<{ prop: string | symbol; value: any }> = [];
  private _proxy: T | null = null;

  constructor(private _ref: ViewChildRef<T>) {}

  // Resolve (or return cached). Returns null if findChild fails.
  resolve(): T | null {
    if (this._resolved && this._wrapper) return this._wrapper;

    if (!_nativeAppRef) return null;

    try {
      const handle = _nativeAppRef.findChild(this._ref.selector);
      if (!handle) return null;

      const wrapper = new this._ref.wrapperClass();
      wrapper._attach(_nativeAppRef, handle);
      this._wrapper = wrapper;
      this._resolved = true;

      if (this._pending.length > 0) {
        for (const { prop, value } of this._pending) {
          (wrapper as any)[prop] = value;
        }
        this._pending = [];
      }

      return wrapper;
    } catch {
      return null;
    }
  }

  // Called by HMR to force re-resolution on next access.
  // Called AFTER setShellSource so the new QML nodes exist.
  invalidate(): void {
    this._wrapper = null;
    this._resolved = false;
  }

  // Check if this viewChild has been resolved successfully at least once.
  get isResolved(): boolean {
    return this._resolved;
  }

  // The Proxy that consumers interact with.
  // All property accesses delegate to the cached wrapper.
  // If wrapper is not yet resolved, get returns undefined
  // and set accumulates in _pending until resolution.
  proxy(): T {
    if (this._proxy) return this._proxy;

    const self = this;
    this._proxy = new Proxy({} as T, {
      get(_target, prop) {
        if (prop === "__viewChild") return true;
        if (prop === "then") return undefined;
        if (prop === "__vcCache") return self; // expose for HMR invalidate
        if (prop === "__viewChildWrapperClass") return self._ref.wrapperClass;

        const w = self.resolve();
        if (!w) return undefined;
        return (w as any)[prop];
      },

      set(_target, prop, value) {
        const w = self.resolve();
        if (!w) {
          self._pending.push({ prop, value });
          return true;
        }
        (w as any)[prop] = value;
        return true;
      },
    }) as T;

    return this._proxy;
  }
}

// Global registry: selector → CachedViewChild
// Shared across controller instances so HMR can invalidate all of them.
const _viewChildCache = new Map<string, CachedViewChild<any>>();

export function resolveViewChild<T extends QMLNode>(
  ref: ViewChildRef<T>
): T | null {
  let entry = _viewChildCache.get(ref.selector);
  if (!entry) {
    entry = new CachedViewChild(ref);
    _viewChildCache.set(ref.selector, entry);
  }
  return entry.resolve();
}

export function createLazyViewChild<T extends QMLNode>(
  ref: ViewChildRef<T>
): T {
  let entry = _viewChildCache.get(ref.selector);
  if (!entry) {
    entry = new CachedViewChild(ref);
    _viewChildCache.set(ref.selector, entry);
  }
  return entry.proxy();
}

// Called by HMR after setShellSource to force re-resolution of ALL
// viewChild proxies. This ensures that after QML reload, every
// viewChild proxy finds the new nodes on the next access.
export function invalidateAllViewChildren(): void {
  for (const [_key, entry] of _viewChildCache) {
    entry.invalidate();
  }
}

// For debugging
export function getViewChildCacheStats(): {
  total: number;
  resolved: number;
  pending: number;
} {
  const entries = [..._viewChildCache.values()];
  return {
    total: entries.length,
    resolved: entries.filter(e => e.isResolved).length,
    pending: entries.length - entries.filter(e => e.isResolved).length,
  };
}
