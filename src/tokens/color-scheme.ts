import type { FlavorName, Palette } from "./palettes";
import { palettes } from "./palettes";

type HexColor = string;

export interface ColorSchemeColors {
  readonly primary: HexColor;
  readonly onPrimary: HexColor;
  readonly primaryContainer: HexColor;
  readonly onPrimaryContainer: HexColor;
  readonly secondary: HexColor;
  readonly onSecondary: HexColor;
  readonly secondaryContainer: HexColor;
  readonly onSecondaryContainer: HexColor;
  readonly tertiary: HexColor;
  readonly onTertiary: HexColor;
  readonly surface: HexColor;
  readonly onSurface: HexColor;
  readonly surfaceVariant: HexColor;
  readonly onSurfaceVariant: HexColor;
  readonly background: HexColor;
  readonly onBackground: HexColor;
  readonly error: HexColor;
  readonly onError: HexColor;
  readonly outline: HexColor;
  readonly outlineVariant: HexColor;
}

const BRAND_ERROR = "#dc2626";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return "#" + [clamp(r), clamp(g), clamp(b)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("");
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const nr = r / 255, ng = g / 255, nb = b / 255;
  const max = Math.max(nr, ng, nb), min = Math.min(nr, ng, nb);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === nr) h = ((ng - nb) / d + (ng < nb ? 6 : 0)) / 6;
    else if (max === ng) h = ((nb - nr) / d + 2) / 6;
    else h = ((nr - ng) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb(h: number, s: number, _l: number): { r: number; g: number; b: number } {
  const l = _l / 100;
  const ss = s / 100;
  const c = (1 - Math.abs(2 * l - 1)) * ss;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function hslToHex(h: number, s: number, l: number): string {
  const { r, g, b } = hslToRgb(((h % 360) + 360) % 360, s, l);
  return rgbToHex(r, g, b);
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const srgb = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function contrastText(bg: string, dark: string, light: string): string {
  return luminance(bg) > 0.5 ? dark : light;
}

function adjustLightness(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  return hslToHex(h, s, Math.max(0, Math.min(100, l + amount)));
}

function mixColors(hexA: string, hexB: string, ratio: number): string {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return rgbToHex(
    Math.round(a.r * (1 - ratio) + b.r * ratio),
    Math.round(a.g * (1 - ratio) + b.g * ratio),
    Math.round(a.b * (1 - ratio) + b.b * ratio),
  );
}

export class ColorScheme implements ColorSchemeColors {
  private readonly _colors: ColorSchemeColors;

  private constructor(colors: ColorSchemeColors) {
    this._colors = colors;
  }

  // ── Accessors ──

  get primary(): string { return this._colors.primary; }
  get onPrimary(): string { return this._colors.onPrimary; }
  get primaryContainer(): string { return this._colors.primaryContainer; }
  get onPrimaryContainer(): string { return this._colors.onPrimaryContainer; }
  get secondary(): string { return this._colors.secondary; }
  get onSecondary(): string { return this._colors.onSecondary; }
  get secondaryContainer(): string { return this._colors.secondaryContainer; }
  get onSecondaryContainer(): string { return this._colors.onSecondaryContainer; }
  get tertiary(): string { return this._colors.tertiary; }
  get onTertiary(): string { return this._colors.onTertiary; }
  get surface(): string { return this._colors.surface; }
  get onSurface(): string { return this._colors.onSurface; }
  get surfaceVariant(): string { return this._colors.surfaceVariant; }
  get onSurfaceVariant(): string { return this._colors.onSurfaceVariant; }
  get background(): string { return this._colors.background; }
  get onBackground(): string { return this._colors.onBackground; }
  get error(): string { return this._colors.error; }
  get onError(): string { return this._colors.onError; }
  get outline(): string { return this._colors.outline; }
  get outlineVariant(): string { return this._colors.outlineVariant; }

  // ── Fábricas ──

  static fromFlavor(name: FlavorName): ColorScheme {
    const p = palettes[name];
    const isDark = name !== "latte" && name !== "vercel-light";
    const primary = p.mauve;
    const bg = p.base;
    const onBg = p.text;
    const surf = p.surface0;
    const onSurf = p.text;
    const surfVar = p.surface1;
    const onSurfVar = p.subtext0;
    const outline = p.overlay0;
    const outlineVar = p.overlay1;

    return new ColorScheme({
      primary,
      onPrimary: isDark ? p.crust : p.base,
      primaryContainer: adjustLightness(primary, isDark ? -25 : 20),
      onPrimaryContainer: isDark ? bg : onBg,
      secondary: p.blue,
      onSecondary: isDark ? p.crust : p.base,
      secondaryContainer: adjustLightness(p.blue, isDark ? -25 : 20),
      onSecondaryContainer: isDark ? bg : onBg,
      tertiary: p.teal,
      onTertiary: isDark ? p.crust : p.base,
      surface: surf,
      onSurface: onSurf,
      surfaceVariant: surfVar,
      onSurfaceVariant: onSurfVar,
      background: bg,
      onBackground: onBg,
      error: p.red,
      onError: isDark ? p.crust : p.base,
      outline,
      outlineVariant: outlineVar,
    });
  }

  static brand(seed: HexColor): ColorScheme {
    return ColorScheme._generateFromSeed(seed, true);
  }

  static custom(colors: Partial<ColorSchemeColors> & { base?: FlavorName }): ColorScheme {
    const base = colors.base ?? "mocha";
    const scheme = ColorScheme.fromFlavor(base);
    return scheme.copyWith(colors);
  }

  // ── Derivação ──

  copyWith(overrides: Partial<ColorSchemeColors>): ColorScheme {
    return new ColorScheme({ ...this._colors, ...overrides });
  }

  // ── Material 3 fromSeed — algoritmo simplificado ──

  private static _generateFromSeed(seed: HexColor, isDark: boolean): ColorScheme {
    const { r, g, b } = hexToRgb(seed);
    const { h, s, l } = rgbToHsl(r, g, b);

    const primary = seed;
    const onPrimary = contrastText(primary, "#11111b", "#ffffff");

    // Primary container — tonal palette
    const pcH = h;
    const pcS = Math.min(s, 40);
    const pcL = isDark ? 18 : 88;
    const primaryContainer = hslToHex(pcH, pcS, pcL);
    const onPrimaryContainer = isDark ? hslToHex(h, s, 92) : hslToHex(h, Math.min(s, 60), 20);

    // Secondary — analogous (±30°)
    const secH = (h + 30) % 360;
    const secondaryVal = isDark ? 78 : 45;
    const secondary = hslToHex(secH, Math.min(s, 50), secondaryVal);
    const onSecondary = isDark ? "#11111b" : "#ffffff";

    const secContainer = hslToHex(secH, Math.min(s, 30), isDark ? 18 : 90);
    const onSecContainer = isDark ? hslToHex(secH, Math.min(s, 50), 90) : hslToHex(secH, Math.min(s, 60), 20);

    // Tertiary — split complement
    const terH = (h + 150) % 360;
    const tertiary = hslToHex(terH, Math.min(s, 45), isDark ? 80 : 45);
    const onTertiary = isDark ? "#11111b" : "#ffffff";

    // Surface tonal palette
    const baseHue = h;
    const baseSat = 8;
    const background = hslToHex(baseHue, baseSat, isDark ? 12 : 96);
    const onBackground = hslToHex(baseHue, 5, isDark ? 90 : 12);

    const surface = hslToHex(baseHue, baseSat + 2, isDark ? 18 : 94);
    const onSurface = onBackground;

    const surfaceVariant = hslToHex(baseHue, baseSat + 1, isDark ? 24 : 90);
    const onSurfaceVariant = hslToHex(baseHue, 4, isDark ? 78 : 30);

    // Outline — surface with opacity
    const outline = mixColors(onSurface, surface, 0.45);
    const outlineVariant = mixColors(onSurface, surface, 0.25);

    const error = BRAND_ERROR;
    const onError = "#ffffff";

    return new ColorScheme({
      primary, onPrimary, primaryContainer, onPrimaryContainer,
      secondary, onSecondary, secondaryContainer: secContainer, onSecondaryContainer: onSecContainer,
      tertiary, onTertiary,
      surface, onSurface, surfaceVariant, onSurfaceVariant,
      background, onBackground,
      error, onError,
      outline, outlineVariant,
    });
  }

  // ── Serialização ──

  toRecord(): Record<string, string> {
    return {
      primary: this.primary,
      onPrimary: this.onPrimary,
      primaryContainer: this.primaryContainer,
      onPrimaryContainer: this.onPrimaryContainer,
      secondary: this.secondary,
      onSecondary: this.onSecondary,
      secondaryContainer: this.secondaryContainer,
      onSecondaryContainer: this.onSecondaryContainer,
      tertiary: this.tertiary,
      onTertiary: this.onTertiary,
      surface: this.surface,
      onSurface: this.onSurface,
      surfaceVariant: this.surfaceVariant,
      onSurfaceVariant: this.onSurfaceVariant,
      background: this.background,
      onBackground: this.onBackground,
      error: this.error,
      onError: this.onError,
      outline: this.outline,
      outlineVariant: this.outlineVariant,
    };
  }

  toCSSVariables(): string {
    const entries = this.toRecord();
    return Object.entries(entries)
      .map(([key, value]) => `  --ctp-${key}: ${value};`)
      .join("\n");
  }
}
