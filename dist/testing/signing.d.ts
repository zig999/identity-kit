import type { KeyObject } from 'node:crypto';
import type { KeySetKey } from '../key-set.js';
export type RsaAlgorithm = 'RS256' | 'RS384' | 'RS512';
export type EcAlgorithm = 'ES256' | 'ES384' | 'ES512';
export type SigningAlgorithm = RsaAlgorithm | EcAlgorithm;
export interface ISigningKey {
    readonly kid: string;
    readonly alg: SigningAlgorithm;
    readonly privateKey: KeyObject;
    readonly jwk: KeySetKey;
}
export type TokenClaims = Readonly<Record<string, unknown>>;
export declare const generateSigningKey: (kid: string, alg?: SigningAlgorithm) => ISigningKey;
export declare const signTokenWithHeader: (claims: TokenClaims, key: ISigningKey, header: Readonly<Record<string, unknown>>) => string;
export declare const signToken: (claims: TokenClaims, key: ISigningKey, kid?: string) => string;
export declare const unsignedToken: (claims: TokenClaims) => string;
export declare const hmacToken: (claims: TokenClaims, secret: string, kid?: string) => string;
export declare const tokenWithSegments: (header: unknown, payload: unknown, signature?: string) => string;
