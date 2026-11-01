import { bearerTokenOf } from './bearer.js';
import { createCaller } from './caller.js';
import type { ICaller } from './caller.js';
import type { ITokenVerifier } from './token-verifier.js';

export interface IAuthenticator {
  authenticate(authorization: string | undefined, audience: string): Promise<ICaller | undefined>;
}

export const createAuthenticator = (verifier: ITokenVerifier): IAuthenticator => ({
  async authenticate(authorization: string | undefined, audience: string): Promise<ICaller | undefined> {
    const token = bearerTokenOf(authorization);
    if (token === undefined) return undefined;
    const claims = await verifier.verify(token, audience);
    return claims === undefined ? undefined : createCaller(claims);
  },
});
