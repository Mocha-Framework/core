export interface InjectableOptions {
  providedIn?: "root" | "view";
}

interface Entry<T> {
  factory: () => T;
  singleton: boolean;
  instance?: T;
}

let INJECTOR_TOKEN = Symbol("injector");

export class Injector {
  private _parent: Injector | null;
  private _registry = new Map<Function, Entry<any>>();
  private _providers = new Map<Function, () => any>();
  private _singletons = new Map<Function, any>();

  constructor(parent: Injector | null = null) {
    this._parent = parent;
  }

  get parent(): Injector | null {
    return this._parent;
  }

  register<T>(token: { new (...args: any[]): T }, factory?: () => T, singleton?: boolean): void {
    const key = token;
    if (this._registry.has(key)) return;
    this._registry.set(key, {
      factory: factory ?? (() => new token()),
      singleton: singleton ?? true,
    });
  }

  provide<T>(token: { new (...args: any[]): T }, factory: () => T): void {
    this._providers.set(token, factory);
  }

  resolve<T>(token: { new (...args: any[]): T }, injector?: Injector): T {
    const injectors: Injector[] = [];
    let current: Injector | null = injector ?? this;
    while (current) {
      injectors.push(current);
      current = current._parent;
    }

    for (const inj of injectors) {
      const factory = inj._providers.get(token);
      if (factory) return factory();
    }

    for (const inj of injectors) {
      const entry = inj._registry.get(token);
      if (!entry) continue;
      if (entry.singleton) {
        if (!entry.instance) {
          entry.instance = entry.factory();
        }
        return entry.instance;
      }
      return entry.factory();
    }

    if (this._parent) {
      return this._parent.resolve(token, this._parent);
    }

    throw new Error(
      `No provider for "${token.name}". ` +
      `Add @Injectable({ providedIn: "root" }) or register manually.`
    );
  }

  has(token: { new (...args: any[]): any }): boolean {
    if (this._registry.has(token)) return true;
    if (this._parent) return this._parent.has(token);
    return false;
  }

  createChild(): Injector {
    return new Injector(this);
  }

  clear(): void {
    this._registry.clear();
    this._providers.clear();
    this._singletons.clear();
  }
}

export const rootInjector = new Injector();
(rootInjector as any).__isRoot = true;

// Backward compat: globalContainer === rootInjector
export const globalContainer = rootInjector as any as { has: (token: any) => boolean; resolve: (token: any) => any };

export interface InjectableDecorator {
  (options?: InjectableOptions): ClassDecorator;
}

export function Injectable(options?: InjectableOptions): ClassDecorator {
  return (target) => {
    const ctor = target as unknown as { new (...args: any[]): any };
    const scope = options?.providedIn ?? "root";
    if (scope === "root") {
      rootInjector.register(ctor);
    }
    (ctor as any).__providedIn = scope;
  };
}

let _currentInjector: Injector = rootInjector;

export function setCurrentInjector(injector: Injector): void {
  _currentInjector = injector;
}

export function getCurrentInjector(): Injector {
  return _currentInjector;
}

export function inject<T>(token: { new (...args: any[]): T }, injector?: Injector): T {
  return (injector ?? _currentInjector).resolve(token);
}
