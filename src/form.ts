import { QObject } from "./qobject.js";
import { QProperty } from "./qproperty.js";
import { QComputedProperty, computed } from "./qcomputed.js";

export type ValidatorFn<T = any> = (
  value: T,
  allValues?: Record<string, any>
) => string | null;

export type FieldInitializer<T = any> = readonly [
  initialValue: T,
  validators?: ValidatorFn<T>[]
];

export type FormSchema = Record<string, FieldInitializer>;

export class MochaForm<T extends FormSchema = any> extends QObject {
  private _fields = new Map<keyof T, QProperty<any>>();
  private _validators = new Map<keyof T, ValidatorFn<any>[]>();
  private _initial = new Map<keyof T, any>();
  private _errorProps = new Map<keyof T, QProperty<string | null>>();

  readonly errors = new QProperty<Partial<Record<keyof T, string | null>>>({});
  readonly submitting = new QProperty(false);

  readonly valid: QComputedProperty<boolean>;

  readonly _formName: string;

  constructor(schema: T, name = "form") {
    super();
    this._formName = name;

    for (const [key, [initial, validators]] of Object.entries(schema)) {
      const qp = new QProperty(initial);
      const err = new QProperty<string | null>(null);
      this._fields.set(key, qp);
      this._errorProps.set(key, err);
      this._initial.set(key, initial);
      if (validators) this._validators.set(key, validators);
      qp.changed.connect(() => this._revalidate(key));
    }

    this._revalidateAll();

    this.valid = computed(() => {
      const e = this.errors.value as Record<string, string | null>;
      for (const key of this._fields.keys()) {
        if (e[key as string]) return false;
      }
      return true;
    });
  }

  field<K extends keyof T & string>(name: K): QProperty<any> {
    return this._fields.get(name)!;
  }

  errorField<K extends keyof T & string>(name: K): QProperty<string | null> {
    return this._errorProps.get(name)!;
  }

  fieldNames(): (keyof T & string)[] {
    return [...this._fields.keys()] as (keyof T & string)[];
  }

  value(): Partial<Record<keyof T, any>> {
    const result: any = {};
    for (const [key, qp] of this._fields) {
      result[key] = qp.value;
    }
    return result;
  }

  setValue(updates: Partial<Record<keyof T, any>>): void {
    for (const key in updates) {
      const qp = this._fields.get(key as keyof T);
      if (qp) qp.set(updates[key as keyof T]);
    }
  }

  async submit(): Promise<{
    valid: boolean;
    value?: Record<string, any>;
  }> {
    this.submitting.set(true);
    try {
      this._revalidateAll();
      if (!this.valid.value) return { valid: false };
      return { valid: true, value: this.value() };
    } finally {
      this.submitting.set(false);
    }
  }

  reset(): void {
    for (const [key, initial] of this._initial) {
      this._fields.get(key)?.set(initial);
    }
    this._revalidateAll();
  }

  setErrors(
    fieldErrors: Partial<Record<keyof T & string, string | null>>
  ): void {
    const e: Record<string, string | null> = { ...this.errors.value as any };
    for (const key in fieldErrors) {
      e[key] = fieldErrors[key]!;
    }
    this.errors.set(e as any);
  }

  private _revalidate(key: keyof T): void {
    const validators = this._validators.get(key);
    if (!validators?.length) return;

    const value = this._fields.get(key)!.value;
    const allValues = this.value();

    for (const v of validators) {
      const err = v(value, allValues);
      if (err) {
        this._updateError(key, err);
        return;
      }
    }
    this._updateError(key, null);
  }

  private _revalidateAll(): void {
    for (const key of this._fields.keys()) {
      this._revalidate(key);
    }
  }

  private _updateError(key: keyof T, err: string | null): void {
    const e: Record<string, string | null> = { ...this.errors.value as any };
    if (err) e[key as string] = err;
    else delete e[key as string];
    this.errors.set(e as any);
    this._errorProps.get(key)?.set(err);
  }
}

// ── QObject.form() helper ──────────────────────────

declare module "./qobject.js" {
  interface QObject {
    form<T extends FormSchema>(
      schema: T,
      name?: string
    ): MochaForm<T>;
  }
}

QObject.prototype.form = function <T extends FormSchema>(
  schema: T,
  name = "form"
): MochaForm<T> {
  const mf = new MochaForm(schema, name);
  if (!(this as any).__mochaForms) (this as any).__mochaForms = [];
  (this as any).__mochaForms.push({ instance: mf, name });
  return mf;
};
