import { afterEach, describe, expect, it } from 'vitest';

import { createAuthenticator } from '../../../src/authenticator.js';
import { defineClaimsSchema } from '../../../src/claims.js';
import { createJwksClient } from '../../../src/jwks-client.js';
import { KeySetLoadError } from '../../../src/key-set-load-error.js';
import { createTestIssuer } from '../../../src/testing/test-issuer.js';
import type { ITestIssuer } from '../../../src/testing/test-issuer.js';
import { createTokenVerifier } from '../../../src/token-verifier.js';
import type { RefusalReason } from '../../../src/token-verifier.js';
import { clockStartingAt, rejectionOf } from '../../support/issuer-stand-in.js';

const AUDIENCE = 'audience-of-this-module';
const START_MS = Date.UTC(2026, 0, 1, 12, 0, 0);
const THIRTY_SECONDS_MS = 30_000;
const opened: ITestIssuer[] = [];

const issuerOn = async (options: Parameters<typeof createTestIssuer>[0] = {}): Promise<ITestIssuer> => {
  const issuer = await createTestIssuer({ now: () => new Date(START_MS), ...options });
  opened.push(issuer);
  return issuer;
};

const verifierFor = (issuer: ITestIssuer, clock = clockStartingAt(START_MS)) => {
  const refusals: RefusalReason[] = [];
  const verifier = createTokenVerifier({
    keySet: createJwksClient({ issuer: issuer.url, now: clock.now }),
    issuer: issuer.url,
    claims: defineClaimsSchema({ resources: ['productOffering'] }),
    now: clock.now,
    onRefusal: (reason) => refusals.push(reason),
  });
  return { verifier, refusals, clock };
};

afterEach(async () => {
  await Promise.all(opened.splice(0).map((issuer) => issuer.close()));
});

describe('the documents the test issuer serves', () => {
  it('names itself and the address of its key set in the discovery document', async () => {
    const issuer = await issuerOn();

    const document = await (await fetch(`${issuer.url}/.well-known/openid-configuration`)).json();

    expect(document).toEqual({ issuer: issuer.url, jwks_uri: `${issuer.url}/keys` });
  });

  it('publishes the public part of its signing key and never the private part', async () => {
    const issuer = await issuerOn();

    const { keys } = (await (await fetch(`${issuer.url}/keys`)).json()) as { keys: Record<string, unknown>[] };

    expect(keys.map((key) => ({ kty: key['kty'], use: key['use'], hasPrivate: 'd' in key }))).toEqual([
      { kty: 'EC', use: 'sig', hasPrivate: false },
    ]);
  });

  it.each(['RS256', 'ES384'] as const)('publishes a key of the algorithm %s when asked for it', async (alg) => {
    const issuer = await issuerOn({ alg });

    const { keys } = (await (await fetch(`${issuer.url}/keys`)).json()) as { keys: { alg: string }[] };

    expect(keys.map((key) => key.alg)).toEqual([alg]);
  });

  it('records the paths that were requested', async () => {
    const issuer = await issuerOn();

    await fetch(`${issuer.url}/keys`);
    await fetch(`${issuer.url}/other`);

    expect(issuer.requests).toEqual(['/keys', '/other']);
  });

  it('answers 404 to any other path', async () => {
    const issuer = await issuerOn();

    expect((await fetch(`${issuer.url}/other`)).status).toBe(404);
  });
});

describe('the claims the test issuer proposes', () => {
  it('name the issuer, the audience, a subject and an expiry one hour after the clock it was given', async () => {
    const issuer = await issuerOn();

    expect(issuer.claims(AUDIENCE)).toEqual({
      iss: issuer.url,
      aud: AUDIENCE,
      sub: 'test-caller',
      exp: START_MS / 1000 + 3600,
    });
  });

  it('let the test override or add any claim', async () => {
    const issuer = await issuerOn({ lifetimeSeconds: 60 });

    expect(issuer.claims(AUDIENCE, { sub: 'someone', roles: ['auditor'], exp: 5 })).toMatchObject({
      sub: 'someone',
      roles: ['auditor'],
      exp: 5,
    });
  });
});

describe('a module that verifies tokens against the test issuer over the network', () => {
  it('accepts a token the issuer signed', async () => {
    const issuer = await issuerOn();
    const { verifier } = verifierFor(issuer);

    const claims = await verifier.verify(issuer.issue(issuer.claims(AUDIENCE, { roles: ['auditor'] })), AUDIENCE);

    expect(claims).toMatchObject({ iss: issuer.url, sub: 'test-caller', roles: ['auditor'] });
  });

  it('builds a caller from it through the authenticator', async () => {
    const issuer = await issuerOn();
    const { verifier } = verifierFor(issuer);
    const claims = issuer.claims(AUDIENCE, { accessRights: { productOffering: ['read'] } });

    const caller = await createAuthenticator(verifier).authenticate(`Bearer ${issuer.issue(claims)}`, AUDIENCE);

    expect(caller?.holds({ resource: 'productOffering', type: 'read' })).toBe(true);
  });

  it.each(['RS256', 'ES256', 'ES512'] as const)('accepts a token signed with %s', async (alg) => {
    const issuer = await issuerOn({ alg });
    const { verifier } = verifierFor(issuer);

    expect(await verifier.verify(issuer.issue(issuer.claims(AUDIENCE)), AUDIENCE)).toBeDefined();
  });

  it('refuses a token under the key id the issuer publishes that a foreign key signed', async () => {
    const issuer = await issuerOn();
    const { verifier, refusals } = verifierFor(issuer);

    const claims = await verifier.verify(issuer.issueForeign(issuer.claims(AUDIENCE)), AUDIENCE);

    expect({ claims, refusals }).toEqual({ claims: undefined, refusals: ['signature'] });
  });

  it('refuses a token that has expired by the clock of the module', async () => {
    const issuer = await issuerOn();
    const { verifier, refusals } = verifierFor(issuer);

    const claims = await verifier.verify(issuer.issue(issuer.claims(AUDIENCE, { exp: START_MS / 1000 - 1 })), AUDIENCE);

    expect({ claims, refusals }).toEqual({ claims: undefined, refusals: ['expired'] });
  });

  it('fetches the keys of the issuer once for any number of tokens within the cache lifetime', async () => {
    const issuer = await issuerOn();
    const { verifier } = verifierFor(issuer);
    const token = issuer.issue(issuer.claims(AUDIENCE));

    await verifier.verify(token, AUDIENCE);
    await verifier.verify(token, AUDIENCE);

    expect(issuer.requests).toEqual(['/.well-known/openid-configuration', '/keys']);
  });
});

describe('a key rotation at the test issuer', () => {
  it('lets a token signed with the new key verify once the module may refresh its keys', async () => {
    const issuer = await issuerOn();
    const { verifier, clock } = verifierFor(issuer);
    await verifier.verify(issuer.issue(issuer.claims(AUDIENCE)), AUDIENCE);
    issuer.rotateKey();
    const token = issuer.issue(issuer.claims(AUDIENCE));
    const beforeInterval = await verifier.verify(token, AUDIENCE);
    clock.moveTo(THIRTY_SECONDS_MS);

    const afterInterval = await verifier.verify(token, AUDIENCE);

    expect({ before: beforeInterval !== undefined, after: afterInterval !== undefined }).toEqual({
      before: false,
      after: true,
    });
  });

  it('keeps the tokens of the earlier key valid when the earlier key stays published', async () => {
    const issuer = await issuerOn();
    const earlier = issuer.issue(issuer.claims(AUDIENCE));
    issuer.rotateKey();
    const { verifier } = verifierFor(issuer);

    expect(await verifier.verify(earlier, AUDIENCE)).toBeDefined();
  });

  it('refuses the tokens of the earlier key once the earlier key is retired and the module has refreshed', async () => {
    const issuer = await issuerOn();
    const earlier = issuer.issue(issuer.claims(AUDIENCE));
    issuer.rotateKey({ retireCurrent: true });
    const { verifier } = verifierFor(issuer);

    expect(await verifier.verify(earlier, AUDIENCE)).toBeUndefined();
  });
});

describe('a test issuer that was closed', () => {
  it('makes the module fail to load its keys, which is not the refusal of a token', async () => {
    const issuer = await issuerOn();
    const { verifier } = verifierFor(issuer);
    const token = issuer.issue(issuer.claims(AUDIENCE));
    await issuer.close();

    expect(await rejectionOf(verifier.verify(token, AUDIENCE))).toBeInstanceOf(KeySetLoadError);
  });
});
