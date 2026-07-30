export class Disposable {
  private _disposed = false;
  private _disposables: Disposable[] = [];

  get isDisposed(): boolean {
    return this._disposed;
  }

  protected addDisposable(d: Disposable): void {
    this._disposables.push(d);
  }

  protected removeDisposable(d: Disposable): void {
    const idx = this._disposables.indexOf(d);
    if (idx >= 0) this._disposables.splice(idx, 1);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}

export class EventEmitter<T extends Record<string, (...args: any[]) => void>> {
  private _listeners = new Map<keyof T, Set<Function>>();

  on<K extends keyof T>(event: K, listener: T[K]): () => void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off<K extends keyof T>(event: K, listener: T[K]): void {
    this._listeners.get(event)?.delete(listener);
  }

  emit<K extends keyof T>(event: K, ...args: Parameters<T[K]>): void {
    this._listeners.get(event)?.forEach((fn) => fn(...args));
  }

  removeAllListeners(): void {
    this._listeners.clear();
  }

  listenerCount<K extends keyof T>(event: K): number {
    return this._listeners.get(event)?.size ?? 0;
  }
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type NonNullableFields<T> = {
  [P in keyof T]: NonNullable<T[P]>;
};

export interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: number;
  source: string;
  data?: unknown;
}

export type LogHandler = (entry: LogEntry) => void;

export class Logger {
  private static _handler: LogHandler | null = null;

  static setHandler(handler: LogHandler | null): void {
    this._handler = handler;
  }

  constructor(private source: string) {}

  debug(message: string, data?: unknown): void {
    this.log("debug", message, data);
  }
  info(message: string, data?: unknown): void {
    this.log("info", message, data);
  }
  warn(message: string, data?: unknown): void {
    this.log("warn", message, data);
  }
  error(message: string, data?: unknown): void {
    this.log("error", message, data);
  }

  private log(level: LogEntry["level"], message: string, data?: unknown): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      source: this.source,
      data,
    };
    Logger._handler?.(entry);
    const prefix = `[${level.toUpperCase()}] [${this.source}]`;
    switch (level) {
      case "debug":
        console.debug(prefix, message, data ?? "");
        break;
      case "info":
        console.info(prefix, message, data ?? "");
        break;
      case "warn":
        console.warn(prefix, message, data ?? "");
        break;
      case "error":
        console.error(prefix, message, data ?? "");
        break;
    }
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export { safeStringify } from "./safe-stringify.js";
