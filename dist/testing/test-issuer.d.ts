import type { ISigningKey, SigningAlgorithm, TokenClaims } from './signing.js';
export interface ITestIssuerOptions {
    readonly alg?: SigningAlgorithm;
    readonly now?: () => Date;
    readonly lifetimeSeconds?: number;
    readonly host?: string;
    readonly port?: number;
    readonly publicUrl?: string;
    readonly issuanceRoute?: boolean;
}
export interface IRotationOptions {
    readonly retireCurrent?: boolean;
}
export interface ITestIssuer {
    readonly url: string;
    readonly requests: string[];
    claims(audience: string, extra?: TokenClaims): TokenClaims;
    issue(claims: TokenClaims): string;
    issueForeign(claims: TokenClaims): string;
    rotateKey(options?: IRotationOptions): ISigningKey;
    close(): Promise<void>;
}
export declare const createTestIssuer: (options?: ITestIssuerOptions) => Promise<ITestIssuer>;
