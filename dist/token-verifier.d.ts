import { z } from 'zod';
import type { IClaims } from './claims.js';
import type { IKeySetSource } from './key-set.js';
export type RefusalReason = 'malformed' | 'algorithm' | 'claims' | 'issuer' | 'audience' | 'expired' | 'not-yet-valid' | 'signature';
export interface ITokenVerifierDeps {
    readonly keySet: IKeySetSource;
    readonly issuer: string;
    readonly claims: z.ZodType<IClaims>;
    readonly now: () => Date;
    readonly leewaySeconds?: number;
    readonly onRefusal?: (reason: RefusalReason) => void;
}
export interface ITokenVerifier {
    verify(token: string, audience: string): Promise<IClaims | undefined>;
}
export declare const createTokenVerifier: (deps: ITokenVerifierDeps) => ITokenVerifier;
