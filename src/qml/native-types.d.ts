declare module "@mocha-framework/bridge-napi" {
  export class NativeApp {
    init(): void;
    loadQML(qml: string, basePath?: string): void;
    reloadQML(qml: string, basePath?: string): number;
    setProperty(property: string, value: unknown): void;
    getProperty(property: string): string;
    createProxy(): number;
    proxySetValue(proxyId: number, name: string, value: unknown): void;
    proxyGetValue(proxyId: number, name: string): string;
    proxyHasPendingCalls(proxyId: number): boolean;
    proxyDrainPendingCalls(proxyId: number): string[];
    setContextProperty(name: string, proxyId: number): void;
    findChild(name: string): number;
    getRootObject(): number;
    setDarkTitleBar(dark: boolean): void;
    startSystemMove(objId: number): void;
    processEvents(): void;
    registerAppObjects(): void;
    listRootObjects(): any[];
    listChildren(objId: number): any[];
    getQmlProperty(objId: number, name: string): string;
    getQmlProperties(objId: number): any[];
    setQmlProperty(objId: number, name: string, value: string): void;
    exec(): number;
    quit(): void;
  }

  export function createNativeApp(): Promise<NativeApp>;
  export function getNativeApp(): NativeApp | null;
}
