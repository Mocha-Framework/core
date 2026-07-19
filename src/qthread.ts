import { Logger } from "@mocha/shared";

const logger = new Logger("QThread");

export type ThreadExecutor = (
  task: () => void,
  priority?: number
) => void;

export interface QThreadOptions {
  name?: string;
  type: "main" | "worker";
  executor?: ThreadExecutor;
}

export class QThread {
  readonly name: string;
  readonly type: "main" | "worker";
  private _executor: ThreadExecutor;
  private _pendingTasks: Array<{ task: () => void; priority: number }> = [];
  private _running = false;
  private _worker: any = null;

  static readonly MAIN_THREAD = "qt";
  static readonly V8_THREAD = "v8";
  static readonly RENDER_THREAD = "render";

  constructor(options: QThreadOptions) {
    this.name = options.name ?? `thread_${Date.now()}`;
    this.type = options.type;
    this._executor = options.executor ?? this._defaultExecutor;
  }

  postTask(task: () => void, priority: number = 0): void {
    this._pendingTasks.push({ task, priority });
    this._pendingTasks.sort((a, b) => b.priority - a.priority);
    this._flushPending();
  }

  isRunning(): boolean {
    return this._running;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    logger.debug(`Thread "${this.name}" started`);
  }

  stop(): void {
    this._running = false;
    this._pendingTasks = [];
    this._worker?.terminate?.();
    this._worker = null;
    logger.debug(`Thread "${this.name}" stopped`);
  }

  setExecutor(executor: ThreadExecutor): void {
    this._executor = executor;
  }

  private _flushPending(): void {
    while (this._running && this._pendingTasks.length > 0) {
      const { task } = this._pendingTasks.shift()!;
      this._executor(task);
    }
  }

  private _defaultExecutor(task: () => void): void {
    if (this.type === "main") {
      task();
    } else {
      if (typeof queueMicrotask === "function") {
        queueMicrotask(task);
      } else {
        Promise.resolve().then(task);
      }
    }
  }
}

export class ThreadManager {
  private static _threads = new Map<string, QThread>();
  private static _syncMode: "async-queue" | "direct" | "mutex" =
    "async-queue";

  static setSyncMode(mode: "async-queue" | "direct" | "mutex"): void {
    this._syncMode = mode;
  }

  static getSyncMode(): string {
    return this._syncMode;
  }

  static registerThread(thread: QThread): void {
    this._threads.set(thread.name, thread);
  }

  static getThread(name: string): QThread | undefined {
    return this._threads.get(name);
  }

  static getOrCreate(name: string, type: "main" | "worker"): QThread {
    let thread = this._threads.get(name);
    if (!thread) {
      thread = new QThread({ name, type });
      this._threads.set(name, thread);
    }
    return thread;
  }

  static mainThread(): QThread {
    return this.getOrCreate(QThread.MAIN_THREAD, "main");
  }

  static v8Thread(): QThread {
    return this.getOrCreate(QThread.V8_THREAD, "worker");
  }

  static postToMain(task: () => void): void {
    this.mainThread().postTask(task);
  }

  static postToV8(task: () => void): void {
    this.v8Thread().postTask(task);
  }

  static disposeAll(): void {
    for (const thread of this._threads.values()) {
      thread.stop();
    }
    this._threads.clear();
  }
}
