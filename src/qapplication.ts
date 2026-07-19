import { Logger } from "@mocha/shared";
import { QObject } from "./qobject.js";
import { QThread, ThreadManager } from "./qthread.js";
import { Signal } from "./signals.js";
import { QTimer } from "./qtimer.js";

const logger = new Logger("QApplication");

export interface QApplicationConfig {
  mainThread?: string;
  workerThreads?: string[];
  sync?: "async-queue" | "direct" | "mutex";
  appName?: string;
  appVersion?: string;
  organization?: string;
}

export interface QApplicationSignals {
  aboutToQuit: () => void;
  destroyed: () => void;
}

export class QApplication extends QObject {
  readonly aboutToQuit = new Signal<() => void>();

  private static _instance: QApplication | null = null;
  private _running = false;
  private _config: QApplicationConfig;
  private _eventLoopTimer: QTimer | null = null;
  private _eventQueue: Array<{ event: string; data: unknown }> = [];
  private _eventHandlers = new Map<string, Set<(data: unknown) => void>>();
  private _startTime: number = 0;

  constructor(config: QApplicationConfig = {}) {
    super();
    this._config = {
      mainThread: "qt",
      workerThreads: ["v8"],
      sync: "async-queue",
      appName: "Mocha App",
      appVersion: "0.1.0",
      organization: "Mocha",
      ...config,
    };

    QApplication._instance = this;
    this._setupThreads();
  }

  static get instance(): QApplication | null {
    return QApplication._instance;
  }

  get appName(): string {
    return this._config.appName ?? "Mocha App";
  }

  get appVersion(): string {
    return this._config.appVersion ?? "0.1.0";
  }

  get organization(): string {
    return this._config.organization ?? "Mocha";
  }

  get isRunning(): boolean {
    return this._running;
  }

  get uptime(): number {
    if (!this._running) return 0;
    return performance.now() - this._startTime;
  }

  exec(): number {
    if (this._running) return 0;
    this._running = true;
    this._startTime = performance.now();

    logger.info(`${this.appName} v${this.appVersion} starting...`);
    logger.info(`Main thread: ${this._config.mainThread}`);
    logger.info(`Worker threads: ${this._config.workerThreads?.join(", ")}`);
    logger.info(`Sync mode: ${this._config.sync}`);

    this._eventLoopTimer = new QTimer();
    this._eventLoopTimer.interval = 1;
    this._eventLoopTimer.timeout.connect(() => this._processEvents());
    this._eventLoopTimer.start();

    return 0;
  }

  quit(exitCode: number = 0): void {
    if (!this._running) return;
    logger.info(`Quitting with code ${exitCode}`);

    this.aboutToQuit.emit();
    this._running = false;

    this._eventLoopTimer?.stop();
    this._eventLoopTimer?.dispose();
    this._eventLoopTimer = null;

    this._eventQueue = [];
    this._eventHandlers.clear();
    ThreadManager.disposeAll();
  }

  postEvent(event: string, data?: unknown): void {
    this._eventQueue.push({ event, data });
  }

  sendEvent(event: string, data?: unknown): void {
    this._dispatchEvent(event, data);
  }

  onEvent(event: string, handler: (data: unknown) => void): () => void {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set());
    }
    this._eventHandlers.get(event)!.add(handler);
    return () => {
      this._eventHandlers.get(event)?.delete(handler);
    };
  }

  async processEvents(): Promise<void> {
    this._processEvents();
  }

  dispose(): void {
    this.quit();
    QApplication._instance = null;
    super.dispose();
  }

  private _setupThreads(): void {
    ThreadManager.setSyncMode(this._config.sync ?? "async-queue");

    ThreadManager.getOrCreate(
      this._config.mainThread ?? "qt",
      "main"
    ).start();

    for (const threadName of this._config.workerThreads ?? []) {
      ThreadManager.getOrCreate(threadName, "worker").start();
    }
  }

  private _processEvents(): void {
    while (this._eventQueue.length > 0) {
      const event = this._eventQueue.shift()!;
      this._dispatchEvent(event.event, event.data);
    }
  }

  private _dispatchEvent(event: string, data?: unknown): void {
    const handlers = this._eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          logger.error(`Error handling event "${event}":`, err);
        }
      }
    }
  }
}
