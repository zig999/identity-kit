import { describe, expect, it, vi } from 'vitest';

import { createAuthenticator } from '../../src/authenticator.js';
import type { IClaims } from '../../src/claims.js';
import type { ITokenVerifier } from '../../src/token-verifier.js';

const CLAIMS: IClaims = {
  iss: 'https://issuer.example.test',
  aud: 'this-module',
  exp: 1_800_000_000,
  sub: 'caller-1',
  roles: ['auditor'],
  accessRights: { productOffering: ['read'] },
};
const TOKEN = 'aaa.bbb.ccc';

const verifierAnswering = (answer: IClaims | undefined) => {
  const verify = vi.fn(async (_token: string, _audience: string): Promise<IClaims | undefined> => answer);
  const verifier: ITokenVerifier = { verify };
  return { verifier, verify };
};

describe('the authentication of a request', () => {
  it('yields the caller built from the claims the verifier yields', async () => {
    const { verifier } = verifierAnswering(CLAIMS);

    const caller = await createAuthenticator(verifier).authenticate(`Bearer ${TOKEN}`, 'this-module');

    expect(caller).toMatchObject({ subject: 'caller-1', roles: ['auditor'], claims: CLAIMS });
  });

  it('hands the verifier the token and the audience asked, and nothing else', async () => {
    const { verifier, verify } = verifierAnswering(CLAIMS);

    await createAuthenticator(verifier).authenticate(`Bearer ${TOKEN}`, 'this-module');

    expect(verify.mock.calls).toEqual([[TOKEN, 'this-module']]);
  });

  it('yields no caller when the verifier refuses the token', async () => {
    const { verifier } = verifierAnswering(undefined);

    expect(await createAuthenticator(verifier).authenticate(`Bearer ${TOKEN}`, 'this-module')).toBeUndefined();
  });

  it.each([
    { label: 'is absent', header: undefined },
    { label: 'names another scheme', header: `Basic ${TOKEN}` },
    { label: 'carries an empty token', header: 'Bearer ' },
  ])('yields no caller, and asks the verifier nothing, when the Authorization header $label', async ({ header }) => {
    const { verifier, verify } = verifierAnswering(CLAIMS);

    const caller = await createAuthenticator(verifier).authenticate(header, 'this-module');

    expect({ caller, asked: verify.mock.calls.length }).toEqual({ caller: undefined, asked: 0 });
  });

  it('lets the failure of the verifier reach the module instead of turning it into a refusal', async () => {
    const failure = new Error('the key set could not be loaded');
    const verifier: ITokenVerifier = {
      verify: async () => {
        throw failure;
      },
    };

    await expect(createAuthenticator(verifier).authenticate(`Bearer ${TOKEN}`, 'this-module')).rejects.toBe(failure);
  });
});
