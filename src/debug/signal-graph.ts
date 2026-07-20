import { QObject, Signal, getMetaObjectHierarchy } from "../index.js";
import { Logger } from "@mocha/shared";

const logger = new Logger("SignalGraph");

export interface SignalNode {
  id: string;
  objectName: string;
  className: string;
  signalName: string;
  connectionCount: number;
}

export interface SlotNode {
  id: string;
  objectName: string;
  className: string;
  methodName: string;
}

export interface SignalGraphConnection {
  id: string;
  source: SignalNode;
  target: SlotNode;
}

export interface SignalGraph {
  signals: SignalNode[];
  slots: SlotNode[];
  connections: SignalGraphConnection[];
}

export class SignalGraphBuilder {
  private _graph: SignalGraph = { signals: [], slots: [], connections: [] };

  buildFrom(root: QObject): SignalGraph {
    this._graph = { signals: [], slots: [], connections: [] };
    this._traverseObject(root);
    return this._graph;
  }

  getGraph(): SignalGraph {
    return {
      signals: [...this._graph.signals],
      slots: [...this._graph.slots],
      connections: [...this._graph.connections],
    };
  }

  private _traverseObject(obj: QObject): void {
    const ctor = obj.constructor as Function;
    const hierarchy = getMetaObjectHierarchy(ctor);

    const declaredSignals = new Set<string>();
    for (const m of hierarchy) {
      for (const s of m.signals) declaredSignals.add(s);
    }

    if (declaredSignals.size === 0) {
      for (const key of Object.getOwnPropertyNames(obj)) {
        if ((obj as any)[key] instanceof Signal) {
          declaredSignals.add(key);
        }
      }
    }

    for (const name of declaredSignals) {
      const value = (obj as any)[name];
      if (!(value instanceof Signal)) continue;

      const sigNode: SignalNode = {
        id: `${obj.objectId}_${name}`,
        objectName: obj.objectName,
        className: obj.constructor.name,
        signalName: name,
        connectionCount: (value as Signal).connectionCount,
      };
      this._graph.signals.push(sigNode);
    }

    for (const child of obj.children) {
      this._traverseObject(child);
    }
  }

  addConnection(
    sourceId: string,
    targetName: string,
    targetClass: string,
    methodName: string
  ): void {
    const source = this._graph.signals.find((s) => s.id === sourceId);
    if (!source) {
      logger.warn(`Signal not found: ${sourceId}`);
      return;
    }

    const slotNode: SlotNode = {
      id: `${targetName}_${methodName}`,
      objectName: targetName,
      className: targetClass,
      methodName,
    };

    const conn: SignalGraphConnection = {
      id: `${sourceId}->${slotNode.id}`,
      source,
      target: slotNode,
    };

    this._graph.slots.push(slotNode);
    this._graph.connections.push(conn);
  }

  exportDOT(): string {
    let dot = "digraph SignalGraph {\n";
    dot += '  rankdir=LR;\n';
    dot += '  node [shape=box, style=filled, fillcolor="#161b22", fontcolor="#c9d1d9"];\n';

    for (const sig of this._graph.signals) {
      dot += `  "${sig.id}" [label="${sig.objectName}\\n${sig.signalName}", fillcolor="#0d419d"];\n`;
    }

    for (const slot of this._graph.slots) {
      dot += `  "${slot.id}" [label="${slot.objectName}\\n${slot.methodName}", fillcolor="#1d5e1d"];\n`;
    }

    for (const conn of this._graph.connections) {
      dot += `  "${conn.source.id}" -> "${conn.target.id}";\n`;
    }

    dot += "}\n";
    return dot;
  }

  exportJSON(): string {
    return JSON.stringify(this._graph, null, 2);
  }
}
