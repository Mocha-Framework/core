import { QObject, QProperty, getMetaObjectHierarchy } from "../index.js";
import { Logger } from "@mocha/shared";

const logger = new Logger("PropertyInspector");

export interface PropertySnapshot {
  timestamp: number;
  objectId: number;
  objectName: string;
  properties: Record<string, PropertySnapshotEntry>;
}

export interface PropertySnapshotEntry {
  value: unknown;
  type: string;
  isReadable: boolean;
  isWritable: boolean;
  isReactive: boolean;
}

export class PropertyInspector {
  private _snapshots: PropertySnapshot[] = [];
  private _watchedObjects = new Map<number, QObject>();
  private _maxSnapshots = 100;

  watch(obj: QObject): void {
    this._watchedObjects.set(obj.objectId, obj);
    logger.debug(`Watching ${obj.objectName} (${obj.constructor.name})`);
  }

  unwatch(obj: QObject): void {
    this._watchedObjects.delete(obj.objectId);
  }

  getProperties(obj: QObject): Record<string, PropertySnapshotEntry> {
    const props: Record<string, PropertySnapshotEntry> = {};
    const ctor = obj.constructor as Function;
    const hierarchy = getMetaObjectHierarchy(ctor);

    const knownPropKeys = new Set<string>();
    for (const m of hierarchy) {
      for (const p of m.properties) knownPropKeys.add(p.name);
    }

    if (knownPropKeys.size === 0) {
      for (const key of Object.getOwnPropertyNames(obj)) {
        if (key.startsWith("_")) continue;
        const val = (obj as any)[key];
        if (typeof val === "function") continue;
        knownPropKeys.add(key);
      }
    }

    for (const propKey of knownPropKeys) {
      const value = (obj as any)[propKey];
      const declared = hierarchy.find((m) =>
        m.properties.some((p) => p.name === propKey)
      );
      const propDecl = declared?.properties.find((p) => p.name === propKey);

      if (value instanceof QProperty) {
        props[propKey] = {
          type: propDecl?.type ?? typeof value.value,
          value: value.value,
          isReadable: true,
          isWritable: true,
          isReactive: true,
        };
      } else if (typeof value !== "function" && !propKey.startsWith("_")) {
        props[propKey] = {
          type: typeof value,
          value,
          isReadable: true,
          isWritable: true,
          isReactive: false,
        };
      }
    }

    return props;
  }

  getProperty(obj: QObject, name: string): unknown {
    const value = (obj as any)[name];
    if (value instanceof QProperty) {
      return value.value;
    }
    return value;
  }

  setProperty(obj: QObject, name: string, value: unknown): boolean {
    const prop = (obj as any)[name];
    if (prop instanceof QProperty) {
      prop.value = value;
      return true;
    }
    (obj as any)[name] = value;
    return true;
  }

  snapshot(obj: QObject): PropertySnapshot {
    const snapshot: PropertySnapshot = {
      timestamp: Date.now(),
      objectId: obj.objectId,
      objectName: obj.objectName,
      properties: this.getProperties(obj),
    };

    this._snapshots.push(snapshot);

    if (this._snapshots.length > this._maxSnapshots) {
      this._snapshots.shift();
    }

    logger.debug(`Snapshot taken for ${obj.objectName}`);
    return snapshot;
  }

  getSnapshots(): PropertySnapshot[] {
    return [...this._snapshots];
  }

  diff(
    snapshotA: PropertySnapshot,
    snapshotB: PropertySnapshot
  ): Record<string, { from: unknown; to: unknown }> {
    const diffs: Record<string, { from: unknown; to: unknown }> = {};

    for (const key of Object.keys(snapshotA.properties)) {
      const a = snapshotA.properties[key]?.value;
      const b = snapshotB.properties[key]?.value;

      if (JSON.stringify(a) !== JSON.stringify(b)) {
        diffs[key] = { from: a, to: b };
      }
    }

    return diffs;
  }

  clearSnapshots(): void {
    this._snapshots = [];
  }

  getAllProperties(): Record<string, Record<string, PropertySnapshotEntry>> {
    const all: Record<string, Record<string, PropertySnapshotEntry>> = {};
    for (const obj of this._watchedObjects.values()) {
      all[obj.objectName] = this.getProperties(obj);
    }
    return all;
  }
}
