import { QProperty, Signal } from "../index.js";
import { Logger } from "../utils/index.js";
import type { QMLBindingMap } from "./qml-parser.js";

const logger = new Logger("BindingEngine");

export interface BindingExpression {
  source: string;
  property: string;
  transform?: (value: any) => any;
  reverseTransform?: (value: any) => any;
}

export class BindingEngine {
  private _bindings = new Map<string, BindingExpression[]>();
  private _subscriptions: Array<() => void> = [];

  bind(
    target: Record<string, QProperty<any>>,
    source: Record<string, QProperty<any>>,
    mapping: Record<string, string>
  ): () => void {
    const unsubs: Array<() => void> = [];

    for (const [targetProp, sourceExpr] of Object.entries(mapping)) {
      const sourceProp = this._resolveExpression(sourceExpr);
      if (!sourceProp || !(sourceProp in source)) {
        logger.warn(`Cannot resolve binding: ${sourceExpr}`);
        continue;
      }

      const targetQProp = target[targetProp];
      const sourceQProp = source[sourceProp];

      if (!targetQProp || !sourceQProp) {
        logger.warn(`Missing QProperty for binding: ${targetProp} <-> ${sourceProp}`);
        continue;
      }

      const unsub = targetQProp.bindTo(sourceQProp);
      unsubs.push(unsub);
      this._subscriptions.push(unsub);
    }

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }

  bindTwoWay(
    propA: QProperty<any>,
    propB: QProperty<any>
  ): () => void {
    const unsub = propA.bindTwoWay(propB);
    this._subscriptions.push(unsub);
    return unsub;
  }

  bindToExpression(
    prop: QProperty<any>,
    dependencies: QProperty<any>[],
    evaluate: (...values: any[]) => any
  ): () => void {
    const update = () => {
      const values = dependencies.map((d) => d.value);
      prop.value = evaluate(...values);
    };

    const unsubs = dependencies.map((dep) => dep.changed.connect(update));
    update();

    const dispose = () => unsubs.forEach((u) => u.disconnect());
    this._subscriptions.push(dispose);
    return dispose;
  }

  bindFromQMLBindings(
    component: Record<string, any>,
    bindings: QMLBindingMap
  ): void {
    for (const [key, binding] of Object.entries(bindings)) {
      const expr = binding.expression;
      const propPath = expr.replace(/^controller\./, "").replace(/\.(value|get)\(\)$/, "");

      if (propPath in component) {
        logger.debug(`Binding established: ${key} <-> controller.${propPath}`);
      } else {
        logger.warn(`Unknown binding target: ${propPath}`);
      }
    }
  }

  registerBinding(key: string, expression: BindingExpression): void {
    if (!this._bindings.has(key)) {
      this._bindings.set(key, []);
    }
    this._bindings.get(key)!.push(expression);
  }

  disposeAll(): void {
    for (const dispose of this._subscriptions) {
      try {
        dispose();
      } catch (err) {
        logger.error("Error disposing binding:", err);
      }
    }
    this._subscriptions = [];
    this._bindings.clear();
  }

  get dependencyCount(): number {
    return this._subscriptions.length;
  }

  private _resolveExpression(expr: string): string {
    if (expr.startsWith("source.")) return expr.slice(7);
    if (expr.startsWith("controller.")) return expr.slice(11);
    if (expr.includes(".value")) {
      return expr.replace(/\.(value|get)\(\)$/, "").split(".").at(-1) ?? expr;
    }
    return expr;
  }
}
