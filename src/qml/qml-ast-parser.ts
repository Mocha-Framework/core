export interface QmlElement {
  tag: string;
  id: string | null;
  attrs: Record<string, string>;
  body: string;
  children: QmlElement[];
  startLine: number;
  endLine: number;
  startOffset: number;
  bodyStartOffset: number;
  endOffset: number;
}

export interface QmlDocument {
  imports: string[];
  root: QmlElement | null;
}

export class QmlAstParser {
  private _source = "";

  parse(qml: string): QmlDocument {
    this._source = qml;
    const imports: string[] = [];
    const importRegex = /^\s*import\s+.+$/gm;
    let match;
    while ((match = importRegex.exec(qml)) !== null) {
      imports.push(match[0].trim());
    }

    const root = this._parseElement(qml, 0, 0);
    return { imports, root: root?.element ?? null };
  }

  findElements(root: QmlElement, predicate: (el: QmlElement) => boolean): QmlElement[] {
    const result: QmlElement[] = [];
    this._walk(root, (el) => { if (predicate(el)) result.push(el); });
    return result;
  }

  getTextContent(el: QmlElement): string {
    const lines: string[] = [];
    for (const child of el.children) {
      if (child.tag === "#text") {
        lines.push(child.body);
      }
    }
    return lines.join("\n");
  }

  private _walk(el: QmlElement, fn: (el: QmlElement) => void): void {
    fn(el);
    for (const child of el.children) {
      this._walk(child, fn);
    }
  }

  private _parseElement(
    qml: string,
    startOffset: number,
    baseOffset: number
  ): { element: QmlElement; endOffset: number } | null {
    const start = this._findNextElementStart(qml, startOffset);
    if (!start) return null;

    const body = this._extractBody(qml, start.braceOffset + 1);
    if (body === null) return null;

    const globalStartOffset = baseOffset + start.tagOffset;
    const globalBodyStartOffset = baseOffset + start.braceOffset + 1;
    const globalEndOffset = baseOffset + body.endOffset;
    const element = this._buildElement(
      start.tag,
      body.content,
      this._lineAt(globalStartOffset),
      this._lineAt(globalEndOffset),
      globalStartOffset,
      globalBodyStartOffset,
      globalEndOffset
    );

    const children: QmlElement[] = [];
    let searchOffset = 0;
    while (searchOffset < body.content.length) {
      const child = this._parseElement(body.content, searchOffset, globalBodyStartOffset);
      if (!child) break;
      children.push(child.element);
      searchOffset = child.endOffset - globalBodyStartOffset;
    }
    element.children = children;

    return { element, endOffset: globalEndOffset };
  }

  private _extractBody(qml: string, start: number): { content: string; endOffset: number } | null {
    let depth = 1;
    let i = start;
    let inSingleString = false;
    let inDoubleString = false;
    let inLineComment = false;
    let inBlockComment = false;

    while (i < qml.length && depth > 0) {
      const ch = qml[i];
      const next = qml[i + 1] ?? "";

      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        i++;
        continue;
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") { inBlockComment = false; i += 2; }
        else i++;
        continue;
      }
      if (inSingleString) {
        if (ch === "'" && next === "'") i += 2;  // '' escape
        else if (ch === "'") inSingleString = false;
        i++;
        continue;
      }
      if (inDoubleString) {
        if (ch === '"' && next === '"') i += 2;  // "" escape
        else if (ch === '"') inDoubleString = false;
        i++;
        continue;
      }

      if (ch === "/" && next === "/") { inLineComment = true; i += 2; continue; }
      if (ch === "/" && next === "*") { inBlockComment = true; i += 2; continue; }
      if (ch === "'") { inSingleString = true; i++; continue; }
      if (ch === '"') { inDoubleString = true; i++; continue; }

      if (ch === "{") depth++;
      else if (ch === "}") depth--;

      i++;
    }

    const endOffset = depth === 0 ? i - 1 : i;
    return {
      content: qml.slice(start, endOffset),
      endOffset,
    };
  }

  private _buildElement(
    tag: string,
    body: string,
    line: number,
    endLine: number,
    startOffset: number,
    bodyStartOffset: number,
    endOffset: number
  ): QmlElement {
    const id = this._extractId(body);
    const attrs = this._extractAttrs(body);
    return {
      tag,
      id,
      attrs,
      body,
      children: [],
      startLine: line,
      endLine,
      startOffset,
      bodyStartOffset,
      endOffset,
    };
  }

  private _findNextElementStart(
    qml: string,
    startOffset: number
  ): { tag: string; tagOffset: number; braceOffset: number } | null {
    let i = startOffset;
    let inSingleString = false;
    let inDoubleString = false;
    let inLineComment = false;
    let inBlockComment = false;

    while (i < qml.length) {
      const ch = qml[i];
      const next = qml[i + 1] ?? "";

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

      if (/[A-Z]/.test(ch) && this._isElementBoundary(qml, i)) {
        let j = i + 1;
        while (j < qml.length && /\w/.test(qml[j])) j++;
        const tag = qml.slice(i, j);

        let k = j;
        while (k < qml.length && /\s/.test(qml[k])) k++;
        if (qml[k] === "{") {
          return {
            tag,
            tagOffset: i,
            braceOffset: k,
          };
        }
      }

      i++;
    }

    return null;
  }

  private _isElementBoundary(qml: string, offset: number): boolean {
    if (offset === 0) return true;
    const prev = qml[offset - 1];
    return /[\s:{;(,\[]/.test(prev);
  }

  private _extractId(body: string): string | null {
    const idMatch = body.match(/\bid\s*:\s*(?:"([^"]*)"|(\w+))/);
    return idMatch?.[1] ?? idMatch?.[2] ?? null;
  }

  private _extractAttrs(body: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const attrRegex = /(\w+)\s*:\s*("[^"]*"|'[^']*'|[^;\n{]+?)(?=[\s;}])/g;
    let m;
    while ((m = attrRegex.exec(body)) !== null) {
      const value = m[2].replace(/^["']|["']$/g, "");
      if (m[1] !== "id") attrs[m[1]] = value;
    }
    return attrs;
  }

  private _lineAt(offset: number): number {
    return this._source.slice(0, offset).split("\n").length;
  }
}
