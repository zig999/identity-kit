import type { IAccessTokenSource } from './access-token-source.js';
export declare const DEFAULT_TOKEN_ENDPOINT_TIMEOUT_MS = 5000;
export interface IClientCredentialsOptions {
    readonly tokenEndpointUrl: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly audience?: string;
    readonly scope?: string;
    readonly timeoutMs?: number;
}
export declare const createClientCredentialsTokenSource: (options: IClientCredentialsOptions) => IAccessTokenSource;
