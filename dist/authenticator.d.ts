import type { ICaller } from './caller.js';
import type { ITokenVerifier } from './token-verifier.js';
export interface IAuthenticator {
    authenticate(authorization: string | undefined, audience: string): Promise<ICaller | undefined>;
}
export declare const createAuthenticator: (verifier: ITokenVerifier) => IAuthenticator;
