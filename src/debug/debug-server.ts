import * as http from "node:http";
import { Logger, safeStringify } from "@mocha/shared";
import { QObject } from "../qobject.js";
import { ComponentInspector, type ComponentNode } from "./component-inspector.js";
import { PropertyInspector } from "./property-inspector.js";
import { SignalGraphBuilder } from "./signal-graph.js";
import { ThreadMonitor } from "./thread-monitor.js";
import { DebuggerProxy } from "./debugger.js";

const logger = new Logger("DebugServer");

export interface QmlTreeNode {
  type: string;
  id?: string;
  properties: Record<string, any>;
  children: QmlTreeNode[];
}

export interface DebugServerConfig {
  port?: number;
  host?: string;
  enableSignalGraph?: boolean;
  enableThreadMonitor?: boolean;
  broadcastInterval?: number;
}

export class DebugServer {
  private _server: http.Server | null = null;
  private _port: number;
  private _host: string;
  private _sseClients = new Set<http.ServerResponse>();
  private _componentInspector = new ComponentInspector();
  private _propertyInspector = new PropertyInspector();
  private _signalGraph = new SignalGraphBuilder();
  private _threadMonitor = new ThreadMonitor();
  private _debugger = new DebuggerProxy();
  private _root: QObject | null = null;
  private _running = false;
  private _broadcastTimer: ReturnType<typeof setInterval> | null = null;
  private _consoleOriginals: { log?: typeof console.log; warn?: typeof console.warn; error?: typeof console.error } = {};
  private _config: Required<DebugServerConfig>;
  private _qmlTree: QmlTreeNode[] = [];

  constructor(config: DebugServerConfig = {}) {
    this._config = {
      port: config.port ?? 9229,
      host: config.host ?? "localhost",
      enableSignalGraph: config.enableSignalGraph ?? true,
      enableThreadMonitor: config.enableThreadMonitor ?? true,
      broadcastInterval: config.broadcastInterval ?? 2000,
    };
    this._port = this._config.port;
    this._host = this._config.host;
  }

  async start(maxRetries = 10): Promise<void> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const port = attempt === 0 ? this._port : this._port + attempt;
      try {
        await this._tryListen(port);
        return;
      } catch (err: any) {
        if (err.code === "EADDRINUSE" && attempt < maxRetries - 1) {
          logger.warn(`Port ${port} in use, trying ${port + 1}`);
          continue;
        }
        throw err;
      }
    }
  }

  private _tryListen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this._handleRequest(req, res));
      server.on("error", (err) => {
        reject(err);
      });
      server.on("listening", () => {
        this._server = server;
        const addr = server.address();
        this._port = typeof addr === "object" && addr ? addr.port : port;
        this._running = true;
        logger.info(`Debug server listening on http://${this._host}:${this._port}`);
        if (this._config.enableThreadMonitor) {
          this._threadMonitor.startPolling(5000);
        }
        resolve();
      });
      server.listen({ port, host: this._host, reuseAddr: true });
    });
  }

  async stop(): Promise<void> {
    this._running = false;
    this._sseClients.clear();
    if (this._broadcastTimer) { clearInterval(this._broadcastTimer); this._broadcastTimer = null; }
    this._threadMonitor.stopPolling();
    this.stopConsoleCapture();
    return new Promise((resolve) => {
      if (this._server) this._server.close(() => resolve());
      else resolve();
    });
  }

  attach(root: QObject): void {
    this._root = root;
    this._componentInspector.inspect(root);
    this._propertyInspector.watch(root);

    if (this._config.enableSignalGraph) {
      this._signalGraph.buildFrom(root);
    }

    this._broadcastAll();

    if (this._broadcastTimer === null) {
      this.startPeriodicBroadcast(this._config.broadcastInterval);
    }

    logger.info(`Debug server attached to ${root.objectName}`);
  }

  detach(): void {
    if (this._root) this._propertyInspector.unwatch(this._root);
    this._root = null;
  }

  get port(): number { return this._port; }
  get isRunning(): boolean { return this._running; }
  get componentTree(): ComponentNode[] { return this._componentInspector.getTree(); }
  get propertyState() { return this._propertyInspector.getAllProperties(); }
  get signalGraph() { return this._signalGraph.getGraph(); }
  get threadInfo() { return this._threadMonitor.capture(); }
  get debuggerState() { return this._debugger.state; }
  get isPaused(): boolean { return this._debugger.isPaused; }
  get qmlTree() { return this._qmlTree; }

  interruptIfBreakpoint(methodName: string): boolean {
    return this._debugger.interruptIfMethodBreakpoint(methodName);
  }

  waitWhilePaused(): Promise<void> {
    return this._debugger.waitWhilePaused();
  }

  setQmlTree(tree: QmlTreeNode[]): void {
    this._qmlTree = tree;
    this._broadcast("qml-tree", tree);
  }

  setProperty(objectId: number, property: string, value: unknown): boolean {
    const obj = this._componentInspector.getObject(objectId);
    if (!obj) return false;
    this._propertyInspector.setProperty(obj, property, value);
    this._componentInspector.refreshNode(objectId);
    this._broadcastAll();
    return true;
  }

  startConsoleCapture(): void {
    if (this._consoleOriginals.log) return;
    this._consoleOriginals.log = console.log;
    this._consoleOriginals.warn = console.warn;
    this._consoleOriginals.error = console.error;

    const push = (level: string) => (...args: unknown[]) => {
      const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      this._broadcast("console", { level, message: msg, source: "ts", timestamp: Date.now() });
      this._consoleOriginals[level as keyof typeof this._consoleOriginals]?.apply(console, args as [any?, ...any[]]);
    };

    console.log = push("log");
    console.warn = push("warn");
    console.error = push("error");
  }

  stopConsoleCapture(): void {
    if (this._consoleOriginals.log) console.log = this._consoleOriginals.log;
    if (this._consoleOriginals.warn) console.warn = this._consoleOriginals.warn;
    if (this._consoleOriginals.error) console.error = this._consoleOriginals.error;
    this._consoleOriginals = {};
  }

  startPeriodicBroadcast(intervalMs: number): void {
    if (this._broadcastTimer) clearInterval(this._broadcastTimer);
    this._broadcastTimer = setInterval(() => {
      if (this._running && this._root) this._broadcastAll();
    }, intervalMs);
  }

  private _broadcastAll(): void {
    if (!this._root) return;
    this._broadcast("component-tree", this._componentInspector.getTree());
    this._broadcast("properties", this._propertyInspector.getAllProperties());
    if (this._qmlTree.length > 0) {
      this._broadcast("qml-tree", this._qmlTree);
    }
    if (this._config.enableSignalGraph) {
      this._broadcast("signal-graph", this._signalGraph.getGraph());
    }
  }

  private _broadcast(type: string, data: unknown): void {
    const message = `data: ${safeStringify({ type, data })}\n\n`;
    for (const client of this._sseClients) {
      client.write(message);
    }
  }

  private _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url = req.url ?? "/";

    if (url === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(`data: ${safeStringify({ type: "connected" })}\n\n`);
      if (this._root) {
        res.write(`data: ${safeStringify({ type: "component-tree", data: this._componentInspector.getTree() })}\n\n`);
        res.write(`data: ${safeStringify({ type: "properties", data: this._propertyInspector.getAllProperties() })}\n\n`);
        if (this._qmlTree.length > 0) {
          res.write(`data: ${safeStringify({ type: "qml-tree", data: this._qmlTree })}\n\n`);
        }
        if (this._config.enableSignalGraph) {
          res.write(`data: ${safeStringify({ type: "signal-graph", data: this._signalGraph.getGraph() })}\n\n`);
        }
        res.write(`data: ${safeStringify({ type: "thread-info", data: this._threadMonitor.capture() })}\n\n`);
      }
      this._sseClients.add(res);
      req.on("close", () => { this._sseClients.delete(res); });
      return;
    }

    if (url === "/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(safeStringify({
        componentTree: this._componentInspector.getTree(),
        qmlTree: this._qmlTree,
        properties: this._propertyInspector.getAllProperties(),
        signalGraph: this._signalGraph.getGraph(),
        threadInfo: this._threadMonitor.capture(),
        debuggerState: this._debugger.state,
      }));
      return;
    }

    if (url === "/property" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { objectId, property, value } = JSON.parse(body);
          if (objectId == null || !property) { res.writeHead(400); res.end(JSON.stringify({ error: "Missing objectId or property" })); return; }
          const ok = this.setProperty(objectId, property, value);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    if (url.startsWith("/debugger/")) {
      const action = url.replace("/debugger/", "");
      this._handleDebuggerAction(action, req, res);
      return;
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Mocha Debug Server\n\nEndpoints:\n  GET  /events     - SSE stream\n  GET  /state      - Full state snapshot\n  POST /property   - Set property {objectId, property, value}\n  POST /debugger/* - Debug commands");
  }

  private _handleDebuggerAction(action: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    const respond = (data: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    if (req.method === "POST" && (action.startsWith("breakpoint/") || action === "eval" || action === "setBreakpoints")) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const result = await this._executeDebuggerAction(action, parsed);
          respond(result);
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    } else {
      this._executeDebuggerAction(action, {}).then(respond).catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      });
    }
  }

  private async _executeDebuggerAction(action: string, body: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case "connect": return this._debugger.connect();
      case "disconnect": this._debugger.disconnect(); return { ok: true };
      case "pause": await this._debugger.pause(); return { ok: true, state: this._debugger.state };
      case "resume": await this._debugger.resume(); return { ok: true, state: this._debugger.state };
      case "step": await this._debugger.stepOver(); return { ok: true, state: this._debugger.state };
      case "breakpoints": return { breakpoints: this._debugger.state.breakpoints };
      case "breakpoint/add": {
        if (body.objectName && body.signalName) {
          this._debugger.addBreakpoint(body.objectName as string, body.signalName as string);
          return { ok: true, breakpoints: this._debugger.state.breakpoints };
        }
        return { error: "Missing objectName or signalName" };
      }
      case "breakpoint/remove": {
        if (body.objectName && body.signalName) {
          this._debugger.removeBreakpoint(body.objectName as string, body.signalName as string);
          return { ok: true, breakpoints: this._debugger.state.breakpoints };
        }
        return { error: "Missing objectName or signalName" };
      }
      case "setBreakpoints": {
        if (body.methods) {
          this._debugger.setMethodBreakpoints(body.methods as string[]);
          return { ok: true, methods: this._debugger.state.methodBreakpoints };
        }
        return { error: "Missing 'methods' array" };
      }
      case "shutdown": {
        await this.stop();
        process.exit(0);
        return { ok: true };
      }
      default: return { error: `Unknown debugger action: ${action}` };
    }
  }
}
