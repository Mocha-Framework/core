export interface IconsConfig {
  svg?: string;
  png_192?: string;
  png_512?: string;
  ico?: string;
  icns?: string;
}

export interface PlatformMetaWeb {
  ogType?: string;
  ogImage?: string;
  display?: "standalone" | "fullscreen" | "minimal-ui" | "browser";
  orientation?: "portrait" | "landscape" | "any";
}

export interface PlatformMetaLinux {
  categories?: string[];
  terminal?: boolean;
  mimeType?: string;
}

export interface PlatformMetaWindows {
  appId?: string;
}

export interface PlatformMetaMac {
  bundleId?: string;
}

export interface PlatformMetaMobile {
  capability?: "push" | "payments";
  statusBarStyle?: "default" | "black" | "black-translucent";
}

export interface AppMetaConfig {
  name: string;
  shortName?: string;
  description: string;
  color?: string;
  icons?: IconsConfig;
  platforms?: {
    web?: PlatformMetaWeb;
    linux?: PlatformMetaLinux;
    windows?: PlatformMetaWindows;
    mac?: PlatformMetaMac;
    mobile?: PlatformMetaMobile;
  };
}

export interface PageMetaConfig {
  title?: string;
  description?: string;
  icons?: Partial<IconsConfig>;
  web?: Partial<PlatformMetaWeb>;
}

const appMetaRegistry = new Map<Function, AppMetaConfig>();
const pageMetaRegistry = new Map<Function, PageMetaConfig>();

export function registerAppMeta(cls: Function, config: AppMetaConfig): void {
  appMetaRegistry.set(cls, config);
}

export function registerPageMeta(cls: Function, config: PageMetaConfig): void {
  pageMetaRegistry.set(cls, config);
}

export function getAppMeta(): AppMetaConfig | null {
  for (const config of appMetaRegistry.values()) return config;
  return null;
}

export function getAllPageMetas(): Map<Function, PageMetaConfig> {
  return new Map(pageMetaRegistry);
}
