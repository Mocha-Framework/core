import { execFileSync, execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";

export interface QmlTestCase {
  file: string;
  name: string;
}

export interface QmlTestResult {
  file: string;
  name: string;
  passed: boolean;
  message?: string;
  durationMs: number;
}

function findQmltestrunner(): string {
  const envPath = process.env.QMLTEST_PATH || process.env.QMLTESTRUNNER_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  try {
    const result = execSync("which qmltestrunner 2>/dev/null || true", { encoding: "utf-8" }).trim();
    if (result && existsSync(result)) return result;
  } catch {}

  if (platform() === "linux") {
    for (const p of ["/usr/lib/qt6/bin/qmltestrunner", "/usr/bin/qmltestrunner"]) {
      if (existsSync(p)) return p;
    }
  }
  if (platform() === "darwin") {
    for (const p of ["/opt/homebrew/bin/qmltestrunner", "/usr/local/bin/qmltestrunner"]) {
      if (existsSync(p)) return p;
    }
  }

  throw new Error("qmltestrunner not found. Set QMLTEST_PATH env var or install Qt6 test tools.");
}

const QMLTESTRUNNER_BIN = findQmltestrunner();

function findTestFunctions(qmlFile: string): string[] {
  const content = readFileSync(qmlFile, "utf-8");
  const matches = content.matchAll(/function\s+(test_\w+)\s*\(/g);
  return [...matches].map((m) => m[1]);
}

export function collectQmlTests(patterns: string[]): QmlTestCase[] {
  const results: QmlTestCase[] = [];
  const fs = require("node:fs") as typeof import("node:fs");
  const glob = (pattern: string): string[] => {
    if (!pattern.includes("*")) {
      return fs.existsSync(pattern) ? [pattern] : [];
    }
    const parts = pattern.split("*");
    const dir = join(process.cwd(), parts[0].split("/").slice(0, -1).join("/"));
    const ext = parts[parts.length - 1];
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(parts[0].split("/").pop()?.split("*")[0] ?? "") && f.endsWith(ext))
      .map((f) => join(dir, f));
  };
  for (const pattern of patterns) {
    const files = glob(pattern);
    for (const file of files) {
      const funcs = findTestFunctions(file);
      for (const name of funcs) {
        results.push({ file, name });
      }
    }
  }
  return results;
}

export function runQmlTest(
  testCase: QmlTestCase,
  importPath?: string
): QmlTestResult {
  const start = Date.now();
  try {
    const args = ["-input", testCase.file, testCase.name, "-silent"];
    if (importPath) {
      args.unshift("-import", importPath);
    }
    execFileSync(QMLTESTRUNNER_BIN, args, {
      encoding: "utf-8",
      timeout: 30000,
      cwd: process.cwd(),
    });
    return {
      file: testCase.file,
      name: testCase.name,
      passed: true,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    const stderr = err.stderr?.toString() ?? err.message;
    const stdout = err.stdout?.toString() ?? "";
    return {
      file: testCase.file,
      name: testCase.name,
      passed: false,
      message: stderr || stdout || "qmltestrunner exited with error",
      durationMs: Date.now() - start,
    };
  }
}

export function runQmlFile(
  qmlFile: string,
  importPath?: string
): QmlTestResult[] {
  const funcs = findTestFunctions(qmlFile);
  return funcs.map((name) => runQmlTest({ file: qmlFile, name }, importPath));
}

export { QMLTESTRUNNER_BIN };
