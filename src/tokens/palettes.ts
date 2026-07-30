import { flavors } from "@catppuccin/palette";

export const colorKeys = [
  "rosewater", "flamingo", "pink", "mauve", "red", "maroon",
  "peach", "yellow", "green", "teal", "sky", "sapphire", "blue", "lavender",
  "text", "subtext1", "subtext0", "overlay2", "overlay1", "overlay0",
  "surface2", "surface1", "surface0", "base", "mantle", "crust",
] as const;

export type ColorKey = (typeof colorKeys)[number];

export type Palette = Record<ColorKey, string> & {
  contrastDark: string;
  contrastLight: string;
};

export type FlavorName = "latte" | "frappe" | "macchiato" | "mocha" | "vercel" | "vercel-light";

function buildPalette(flavorName: "latte" | "frappe" | "macchiato" | "mocha"): Palette {
  const colors = flavors[flavorName].colors;
  const palette: Record<string, string> = {};
  for (const key of colorKeys) {
    palette[key] = colors[key].hex;
  }
  palette.contrastDark = flavors.macchiato.colors.mantle.hex;
  palette.contrastLight = flavors.latte.colors.base.hex;
  return palette as Palette;
}

const vercel: Palette = {
  rosewater: "#a1a1a1",
  flamingo: "#a1a1a1",
  pink: "#a1a1a1",
  mauve: "#ffffff",
  red: "#ee0000",
  maroon: "#ee0000",
  peach: "#f5a623",
  yellow: "#f5a623",
  green: "#50e3c2",
  teal: "#50e3c2",
  sky: "#50e3c2",
  sapphire: "#777777",
  blue: "#444444",
  lavender: "#777777",
  text: "#ffffff",
  subtext1: "#a1a1a1",
  subtext0: "#888888",
  overlay2: "#777777",
  overlay1: "#666666",
  overlay0: "#555555",
  surface2: "#444444",
  surface1: "#333333",
  surface0: "#222222",
  base: "#000000",
  mantle: "#111111",
  crust: "#1a1a1a",
  contrastDark: "#000000",
  contrastLight: "#ffffff",
};

const vercelLight: Palette = {
  rosewater: "#666666",
  flamingo: "#666666",
  pink: "#666666",
  mauve: "#000000",
  red: "#ee0000",
  maroon: "#ee0000",
  peach: "#f5a623",
  yellow: "#f5a623",
  green: "#007a22",
  teal: "#007a22",
  sky: "#007a22",
  sapphire: "#555555",
  blue: "#999999",
  lavender: "#555555",
  text: "#000000",
  subtext1: "#666666",
  subtext0: "#888888",
  overlay2: "#555555",
  overlay1: "#666666",
  overlay0: "#888888",
  surface2: "#999999",
  surface1: "#cccccc",
  surface0: "#eaeaea",
  base: "#ffffff",
  mantle: "#fafafa",
  crust: "#f5f5f5",
  contrastDark: "#000000",
  contrastLight: "#ffffff",
};

export const palettes: Record<FlavorName, Palette> = {
  latte: buildPalette("latte"),
  frappe: buildPalette("frappe"),
  macchiato: buildPalette("macchiato"),
  mocha: buildPalette("mocha"),
  vercel,
  "vercel-light": vercelLight,
};

export const defaultFlavor: FlavorName = "mocha";
export const cssDefaultFlavor: FlavorName = "macchiato";
