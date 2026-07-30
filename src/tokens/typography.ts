export const typography = {
  family: "Outfit",
  familyMedium: "Outfit Medium",
  familyBold: "Outfit Bold",
  familyMono: "Geist Mono",
  familyDisplay: "Geist",

  sizeXs: 10,
  sizeSm: 12,
  sizeMd: 14,
  sizeLg: 16,
  sizeXl: 20,
  sizeH2: 24,
  sizeH1: 32,
} as const;

export type TypographySizeKey = keyof typeof typography;
