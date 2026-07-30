export const geometry = {
  radiusSm: 6,
  radiusMd: 12,
  radiusLg: 18,
  radiusPill: 9999,

  borderSm: 1,
  borderMd: 2,
} as const;

export type GeometryKey = keyof typeof geometry;
