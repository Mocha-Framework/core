import {
  QObject,
  QProperty,
  Signal,
  getMetaObjectHierarchy,
  getMetaObject,
} from "../index.js";
import { Logger } from "@mocha/shared";

const logger = new Logger("Inspector");

export interface ComponentNode {
  id: number;
  name: string;
  className: string;
  superClass: string | null;
  children: ComponentNode[];
  properties: ComponentProperty[];
  signals: string[];
}

export interface ComponentProperty {
  name: string;
  type: string;
  value: unknown;
  isReadable: boolean;
  isWritable: boolean;
  isReactive: boolean;
}

export class ComponentInspector {
  private _roots: ComponentNode[] = [];
  private _onUpdate: ((tree: ComponentNode[]) => void) | null = null;
  private _objectCache = new Map<number, QObject>();

  setUpdateCallback(callback: (tree: ComponentNode[]) => void): void {
    this._onUpdate = callback;
  }

  inspect(root: QObject): ComponentNode {
    this._objectCache.clear();
    const node = this._buildTree(root);
    this._roots = [node];
    this._onUpdate?.(this._roots);
    return node;
  }

  inspectMultiple(roots: QObject[]): ComponentNode[] {
    this._objectCache.clear();
    this._roots = roots.map((r) => this._buildTree(r));
    this._onUpdate?.(this._roots);
    return this._roots;
  }

  getTree(): ComponentNode[] {
    return this._roots;
  }

  findNode(id: number): ComponentNode | null {
    return this._findInNodes(this._roots, id);
  }

  getObject(id: number): QObject | undefined {
    return this._objectCache.get(id);
  }

  refreshNode(id: number): ComponentNode | null {
    const obj = this._objectCache.get(id);
    if (!obj) return null;
    const node = this._buildTree(obj);
    this._replaceNodeInTree(this._roots, id, node);
    this._onUpdate?.(this._roots);
    return node;
  }

  private _buildTree(obj: QObject): ComponentNode {
    this._objectCache.set(obj.objectId, obj);

    const ctor = obj.constructor as Function;
    const meta = getMetaObject(ctor);
    const hierarchy = getMetaObjectHierarchy(ctor);

    const knownSignals = new Set<string>();
    const knownPropKeys = new Set<string>();

    for (const m of hierarchy) {
      for (const s of m.signals) knownSignals.add(s);
      for (const p of m.properties) knownPropKeys.add(p.name);
    }

    if (knownPropKeys.size === 0) {
      for (const key of Object.getOwnPropertyNames(obj)) {
        if (key.startsWith("_")) continue;
        const val = (obj as any)[key];
        if (typeof val === "function") continue;
        knownPropKeys.add(key);
        if (val instanceof Signal) knownSignals.add(key);
      }
    }

    const declaredSignals = [...knownSignals];

    const properties: ComponentProperty[] = [];

    for (const propKey of knownPropKeys) {
      const value = (obj as any)[propKey];
      const declared = hierarchy.find((m) =>
        m.properties.some((p) => p.name === propKey)
      );
      const propDecl = declared?.properties.find((p) => p.name === propKey);

      if (value instanceof QProperty) {
        properties.push({
          name: propKey,
          type: propDecl?.type ?? typeof value.value,
          value: value.value,
          isReadable: true,
          isWritable: true,
          isReactive: true,
        });
      } else if (value instanceof Signal) {
        properties.push({
          name: propKey,
          type: "Signal",
          value: `connections: ${value.connectionCount}`,
          isReadable: true,
          isWritable: false,
          isReactive: true,
        });
      } else if (typeof value !== "function" && !propKey.startsWith("_")) {
        properties.push({
          name: propKey,
          type: typeof value,
          value,
          isReadable: true,
          isWritable: true,
          isReactive: false,
        });
      }
    }

    const fullMeta = getMetaObject(ctor);

    return {
      id: obj.objectId,
      name: obj.objectName,
      className: fullMeta?.className ?? obj.constructor.name,
      superClass: fullMeta?.superClass ?? null,
      children: obj.children.map((child) => this._buildTree(child)),
      properties,
      signals: declaredSignals,
    };
  }

  private _findInNodes(
    nodes: ComponentNode[],
    id: number
  ): ComponentNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = this._findInNodes(node.children, id);
      if (found) return found;
    }
    return null;
  }

  private _replaceNodeInTree(
    nodes: ComponentNode[],
    id: number,
    replacement: ComponentNode
  ): boolean {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) {
        nodes[i] = replacement;
        return true;
      }
      if (this._replaceNodeInTree(nodes[i].children, id, replacement)) {
        return true;
      }
    }
    return false;
  }
}
