import type { QMetaProperty } from "./types.js";

export function qproperty(
  target: any,
  propertyKey: string
): void {
  if (typeof target !== "object" || target === null) return;

  Object.defineProperty(target, `__qproperty_${propertyKey}`, {
    value: {
      name: propertyKey,
      type: "unknown",
      isConstant: false,
      isReadable: true,
      isWritable: true,
      notifySignal: `${propertyKey}Changed`,
    } satisfies Partial<QMetaProperty>,
    enumerable: false,
    configurable: true,
  });
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
