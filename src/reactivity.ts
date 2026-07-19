import { QProperty } from "./qproperty.js";

let activeEffect: ReactiveEffect | null = null;

export class ReactiveEffect {
  private _deps = new Set<QProperty<any>>();
  private _cleanups: (() => void)[] = [];
  private _scheduled = false;

  constructor(private _fn: () => void) {}

  private _schedule(): void {
    if (!this._scheduled) {
      this._scheduled = true;
      queueMicrotask(() => {
        this._scheduled = false;
        this.run();
      });
    }
  }

  run(): void {
    this._cleanups.forEach((c) => c());
    this._cleanups = [];
    this._deps.clear();

    const prev = activeEffect;
    activeEffect = this;
    try {
      this._fn();
    } finally {
      activeEffect = prev;
    }
  }

  addDep(prop: QProperty<any>): void {
    if (!this._deps.has(prop)) {
      this._deps.add(prop);
      this._cleanups.push(
        prop.changed.connect(() => this._schedule()).disconnect
      );
    }
  }

  destroy(): void {
    this._cleanups.forEach((c) => c());
    this._cleanups = [];
    this._deps.clear();
  }
}

export function effect(fn: () => void): { destroy: () => void } {
  const eff = new ReactiveEffect(fn);
  eff.run();
  return { destroy: () => eff.destroy() };
}

export function activeEffectRef(): ReactiveEffect | null {
  return activeEffect;
}
