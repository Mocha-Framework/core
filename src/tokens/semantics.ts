export const semanticAliases = {
  primary: "mauve",
  secondary: "lavender",
  success: "green",
  warning: "yellow",
  danger: "red",
  info: "sky",
} as const;

export type SemanticAliasKey = keyof typeof semanticAliases;

export const shadowTokens = {
  sm: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
  md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
  lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
} as const;

export const transitionTokens = {
  timing: "cubic-bezier(0.4, 0, 0.2, 1)",
  duration: "0.2s",
} as const;
