import { Signal } from "./signals.js";
import { effect, activeEffectRef } from "./reactivity.js";

export class QComputedProperty<T> {
  private _value!: T;
  private _eff: { destroy: () => void } | null = null;
  private _initialized = false;
  private _firstRun = true;

  readonly changed = new Signal<(value: T) => void>();

  constructor(private _compute: () => T) {}

  get value(): T {
    if (!this._initialized) {
      this._initialized = true;
      const prev = activeEffectRef();

      this._eff = effect(() => {
        const v = this._compute();
        if (this._firstRun) {
          this._value = v;
          this._firstRun = false;
        } else if (v !== this._value) {
          this._value = v;
          this.changed.emit(v);
        }
      });

      if (prev) {
        prev.addDep(this as any);
      }
    }
    const active = activeEffectRef();
    if (active) {
      (active as any).addDep(this);
    }
    return this._value;
  }

  toString(): string {
    return String(this.value);
  }

  dispose(): void {
    this._eff?.destroy();
    this.changed.disconnect();
  }
}

export function computed<T>(fn: () => T): QComputedProperty<T> {
  return new QComputedProperty(fn);
}
