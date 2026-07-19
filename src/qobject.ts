import { Disposable, Logger } from "@mocha/shared";
import { Signal, SignalConnection } from "./signals.js";
import { registerMetaObject } from "./qmetaobject.js";
import type { QMetaObjectData } from "./types.js";

const logger = new Logger("QObject");

export interface QObjectSignals {
  destroyed: () => void;
  objectNameChanged: (name: string) => void;
}

let globalObjectIdCounter = 0;

export class QObject extends Disposable {
  readonly destroyed = new Signal<() => void>();
  readonly objectNameChanged = new Signal<(name: string) => void>();

  private _objectName: string;
  private _parent: QObject | null = null;
  private _children: QObject[] = [];
  private _weakChildren: Set<WeakRef<QObject>> = new Set();
  readonly objectId: number;

  private static _classMetaCache = new Map<Function, QMetaObjectData>();

  constructor(parent: QObject | null = null) {
    super();
    this.objectId = ++globalObjectIdCounter;
    this._objectName = `${this.constructor.name}_${this.objectId}`;
    this._registerMetaObject();

    if (parent) {
      parent._addChild(this);
    }

    // Auto-call qmlInit after construction
    queueMicrotask(() => {
      if ("qmlInit" in this && typeof (this as any).qmlInit === "function") {
        (this as any).qmlInit();
      }
    });
  }

  get parent(): QObject | null {
    return this._parent;
  }

  set parent(p: QObject | null) {
    if (this._parent === p) return;
    this._parent?._removeChild(this);
    if (p) {
      p._addChild(this);
    } else {
      this._parent = null;
    }
  }

  get objectName(): string {
    return this._objectName;
  }

  set objectName(name: string) {
    if (this._objectName === name) return;
    this._objectName = name;
    this.objectNameChanged.emit(name);
  }

  get children(): readonly QObject[] {
    return this._children;
  }

  get childCount(): number {
    return this._children.length;
  }

  findChild<T extends QObject>(
    predicate: (child: QObject) => child is T
  ): T | null {
    return this._children.find(predicate) ?? null;
  }

  findChildren<T extends QObject>(
    predicate: (child: QObject) => child is T
  ): T[] {
    return this._children.filter(predicate);
  }

  childAt(index: number): QObject | null {
    return this._children[index] ?? null;
  }

  connect<T extends Signal<(...args: any[]) => void>>(
    signal: T,
    slot: T extends Signal<infer F> ? F : never
  ): SignalConnection {
    return signal.connect(slot as any);
  }

  blockSignals(block: boolean): void {
    (this as any).__signalsBlocked = block;
  }

  signalsBlocked(): boolean {
    return !!(this as any).__signalsBlocked;
  }

  deleteLater(): void {
    if (typeof setImmediate === "function") {
      setImmediate(() => this.dispose());
    } else {
      setTimeout(() => this.dispose(), 0);
    }
  }

  dumpObjectTree(indent: string = ""): string {
    let result = `${indent}${this._objectName} (${this.constructor.name})\n`;
    for (const child of this._children) {
      result += child.dumpObjectTree(indent + "  ");
    }
    return result;
  }

  dispose(): void {
    if ("qmlDestroy" in this && typeof (this as any).qmlDestroy === "function") {
      (this as any).qmlDestroy();
    }
    const children = [...this._children];
    for (const child of children) {
      child.dispose();
    }
    this._children = [];
    this._weakChildren.clear();
    this._parent?._removeChild(this);
    this._parent = null;
    this.destroyed.emit();
    this.destroyed.disconnect();
    this.objectNameChanged.disconnect();
    super.dispose();
  }

  private _addChild(child: QObject): void {
    if (child._parent === this) return;
    if (child._parent) {
      child._parent._removeChild(child);
    }
    child._parent = this;
    this._children.push(child);
    this._weakChildren.add(new WeakRef(child));
  }

  private _removeChild(child: QObject): void {
    const idx = this._children.indexOf(child);
    if (idx >= 0) {
      this._children.splice(idx, 1);
      child._parent = null;
    }
    for (const ref of this._weakChildren) {
      if (ref.deref() === child) {
        this._weakChildren.delete(ref);
        break;
      }
    }
  }

  private _registerMetaObject(): void {
    const ctor = this.constructor as Function & { _qmetaRegistered?: boolean };
    if (ctor._qmetaRegistered) return;
    ctor._qmetaRegistered = true;

    const className = this.constructor.name;
    const proto = Object.getPrototypeOf(this);
    const superCtor = proto?.constructor;
    const superClass = superCtor !== QObject && superCtor !== Object
      ? superCtor.name
      : null;

    const props = Object.getOwnPropertyDescriptors(this);
    const properties = Object.entries(props)
      .filter(([_, desc]) => desc.value instanceof Signal === false)
      .map(([name]) => ({
        name,
        type: typeof (this as any)[name],
        value: (this as any)[name],
        isConstant: false,
        isReadable: true,
        isWritable: true,
      }));

    const signals = Object.entries(props)
      .filter(([_, desc]) => desc.value instanceof Signal)
      .map(([name]) => name);

    const meta: QMetaObjectData = {
      className,
      superClass,
      properties,
      signals,
      slots: [],
    };

    registerMetaObject(ctor, meta);
  }
}
