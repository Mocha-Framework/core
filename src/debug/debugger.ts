import { Logger } from "@mocha/shared";

const logger = new Logger("DebuggerProxy");

export interface DebuggerState {
  connected: boolean;
  paused: boolean;
  breakpoints: Array<{ objectName: string; signalName: string }>;
  methodBreakpoints: string[];
  pausedMethod?: string;
  file?: string;
  line?: number;
}

export class DebuggerProxy {
  private _state: DebuggerState = { connected: false, paused: false, breakpoints: [], methodBreakpoints: [] };
  private _onPaused: ((state: DebuggerState) => void) | null = null;
  private _onResumed: (() => void) | null = null;
  private _waitForResume: (() => void) | null = null;

  setOnPaused(cb: (state: DebuggerState) => void): void {
    this._onPaused = cb;
  }

  setOnResumed(cb: () => void): void {
    this._onResumed = cb;
  }

  get state(): DebuggerState {
    return {
      connected: this._state.connected,
      paused: this._state.paused,
      breakpoints: [...this._state.breakpoints],
      methodBreakpoints: [...this._state.methodBreakpoints],
      pausedMethod: this._state.pausedMethod,
    };
  }

  get isPaused(): boolean {
    return this._state.paused;
  }

  async connect(): Promise<{ ok: boolean; port: number; error?: string }> {
    if (this._state.connected) {
      return { ok: true, port: 0 };
    }
    this._state.connected = true;
    this._state.paused = false;
    logger.info("Debugger connected (TS-level)");
    return { ok: true, port: 0 };
  }

  disconnect(): void {
    this._state.connected = false;
    this._state.paused = false;
    this._state.breakpoints = [];
    this._state.methodBreakpoints = [];
    this._state.pausedMethod = undefined;
    if (this._waitForResume) {
      this._waitForResume();
      this._waitForResume = null;
    }
    logger.info("Debugger disconnected");
  }

  async pause(): Promise<void> {
    this._state.paused = true;
    this._onPaused?.(this.state);
    logger.debug("Execution paused");
  }

  async resume(): Promise<void> {
    this._state.paused = false;
    this._state.pausedMethod = undefined;
    if (this._waitForResume) {
      const cb = this._waitForResume;
      this._waitForResume = null;
      cb();
    }
    this._onResumed?.();
    logger.debug("Execution resumed");
  }

  async stepOver(): Promise<void> {
    logger.debug("Step over");
  }

  hasBreakpoint(objectName: string, signalName: string): boolean {
    return this._state.breakpoints.some(
      (b) => b.objectName === objectName && b.signalName === signalName
    );
  }

  addBreakpoint(objectName: string, signalName: string): void {
    if (this.hasBreakpoint(objectName, signalName)) return;
    this._state.breakpoints.push({ objectName, signalName });
    logger.debug(`Breakpoint added: ${objectName}.${signalName}`);
  }

  removeBreakpoint(objectName: string, signalName: string): void {
    this._state.breakpoints = this._state.breakpoints.filter(
      (b) => !(b.objectName === objectName && b.signalName === signalName)
    );
    logger.debug(`Breakpoint removed: ${objectName}.${signalName}`);
  }

  setMethodBreakpoints(methods: string[]): void {
    this._state.methodBreakpoints = [...methods];
    logger.debug(`Method breakpoints set: ${methods.join(", ")}`);
  }

  hasMethodBreakpoint(methodName: string): boolean {
    return this._state.methodBreakpoints.includes(methodName);
  }

  waitWhilePaused(): Promise<void> {
    if (!this._state.paused) return Promise.resolve();
    return new Promise((resolve) => {
      this._waitForResume = resolve;
    });
  }

  interruptIfBreakpoint(objectName: string, signalName: string, file?: string, line?: number): boolean {
    if (!this._state.connected) return false;
    if (this.hasBreakpoint(objectName, signalName)) {
      this._state.file = file;
      this._state.line = line;
      this._state.paused = true;
      this._state.pausedMethod = signalName;
      this._onPaused?.(this.state);
      return true;
    }
    return false;
  }

  interruptIfMethodBreakpoint(methodName: string): boolean {
    if (!this._state.connected) return false;
    if (this.hasMethodBreakpoint(methodName)) {
      this._state.paused = true;
      this._state.pausedMethod = methodName;
      this._onPaused?.(this.state);
      logger.debug(`Breakpoint hit: ${methodName}`);
      return true;
    }
    return false;
  }

  dispose(): void {
    this.disconnect();
  }
}
