import { Disposable, EventEmitter } from "@mocha/shared";

export interface SignalConnection {
  disconnect(): void;
  isConnected(): boolean;
}

export class Signal<T extends (...args: any[]) => void = () => void>
  extends Disposable
{
  private _emitter = new EventEmitter<{ fired: T }>();
  private _connections: Set<(...args: Parameters<T>) => void> = new Set();

  connect(listener: T): SignalConnection {
    const self = this;
    this._emitter.on("fired", listener as any);
    this._connections.add(listener as any);
    return {
      disconnect() {
        self._emitter.off("fired", listener as any);
        self._connections.delete(listener as any);
      },
      isConnected() {
        return self._connections.has(listener as any);
      },
    };
  }

  disconnect(listener?: T): void {
    if (listener) {
      this._emitter.off("fired", listener as any);
      this._connections.delete(listener as any);
    } else {
      this._emitter.removeAllListeners();
      this._connections.clear();
    }
  }

  emit(...args: Parameters<T>): void {
    this._emitter.emit("fired", ...args);
  }

  get connectionCount(): number {
    return this._connections.size;
  }

  dispose(): void {
    this.disconnect();
    super.dispose();
  }
}

export class BindableSlot<
  TArgs extends any[] = any[],
  TReturn = void
> {
  private _handler: ((...args: TArgs) => TReturn) | null = null;
  private _connections: Signal<any>[] = [];

  setHandler(handler: (...args: TArgs) => TReturn): this {
    this._handler = handler;
    return this;
  }

  connectTo(...signals: Signal<(...args: any[]) => void>[]): this {
    for (const signal of signals) {
      signal.connect(((...args: any[]) => {
        this._handler?.(...(args as TArgs));
      }) as any);
      this._connections.push(signal);
    }
    return this;
  }

  invoke(...args: TArgs): TReturn {
    if (!this._handler) {
      throw new Error("BindableSlot called without handler");
    }
    return this._handler(...args);
  }

  disconnect(): void {
    for (const signal of this._connections) {
      signal.disconnect();
    }
    this._connections = [];
  }

  get hasHandler(): boolean {
    return this._handler !== null;
  }
}
