import type { QMetaProperty } from "./types.js";
import type { AppMetaConfig, PageMetaConfig } from "./meta.js";
import { registerAppMeta, registerPageMeta } from "./meta.js";

export function qproperty(
  valueOrTarget: any,
  contextOrPropertyKey: string | ClassFieldDecoratorContext
): void {
  const propertyKey =
    typeof contextOrPropertyKey === "string"
      ? contextOrPropertyKey
      : (contextOrPropertyKey.name as string);

  const metaValue = {
    name: propertyKey,
    type: "unknown",
    isConstant: false,
    isReadable: true,
    isWritable: true,
    notifySignal: `${propertyKey}Changed`,
  } satisfies Partial<QMetaProperty>;

  if (typeof contextOrPropertyKey === "string") {
    // Legacy decorator (experimentalDecorators: true)
    const target = valueOrTarget;
    if (typeof target !== "object" || target === null) return;
    Object.defineProperty(target, `__qproperty_${propertyKey}`, {
      value: metaValue,
      enumerable: false,
      configurable: true,
    });
  } else {
    // Standard ES Decorator (TypeScript 5.0+)
    const ctx = contextOrPropertyKey as ClassFieldDecoratorContext;
    ctx.addInitializer(function () {
      Object.defineProperty(this, `__qproperty_${propertyKey}`, {
        value: metaValue,
        enumerable: false,
        configurable: true,
      });
    });
  }
}

export function qapp(config: {
  mainThread?: string;
  workerThreads?: string[];
  sync?: "async-queue" | "direct" | "mutex";
}) {
  return function <T extends { new (...args: any[]): any }>(target: T): T {
    (target as any).__qappConfig = config;
    return target;
  };
}

export function hotreload<T extends { new (...args: any[]): any }>(
  target: T
): T {
  (target as any).__hotReload = true;
  return target;
}

export function qcomputed(
  valueOrTarget: any,
  contextOrPropertyKey: string | ClassFieldDecoratorContext
): void {
  const propertyKey =
    typeof contextOrPropertyKey === "string"
      ? contextOrPropertyKey
      : (contextOrPropertyKey.name as string);

  if (typeof contextOrPropertyKey === "string") {
    const target = valueOrTarget;
    if (typeof target !== "object" || target === null) return;
    Object.defineProperty(target, `__qcomputed_${propertyKey}`, {
      value: true,
      enumerable: false,
      configurable: true,
    });
  } else {
    const ctx = contextOrPropertyKey as ClassFieldDecoratorContext;
    ctx.addInitializer(function () {
      Object.defineProperty(this, `__qcomputed_${propertyKey}`, {
        value: true,
        enumerable: false,
        configurable: true,
      });
    });
  }
}

export function AppMeta(config: AppMetaConfig) {
  return function <T extends { new (...args: any[]): any }>(target: T): T {
    (target as any).__appMeta = config;
    registerAppMeta(target, config);
    return target;
  };
}

export function PageMeta(config: PageMetaConfig) {
  return function <T extends { new (...args: any[]): any }>(target: T): T {
    (target as any).__pageMeta = config;
    registerPageMeta(target, config);
    return target;
  };
}
