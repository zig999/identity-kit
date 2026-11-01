import type { IKeySetSource } from './key-set.js';
export interface IJwksClientDeps {
    readonly issuer: string;
    readonly now: () => Date;
    readonly requestHeaders?: () => Readonly<Record<string, string>>;
}
export declare const createJwksClient: (deps: IJwksClientDeps) => IKeySetSource;
