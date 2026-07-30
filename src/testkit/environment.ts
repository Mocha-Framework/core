import { test, expect } from "vitest";
import { collectQmlTests, runQmlTest } from "./qml-runner.js";

export interface DefineQmlTestsOptions {
  globs: string[];
  importPath?: string;
  suiteName?: string;
}

export function defineQmlTests(options: DefineQmlTestsOptions): void {
  const cases = collectQmlTests(options.globs);
  const importPath = options.importPath ?? process.env.MOCHA_QML_IMPORT_PATH ?? "";

  for (const tc of cases) {
    const suite = options.suiteName ? `[${options.suiteName}] ` : "";
    test(`${suite}${tc.file.split("/").pop()} > ${tc.name}`, async () => {
      const result = await runQmlTestAsync(tc, importPath);
      expect(result.passed, result.message).toBe(true);
    }, 30000);
  }
}

async function runQmlTestAsync(
  testCase: { file: string; name: string },
  importPath: string
): Promise<{ passed: boolean; message?: string }> {
  try {
    const result = runQmlTest(testCase, importPath);
    return { passed: result.passed, message: result.message };
  } catch (err: any) {
    return { passed: false, message: err.message };
  }
}
