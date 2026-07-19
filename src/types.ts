export const enum ConnectionType {
  Auto = 0,
  Direct = 1,
  Queued = 2,
  BlockingQueued = 3,
}

export interface QMetaProperty {
  name: string;
  type: string;
  value: unknown;
  notifySignal?: string;
  isConstant: boolean;
  isReadable: boolean;
  isWritable: boolean;
}

export interface QMetaMethod {
  name: string;
  returnType: string;
  parameterTypes: string[];
  methodType: "signal" | "slot" | "method";
}

export interface QMetaObjectData {
  className: string;
  superClass: string | null;
  properties: QMetaProperty[];
  signals: string[];
  slots: string[];
}

export interface QObjectPointer<T> {
  isNull(): boolean;
  data(): T | null;
}

export interface QThreadAffinity {
  threadId: string;
  objectName: string;
}
