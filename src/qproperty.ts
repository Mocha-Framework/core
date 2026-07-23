import { Signal } from "./signals.js";
import type { QMetaProperty } from "./types.js";
import { Disposable } from "@mocha/shared";
import { activeEffectRef } from "./reactivity.js";

let globalPropertyIdCounter = 0;

export type PropertyChangeCallback<T> = (
  value: T,
  previous: T
) => void;

export class QProperty<T = unknown> extends Disposable {
  private _value: T;
  private _internal =
    "qproperty" as unknown as T;
  private _previous: T | undefined = undefined;

  readonly changed = new Signal<(value: T, previous: T) => void>();
  readonly beforeChange = new Signal<(value: T, previous: T) => void>();

  readonly meta: QMetaProperty;
  readonly id: number;

  private _bindings: Set<QProperty<any>> = new Set();
  private _bindingCallback: PropertyChangeCallback<T> | null = null;

  constructor(initialValue: T, meta?: Partial<QMetaProperty>) {
    super();
    this._value = initialValue;
    this.id = ++globalPropertyIdCounter;
    this.meta = {
      name: meta?.name ?? `qproperty_${this.id}`,
      type: meta?.type ?? typeof initialValue,
      value: initialValue,
      isConstant: meta?.isConstant ?? false,
      isReadable: true,
      isWritable: true,
      notifySignal: meta?.notifySignal ?? `${meta?.name ?? `qproperty_${this.id}`}Changed`,
    };
  }

  // ── Shortcut (existing, unchanged) ───────────────────────

  get value(): T {
    const active = activeEffectRef();
    if (active) active.addDep(this);
    return this._value;
  }

  set value(v: T) {
    if (this.meta.isConstant) return;
    const previous = this._value;
    if (this._shouldSkipUpdate(previous, v)) return;

    this._previous = previous;
    this.beforeChange.emit(v, previous);
    this._value = v;
    this.changed.emit(v, previous);
    this._propagateToBindings(v);
  }

  // ── Canonical (existing) ─────────────────────────────────

  get(): T {
    return this._value;
  }

  set(v: T): void {
    this.value = v;
  }

  // ── Functional helpers (NEW) ─────────────────────────────

  /** Atomic read + write in one call. Preferred for code-gen. */
  update(fn: (current: T) => T): void {
    this.value = fn(this._value);
  }

  /** Value before the last set. */
  previous(): T | undefined {
    return this._previous;
  }

  /** Equality check without `.value`. */
  equals(v: T): boolean {
    return this._value === v;
  }

  /** Subscribe returning an unsubscribe function. */
  onValue(fn: (value: T, previous?: T) => void): () => void {
    const conn = this.changed.connect(fn as any);
    return () => conn.disconnect();
  }

  /** One-shot subscribe. Fires once then auto-disconnects. */
  once(fn: (value: T, previous?: T) => void): () => void {
    const listener = (value: T, previous: T) => {
      conn.disconnect();
      fn(value, previous);
    };
    const conn = this.changed.connect(listener as any);
    return () => conn.disconnect();
  }

  /** Debug-friendly string. */
  toString(): string {
    return `QProperty(${JSON.stringify(this._value)})`;
  }

  // ── Internal: silent set (no signals) ────────────────────

  _setSilent(v: T): void {
    this._previous = this._value;
    this._value = v;
    this._propagateToBindings(v);
  }

  // ── Bindings (existing) ──────────────────────────────────

  bindTo(
    source: QProperty<T>,
    transform?: (v: T) => T
  ): () => void {
    const callback: PropertyChangeCallback<T> = (value) => {
      const targetValue = transform ? transform(value) : value;
      this.value = targetValue;
    };

    source._bindings.add(this);
    this._bindingCallback = callback;
    source.changed.connect(callback);

    const initialValue = transform ? transform(source.value) : source.value;
    this.value = initialValue;

    const disconnect = () => {
      source.changed.disconnect(callback);
      source._bindings.delete(this);
      this._bindingCallback = null;
    };

    return disconnect;
  }

  bindTwoWay(other: QProperty<T>): () => void {
    const unsub1 = this.bindTo(other);
    const unsub2 = other.bindTo(this);
    return () => {
      unsub1();
      unsub2();
    };
  }

  toggle(): void {
    if (typeof this._value === "boolean") {
      this.value = (!this._value) as T;
    }
  }

  reset(): void {
    this.value = undefined as unknown as T;
  }

  dispose(): void {
    this.changed.disconnect();
    this.beforeChange.disconnect();
    this._bindings.clear();
    this._bindingCallback = null;
    super.dispose();
  }

  private _shouldSkipUpdate(prev: T, next: T): boolean {
    return prev === next;
  }

  private _propagateToBindings(value: T): void {
    for (const child of this._bindings) {
      if (child._bindingCallback) {
        child._bindingCallback(value, child._value);
      }
    }
  }
}
