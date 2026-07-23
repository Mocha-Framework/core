export type ValidatorFn<T = any> = (
  value: T,
  allValues?: Record<string, any>
) => string | null;

export const required: ValidatorFn = (v) =>
  v === null || v === undefined || v === "" ||
  (Array.isArray(v) && v.length === 0)
    ? "Required"
    : null;

export const requiredTrue: ValidatorFn<boolean> = (v) =>
  v === true ? null : "Must be true";

export const email: ValidatorFn<string> = (v) => {
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "Invalid email";
};

export const minLength =
  (min: number, msg?: string): ValidatorFn<string> =>
  (v) =>
    v && v.length < min ? (msg ?? `Min ${min} chars`) : null;

export const maxLength =
  (max: number, msg?: string): ValidatorFn<string> =>
  (v) =>
    v && v.length > max ? (msg ?? `Max ${max} chars`) : null;

export const min =
  (min: number, msg?: string): ValidatorFn<number> =>
  (v) =>
    v < min ? (msg ?? `Min ${min}`) : null;

export const max =
  (max: number, msg?: string): ValidatorFn<number> =>
  (v) =>
    v > max ? (msg ?? `Max ${max}`) : null;

export const pattern =
  (re: RegExp, msg?: string): ValidatorFn<string> =>
  (v) =>
    v && !re.test(v) ? (msg ?? "Invalid format") : null;

export const matchesField =
  (otherField: string, msg?: string): ValidatorFn =>
  (v, allValues) =>
    v === (allValues?.[otherField] ?? null) ? null : (msg ?? "Fields don't match");
