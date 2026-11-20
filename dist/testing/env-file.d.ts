export type EnvSettings = Readonly<Record<string, string>>;
export declare const writeEnvSettings: (path: string, settings: EnvSettings) => Promise<void>;
