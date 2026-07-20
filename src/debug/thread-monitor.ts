import { ThreadManager } from "../index.js";
import { Logger } from "@mocha/shared";

const logger = new Logger("ThreadMonitor");

export interface ThreadInfo {
  name: string;
  type: string;
  isRunning: boolean;
  pendingTasks: number;
}

export interface ThreadMonitorData {
  threads: ThreadInfo[];
  syncMode: string;
  timestamp: number;
}

export class ThreadMonitor {
  private _pollInterval: number = 1000;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _onUpdate: ((data: ThreadMonitorData) => void) | null = null;

  setUpdateCallback(callback: (data: ThreadMonitorData) => void): void {
    this._onUpdate = callback;
  }

  startPolling(intervalMs: number = 1000): void {
    this._pollInterval = intervalMs;
    if (this._pollTimer) this.stopPolling();

    this._pollTimer = setInterval(() => {
      const data = this.capture();
      this._onUpdate?.(data);
    }, this._pollInterval);

    logger.debug(`Thread polling started (${intervalMs}ms)`);
  }

  stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  capture(): ThreadMonitorData {
    const threads: ThreadInfo[] = [
      {
        name: "qt",
        type: "main",
        isRunning: ThreadManager.getThread("qt")?.isRunning() ?? false,
        pendingTasks: 0,
      },
      {
        name: "v8",
        type: "worker",
        isRunning: ThreadManager.getThread("v8")?.isRunning() ?? false,
        pendingTasks: 0,
      },
      {
        name: "render",
        type: "worker",
        isRunning: ThreadManager.getThread("render")?.isRunning() ?? false,
        pendingTasks: 0,
      },
    ];

    return {
      threads,
      syncMode: ThreadManager.getSyncMode(),
      timestamp: Date.now(),
    };
  }

  dispose(): void {
    this.stopPolling();
  }
}
