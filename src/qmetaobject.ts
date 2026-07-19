import type { QMetaObjectData } from "./types.js";

const metaObjectRegistry = new Map<Function, QMetaObjectData>();

export function registerMetaObject(
  target: Function,
  data: QMetaObjectData
): void {
  metaObjectRegistry.set(target, data);
}

export function getMetaObject(target: Function): QMetaObjectData | undefined {
  return metaObjectRegistry.get(target);
}

export function getMetaObjectHierarchy(
  target: Function
): QMetaObjectData[] {
  const result: QMetaObjectData[] = [];
  let current: Function | undefined = target;
  while (current) {
    const meta = metaObjectRegistry.get(current);
    if (meta) result.push(meta);
    current = (current as any).__superClass__;
  }
  return result;
}

export function findMetaProperty(
  target: Function,
  name: string
): QMetaObjectData | undefined {
  let current: Function | undefined = target;
  while (current) {
    const meta = metaObjectRegistry.get(current);
    if (meta?.properties.some((p) => p.name === name)) return meta;
    current = (current as any).__superClass__;
  }
  return undefined;
}
