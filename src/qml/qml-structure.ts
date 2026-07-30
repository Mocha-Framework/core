import { QmlAstParser } from "./qml-ast-parser.js";

export interface QmlWindowProps {
  title?: string;
  width?: number;
  height?: number;
}

export interface QmlStructureAnalysis {
  imports: string[];
  rootTag: string | null;
  innerQML: string;
  windowProps: QmlWindowProps;
}

const astParser = new QmlAstParser();

export function analyzeQmlStructure(
  qml: string,
  templateForImports?: string
): QmlStructureAnalysis {
  const document = astParser.parse(qml);
  const importDocument = templateForImports && templateForImports !== qml
    ? astParser.parse(templateForImports)
    : document;
  const root = document.root;

  if (!root || (root.tag !== "ApplicationWindow" && root.tag !== "Window")) {
    return {
      imports: importDocument.imports,
      rootTag: root?.tag ?? null,
      innerQML: qml.trim(),
      windowProps: {},
    };
  }

  const firstChild = root.children[0];
  const innerStart = firstChild ? firstChild.startOffset : root.endOffset - 1;
  const innerEnd = Math.max(innerStart, root.endOffset - 1);

  return {
    imports: importDocument.imports,
    rootTag: root.tag,
    innerQML: qml.slice(innerStart, innerEnd).trim(),
    windowProps: extractWindowPropsFromElement(root.attrs),
  };
}

export function extractLatestTaggedQmlTemplate(
  source: string,
  tagName = "qml"
): { template: string; startOffset: number; endOffset: number } {
  let i = 0;
  let latest: { template: string; startOffset: number; endOffset: number } | null = null;
  let inSingleString = false;
  let inDoubleString = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1] ?? "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (inSingleString) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "'") inSingleString = false;
      i++;
      continue;
    }
    if (inDoubleString) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === '"') inDoubleString = false;
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingleString = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inDoubleString = true;
      i++;
      continue;
    }

    if (matchesTaggedTemplate(source, i, tagName)) {
      const backtickOffset = findTemplateStart(source, i + tagName.length);
      if (backtickOffset !== -1) {
        const parsed = parseTemplateLiteral(source, backtickOffset);
        latest = {
          template: parsed.content,
          startOffset: i,
          endOffset: parsed.endOffset,
        };
        i = parsed.endOffset;
        continue;
      }
    }

    i++;
  }

  if (!latest) {
    throw new Error(`Could not extract tagged template \`${tagName}\``);
  }

  return latest;
}

function extractWindowPropsFromElement(attrs: Record<string, string>): QmlWindowProps {
  const width = parseNumericAttr(attrs.width);
  const height = parseNumericAttr(attrs.height);
  return {
    title: attrs.title,
    width,
    height,
  };
}

function parseNumericAttr(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function matchesTaggedTemplate(source: string, offset: number, tagName: string): boolean {
  if (!source.startsWith(tagName, offset)) return false;
  const prev = offset === 0 ? "" : source[offset - 1];
  const next = source[offset + tagName.length] ?? "";
  if (prev && /[\w$]/.test(prev)) return false;
  return /[\s(`]/.test(next);
}

function findTemplateStart(source: string, offset: number): number {
  let i = offset;
  while (i < source.length && /\s/.test(source[i])) i++;
  return source[i] === "`" ? i : -1;
}

function parseTemplateLiteral(source: string, backtickOffset: number): {
  content: string;
  endOffset: number;
} {
  let i = backtickOffset + 1;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1] ?? "";

    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "$" && next === "{") {
      throw new Error("Interpolated qml templates are not supported in HMR extraction");
    }
    if (ch === "`") {
      return {
        content: source.slice(backtickOffset + 1, i),
        endOffset: i + 1,
      };
    }

    i++;
  }

  throw new Error("Unterminated tagged template literal");
}
