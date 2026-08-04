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
    let i = 0;
    while (i < body.length) {
      // Skip whitespace and newlines between attributes
      while (i < body.length && /[\s]/.test(body[i])) i++;
      if (i >= body.length || body[i] === "}") break;

      // Parse key (word chars + dots for nested properties like font.pixelSize)
      const keyStart = i;
      while (i < body.length && /[\w.]/.test(body[i])) i++;
      const key = body.slice(keyStart, i);
      if (!key) break;

      // Skip whitespace, expect ':'
      while (i < body.length && /[\s]/.test(body[i])) i++;
      if (body[i] !== ":") {
        // Not an attribute — could be a child element (`Tag { ... }`).
        // Skip over it (track nested braces) so we don't get tripped up by
        // its internal structure.
        let depth = 0;
        while (i < body.length) {
          const c = body[i];
          if (c === "{") depth++;
          else if (c === "}") {
            if (depth === 0) break;
            depth--;
          } else if (depth === 0 && (c === ";" || c === "\n")) {
            break;
          }
          i++;
        }
        if (body[i] === ";") i++;
        continue;
      }
      i++; // consume ':'
      while (i < body.length && /[ \t]/.test(body[i])) i++;

      // Parse value
      const value = this._extractAttrValue(body, i);
      if (value === null) {
        // Couldn't parse — bail
        break;
      }

      if (key !== "id") attrs[key] = value.text;
      i = value.endOffset;
      // Skip optional ';' separator
      if (body[i] === ";") i++;
    }
    return attrs;
  }

  /**
   * Extract a single attribute value starting at offset `i`.
   * Returns `{ text, endOffset }` where `text` preserves the original
   * syntax (including `"..."` / `'...'` quoting and `{ ... }` blocks) so
   * downstream consumers can detect literal strings vs. raw expressions.
   */
  private _extractAttrValue(body: string, i: number): { text: string; endOffset: number } | null {
    if (i >= body.length) return null;
    const ch = body[i];

    // Block value: `{ ... }` — always a standalone block.
    if (ch === "{") {
      let depth = 1;
      let j = i + 1;
      while (j < body.length && depth > 0) {
        const c = body[j];
        const n = body[j + 1] ?? "";
        if (c === '"' && n === '"') { j += 2; continue; }
        if (c === "'" && n === "'") { j += 2; continue; }
        if (c === "{") depth++;
        else if (c === "}") depth--;
        j++;
      }
      return { text: body.slice(i, j), endOffset: j };
    }

    // Everything else is a raw expression that may include one or more
    // string literals (e.g. `"Count: " + controller.count.value`).
    // Read until we hit ';' or '}' at depth 0 — but only after consuming
    // any continuation past a closing quote.
    const start = i;
    let depth = 0;
    let inStr: '"' | "'" | null = null;
    while (i < body.length) {
      const c = body[i];
      const n = body[i + 1] ?? "";

      if (inStr) {
        if (c === "\\") { i += 2; continue; }
        if (c === inStr) inStr = null;
        i++;
        continue;
      }
      if (c === '"' || c === "'") { inStr = c as '"' | "'"; i++; continue; }

      if (c === "{") depth++;
      else if (c === "}") {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && (c === ";" || c === "\n")) {
        break;
      }
      i++;
    }
    const text = body.slice(start, i).trim();
    if (!text) return null;
    return { text, endOffset: i };
  }

  private _lineAt(offset: number): number {
    return this._source.slice(0, offset).split("\n").length;
  }
}
