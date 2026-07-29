import { QProperty } from "./qproperty.js";
import { Signal, type SignalConnection } from "./signals.js";

/**
 * Interface for an InputRef — a reactive value that can be set from outside
 * (parent component). Equivalent to Angular 17+ `input()`.
 *
 * Created via the `input()` factory function. Backed by a `QProperty<T>` so
 * it integrates with the existing reactivity and bridge wiring.
 */
export interface InputRef<T> {
  readonly __input: true;
  /** Read the current value. Will subscribe to active `effect()`s. */
  readonly value: T;
  /** Set the current value. Triggers `changed` listeners. */
  set(next: T): void;
  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(fn: (value: T, previous: T) => void): () => void;
  /** Underlying QProperty — exposed for bridge wiring. */
  readonly property: QProperty<T>;
}

/**
 * Interface for an OutputRef — an explicit event channel a child component
 * uses to notify its parent. Equivalent to Angular 17+ `output()`.
 *
 * Created via the `output()` factory function. Backed by a `Signal<T>`.
 */
export interface OutputRef<T> {
  readonly __output: true;
  /** Emit a value to all subscribers. */
  emit(value: T): void;
  /** Subscribe to the output. Returns an unsubscribe function. */
  subscribe(fn: (value: T) => void): () => void;
  /** Underlying Signal — exposed for bridge wiring. */
  readonly signal: Signal<(value: T) => void>;
}

/**
 * Interface for a ModelRef — a two-way binding (input + output) between
 * parent and child. Equivalent to Angular 17+ `model()`.
 *
 * Reading/writing the value behaves like an InputRef. The `change` OutputRef
 * provides the inverse direction (child → parent).
 */
export interface ModelRef<T> {
  readonly __model: true;
  readonly value: T;
  set(next: T): void;
  subscribe(fn: (value: T, previous: T) => void): () => void;
  /** The "+Change" output that fires when the child writes a new value. */
  readonly change: OutputRef<T>;
  /** Underlying QProperty — exposed for bridge wiring. */
  readonly property: QProperty<T>;
}

/** Type guard for `InputRef<T>`. */
export function isInputRef(v: unknown): v is InputRef<unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __input?: unknown }).__input === true
  );
}

/** Type guard for `OutputRef<T>`. */
export function isOutputRef(v: unknown): v is OutputRef<unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __output?: unknown }).__output === true
  );
}

/** Type guard for `ModelRef<T>`. */
export function isModelRef(v: unknown): v is ModelRef<unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __model?: unknown }).__model === true
  );
}

/**
 * Create an input field. Receives a value from the parent component.
 * Backed by a `QProperty<T>` so it integrates with the existing reactivity.
 *
 * @example
 * ```ts
 * class ChildController extends QObject {
 *   name = input<string>("default");
 *   age = input(0);
 * }
 * ```
 */
export function input<T>(defaultValue?: T): InputRef<T> {
  const prop = new QProperty<T>(defaultValue as T);
  return {
    __input: true,
    property: prop,
    get value(): T {
      return prop.value;
    },
    set(next: T): void {
      prop.value = next;
    },
    subscribe(fn): () => void {
      const conn = prop.changed.connect(fn);
      return () => conn.disconnect();
    },
  };
}

/**
 * Create an output event. Emits values to the parent component.
 * Backed by a `Signal<T>`.
 *
 * @example
 * ```ts
 * class ChildController extends QObject {
 *   clicked = output<{ id: string }>();
 *
 *   handleClick(id: string) {
 *     this.clicked.emit({ id });
 *   }
 * }
 * ```
 */
export function output<T = void>(): OutputRef<T> {
  const sig = new Signal<(value: T) => void>();
  return {
    __output: true,
    signal: sig,
    emit(value: T): void {
      sig.emit(value);
    },
    subscribe(fn): () => void {
      const conn = sig.connect(fn);
      return () => conn.disconnect();
    },
  };
}

/**
 * Create a two-way model binding. Combines an input + an output named
 * `<name>Change` (Angular convention).
 *
 * @example
 * ```ts
 * class ChildController extends QObject {
 *   value = model<string>("");
 * }
 *
 * // Parent template:
 * // <Child [(value)]="controller.parentValue" />
 * ```
 */
export function model<T>(defaultValue?: T): ModelRef<T> {
  const prop = new QProperty<T>(defaultValue as T);
  const change = output<T>();
  // Wire: when the property changes, emit the change signal.
  const conn: SignalConnection = prop.changed.connect((value: T) => {
    change.emit(value);
  });
  return {
    __model: true,
    property: prop,
    change,
    get value(): T {
      return prop.value;
    },
    set(next: T): void {
      prop.value = next;
    },
    subscribe(fn): () => void {
      const c = prop.changed.connect(fn);
      return () => c.disconnect();
    },
  };
}
