import { Disposable, Logger } from "@mocha/shared";
import { Signal } from "./signals.js";
import { ConnectionType } from "./types.js";

const logger = new Logger("QTimer");

export class QTimer extends Disposable {
  readonly timeout = new Signal<() => void>();

  private _interval: number = 0;
  private _singleShot: boolean = false;
  private _active: boolean = false;
  private _timerId: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null = null;
  private _connectionType: ConnectionType = ConnectionType.Auto;
  private _remainingTime: number = 0;
  private _startTime: number = 0;

  constructor(parent?: any) {
    super();
  }

  get interval(): number {
    return this._interval;
  }

  set interval(ms: number) {
    this._interval = ms;
  }

  get isActive(): boolean {
    return this._active;
  }

  get isSingleShot(): boolean {
    return this._singleShot;
  }

  set singleShot(value: boolean) {
    this._singleShot = value;
  }

  get remainingTime(): number {
    if (!this._active) return 0;
    if (this._singleShot) {
      return Math.max(0, this._remainingTime - (performance.now() - this._startTime));
    }
    return this._interval - ((performance.now() - this._startTime) % this._interval);
  }

  start(ms?: number): void {
    if (ms !== undefined) {
      this._interval = ms;
    }
    if (this._interval <= 0) {
      logger.warn(`Timer interval must be > 0, got ${this._interval}`);
      return;
    }

    this.stop();

    this._active = true;
    this._startTime = performance.now();
    this._remainingTime = this._interval;

    if (this._singleShot) {
      this._timerId = setTimeout(() => {
        this._onTimeout();
      }, this._interval);
    } else {
      this._timerId = setInterval(() => {
        this._startTime = performance.now();
        this._onTimeout();
      }, this._interval);
    }
  }

  stop(): void {
    if (!this._active) return;

    if (this._timerId !== null) {
      if (this._singleShot) {
        clearTimeout(this._timerId);
      } else {
        clearInterval(this._timerId);
      }
      this._timerId = null;
    }

    this._active = false;
    this._remainingTime = 0;
  }

  static singleShot(ms: number, callback: () => void): QTimer {
    const timer = new QTimer();
    timer.singleShot = true;
    timer.interval = ms;
    timer.timeout.connect(() => {
      callback();
      timer.dispose();
    });
    timer.start(ms);
    return timer;
  }

  setConnectionType(type: ConnectionType): void {
    this._connectionType = type;
  }

  dispose(): void {
    this.stop();
    this.timeout.disconnect();
    super.dispose();
  }

  private _onTimeout(): void {
    if (this._singleShot) {
      this._active = false;
      if (this._timerId !== null) {
        clearTimeout(this._timerId);
        this._timerId = null;
      }
    }
    this.timeout.emit();
  }
}
