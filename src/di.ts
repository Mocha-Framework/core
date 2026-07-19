type Factory<T> = () => T;

interface Entry<T> {
  factory: Factory<T>;
  singleton: boolean;
  instance?: T;
}

export class Container {
  private _registry = new Map<string, Entry<any>>();

  register<T>(token: string, factory: Factory<T>, singleton?: boolean): void;
  register<T>(token: { new (...args: any[]): T }): void;
  register(token: any, factory?: any, singleton = true): void {
    if (typeof token === "function" && !factory) {
      const name = token.name;
      this._registry.set(name, {
        factory: () => new token(),
        singleton,
      });
      return;
    }
    this._registry.set(token, {
      factory,
      singleton,
    });
  }

  resolve<T>(token: { new (...args: any[]): T }): T;
  resolve<T>(token: string): T;
  resolve(token: any): any {
    const key = typeof token === "function" ? token.name : token;
    const entry = this._registry.get(key);
    if (!entry) throw new Error(`No provider registered for "${key}"`);

    if (entry.singleton) {
      if (!entry.instance) {
        entry.instance = entry.factory();
      }
      return entry.instance as any;
    }
    return entry.factory() as any;
  }

  has(token: string | { new (...args: any[]): any }): boolean {
    const key = typeof token === "function" ? token.name : token;
    return this._registry.has(key);
  }

  clear(): void {
    this._registry.clear();
  }
}

export const globalContainer = new Container();

export function Injectable(): ClassDecorator {
  return (target) => {
    globalContainer.register(target as any);
  };
}

export function inject<T>(serviceClass: new (...args: any[]) => T): T {
  return globalContainer.resolve(serviceClass);
}
