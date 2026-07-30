export type QMLNodeClass<T extends QMLNode = QMLNode> = (new () => T) & {
  readonly stateProps?: readonly string[];
};

export function getQMLNodeStateProps(
  wrapperClass: QMLNodeClass | null | undefined
): readonly string[] {
  return wrapperClass?.stateProps ?? [];
}

export abstract class QMLNode {
  static readonly stateProps: readonly string[] = [];

  protected _nativeApp: any = null;
  protected _handle: number = 0;

  _attach(nativeApp: any, handle: number): void {
    this._nativeApp = nativeApp;
    this._handle = handle;
  }

  getProperty(name: string): string {
    const val = this._nativeApp.getQmlProperty(this._handle, name) ?? "";
    console.log(`[QMLNode] getProperty("${name}", handle=${this._handle}) = "${val}"`);
    return val;
  }

  setProperty(name: string, value: unknown): void {
    console.log(`[QMLNode] setProperty("${name}", handle=${this._handle}, value="${String(value)}")`);
    this._nativeApp.setQmlProperty(this._handle, name, value);
  }

  getIntProperty(name: string): number {
    return Number(this.getProperty(name));
  }

  getBoolProperty(name: string): boolean {
    return this.getProperty(name) === "true";
  }
}

export class QMLTextField extends QMLNode {
  static readonly stateProps = ["text"] as const;

  get text(): string { return this.getProperty("text"); }
  set text(v: string) { this.setProperty("text", v); }
}

export class QMLTextInput extends QMLNode {
  static readonly stateProps = ["text"] as const;

  get text(): string { return this.getProperty("text"); }
  set text(v: string) { this.setProperty("text", v); }
}

export class QMLButton extends QMLNode {
  static readonly stateProps = ["checked"] as const;

  get text(): string { return this.getProperty("text"); }
  set text(v: string) { this.setProperty("text", v); }

  get enabled(): boolean { return this.getBoolProperty("enabled"); }
  set enabled(v: boolean) { this.setProperty("enabled", v); }

  get checked(): boolean { return this.getBoolProperty("checked"); }
  set checked(v: boolean) { this.setProperty("checked", v); }
}

export class QMLCheckBox extends QMLNode {
  static readonly stateProps = ["checked"] as const;

  get checked(): boolean { return this.getBoolProperty("checked"); }
  set checked(v: boolean) { this.setProperty("checked", v); }
}

export class QMLSlider extends QMLNode {
  static readonly stateProps = ["value"] as const;

  get value(): number { return this.getIntProperty("value"); }
  set value(v: number) { this.setProperty("value", v); }
}

export class QMLProgressBar extends QMLNode {
  static readonly stateProps = ["value"] as const;

  get value(): number { return this.getIntProperty("value"); }
  set value(v: number) { this.setProperty("value", v); }
}

export class QMLTextArea extends QMLNode {
  static readonly stateProps = ["text"] as const;

  get text(): string { return this.getProperty("text"); }
  set text(v: string) { this.setProperty("text", v); }
}

export class QMLSwitch extends QMLNode {
  static readonly stateProps = ["checked"] as const;

  get checked(): boolean { return this.getBoolProperty("checked"); }
  set checked(v: boolean) { this.setProperty("checked", v); }
}

export class QMLSpinBox extends QMLNode {
  static readonly stateProps = ["value"] as const;

  get value(): number { return this.getIntProperty("value"); }
  set value(v: number) { this.setProperty("value", v); }
}

export class QMLComboBox extends QMLNode {
  static readonly stateProps = ["currentIndex"] as const;

  get currentIndex(): number { return this.getIntProperty("currentIndex"); }
  set currentIndex(v: number) { this.setProperty("currentIndex", v); }

  get currentText(): string { return this.getProperty("currentText"); }
}

export class QMLItem extends QMLNode {
  get x(): number { return this.getIntProperty("x"); }
  set x(v: number) { this.setProperty("x", v); }

  get y(): number { return this.getIntProperty("y"); }
  set y(v: number) { this.setProperty("y", v); }

  get width(): number { return this.getIntProperty("width"); }
  set width(v: number) { this.setProperty("width", v); }

  get height(): number { return this.getIntProperty("height"); }
  set height(v: number) { this.setProperty("height", v); }

  get visible(): boolean { return this.getBoolProperty("visible"); }
  set visible(v: boolean) { this.setProperty("visible", v); }

  get enabled(): boolean { return this.getBoolProperty("enabled"); }
  set enabled(v: boolean) { this.setProperty("enabled", v); }
}

export class QMLRectangle extends QMLItem {
  get color(): string { return this.getProperty("color"); }
  set color(v: string) { this.setProperty("color", v); }

  get radius(): number { return this.getIntProperty("radius"); }
  set radius(v: number) { this.setProperty("radius", v); }
}

export class QMLText extends QMLItem {
  get text(): string { return this.getProperty("text"); }
  set text(v: string) { this.setProperty("text", v); }

  get color(): string { return this.getProperty("color"); }
  set color(v: string) { this.setProperty("color", v); }
}

export class QMLListView extends QMLItem {
  static readonly stateProps = ["currentIndex"] as const;

  get currentIndex(): number { return this.getIntProperty("currentIndex"); }
  set currentIndex(v: number) { this.setProperty("currentIndex", v); }

  get count(): number { return this.getIntProperty("count"); }
}

export class QMLLoader extends QMLItem {
  static readonly stateProps = ["active"] as const;

  get active(): boolean { return this.getBoolProperty("active"); }
  set active(v: boolean) { this.setProperty("active", v); }

  get source(): string { return this.getProperty("source"); }
  set source(v: string) { this.setProperty("source", v); }
}
