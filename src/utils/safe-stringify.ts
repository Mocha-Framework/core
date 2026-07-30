const VIEW_CHILD_SENTINEL = "__viewChild";

const knownRecursive = new WeakSet<object>();

function isViewChildProxy(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  return VIEW_CHILD_SENTINEL in value;
}

export function safeStringify(value: unknown, space?: number): string {
  knownRecursive.delete(
    knownRecursive as unknown as WeakSet<WeakKey>
  );

  return JSON.stringify(
    value,
    function (this: any, key: string, val: unknown) {
      if (val === undefined) {
        return null;
      }

      if (typeof val === "function") {
        return "[Function]";
      }

      if (val !== null && typeof val === "object") {
        if (isViewChildProxy(val)) {
          return "[ViewChild]";
        }
        if (knownRecursive.has(val)) {
          return "[Circular]";
        }
        knownRecursive.add(val);
      }

      return val;
    },
    space ?? undefined
  );
}
