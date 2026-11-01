import type { ICaller } from './caller.js';
import { notImplemented } from './not-implemented.js';
import type { ITokenVerifier } from './token-verifier.js';

export interface IAuthenticator {
  authenticate(authorization: string | undefined, audience: string): Promise<ICaller | undefined>;
}

export const createAuthenticator = (_verifier: ITokenVerifier): IAuthenticator => notImplemented('createAuthenticator');
