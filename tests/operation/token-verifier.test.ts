import { describe, expect, it, vi } from 'vitest';

import { defineClaimsSchema } from '../../src/claims.js';
import type { IKeySetSource, KeySetKey } from '../../src/key-set.js';
import { KeySetLoadError } from '../../src/key-set-load-error.js';
import { createTokenVerifier } from '../../src/token-verifier.js';
import type { RefusalReason } from '../../src/token-verifier.js';
import { rejectionOf } from '../support/issuer-stand-in.js';
import {
  generateSigningKey,
  hmacToken,
  signToken,
  signTokenWithHeader,
  tokenWithSegments,
  unsignedToken,
} from '../../src/testing/signing.js';
import type { ISigningKey, TokenClaims } from '../../src/testing/signing.js';

const ISSUER = 'https://issuer.example.test';
const AUDIENCE = 'audience-of-this-module';
const OTHER_AUDIENCE = 'audience-of-another-module';
const NOW = new Date('2026-01-01T00:00:00.000Z');
const NOW_SECONDS = NOW.getTime() / 1000;
const ONE_HOUR = 3600;

const ISSUER_KEY = generateSigningKey('issuer-key', 'RS256');
const FOREIGN_KEY = generateSigningKey('foreign-key', 'RS256');
const EC_KEY = generateSigningKey('ec-key', 'ES256');
const CLAIMS_SCHEMA = defineClaimsSchema({ resources: ['productOffering', 'hub'] });

const keySetOf = (...keys: readonly ISigningKey[]): IKeySetSource => ({ load: async () => keys.map((key) => key.jwk) });

const claims = (extra: TokenClaims = {}): TokenClaims => ({
  iss: ISSUER,
  aud: AUDIENCE,
  sub: 'caller-1',
  exp: NOW_SECONDS + ONE_HOUR,
  ...extra,
});

const verifierOver = (
  keySet: IKeySetSource,
  extra: { leewaySeconds?: number; onRefusal?: (reason: RefusalReason) => void } = {},
) => createTokenVerifier({ keySet, issuer: ISSUER, claims: CLAIMS_SCHEMA, now: () => NOW, ...extra });

const verifier = verifierOver(keySetOf(ISSUER_KEY, EC_KEY));

describe('a token that verifies', () => {
  it.each([
    { label: 'RS256', key: ISSUER_KEY },
    { label: 'ES256', key: EC_KEY },
    { label: 'RS512', key: generateSigningKey('rs512-key', 'RS512') },
    { label: 'ES384', key: generateSigningKey('es384-key', 'ES384') },
    { label: 'ES512', key: generateSigningKey('es512-key', 'ES512') },
  ])('yields its claims when it is signed with $label by a published key', async ({ key }) => {
    const answer = await verifierOver(keySetOf(key)).verify(signToken(claims({ roles: ['auditor'] }), key), AUDIENCE);

    expect(answer).toMatchObject({ iss: ISSUER, aud: AUDIENCE, sub: 'caller-1', roles: ['auditor'] });
  });

  it('yields the claims it carries that the module did not declare', async () => {
    const answer = await verifier.verify(signToken(claims({ tenant: 'north' }), ISSUER_KEY), AUDIENCE);

    expect(answer?.['tenant']).toBe('north');
  });

  it('yields its claims when the audience is a list that carries the audience asked', async () => {
    const answer = await verifier.verify(signToken(claims({ aud: [OTHER_AUDIENCE, AUDIENCE] }), ISSUER_KEY), AUDIENCE);

    expect(answer).toBeDefined();
  });

  it('yields its claims when it names no key id and a published key of its type verifies it', async () => {
    const token = signTokenWithHeader(claims(), ISSUER_KEY, { alg: 'RS256', typ: 'JWT' });

    const answer = await verifierOver(keySetOf(generateSigningKey('other', 'RS256'), ISSUER_KEY)).verify(
      token,
      AUDIENCE,
    );

    expect(answer).toBeDefined();
  });

  it('yields its claims when it expires one second after the instant of verification', async () => {
    const answer = await verifier.verify(signToken(claims({ exp: NOW_SECONDS + 1 }), ISSUER_KEY), AUDIENCE);

    expect(answer).toBeDefined();
  });

  it('yields its claims when it becomes valid at the instant of verification', async () => {
    const answer = await verifier.verify(signToken(claims({ nbf: NOW_SECONDS }), ISSUER_KEY), AUDIENCE);

    expect(answer).toBeDefined();
  });

  it('carries the accessRights and predefinedFilters of the module resources into the claims it yields', async () => {
    const token = signToken(
      claims({
        accessRights: { productOffering: ['read', 'discover'] },
        predefinedFilters: { productOffering: { lifecycleStatus: 'Active' } },
      }),
      ISSUER_KEY,
    );

    const answer = await verifier.verify(token, AUDIENCE);

    expect(answer).toMatchObject({
      accessRights: { productOffering: ['read', 'discover'] },
      predefinedFilters: { productOffering: { lifecycleStatus: 'Active' } },
    });
  });
});

describe('a token whose signature does not hold', () => {
  it.each([
    { label: 'a key the issuer does not publish, under a key id the issuer publishes', kid: ISSUER_KEY.kid },
    { label: 'a key the issuer does not publish, under a key id the issuer does not publish', kid: 'unknown-key-id' },
  ])('is refused when it is signed with $label', async ({ kid }) => {
    const answer = await verifier.verify(signToken(claims(), FOREIGN_KEY, kid), AUDIENCE);

    expect(answer).toBeUndefined();
  });

  it('is refused when its payload was changed after signing', async () => {
    const [header = '', , signature = ''] = signToken(claims(), ISSUER_KEY).split('.');
    const forged = tokenWithSegments(
      JSON.parse(Buffer.from(header, 'base64url').toString()),
      claims({ sub: 'someone-else' }),
      signature,
    );

    const answer = await verifier.verify(forged, AUDIENCE);

    expect(answer).toBeUndefined();
  });

  it('is refused when it declares an algorithm the published key does not serve', async () => {
    const answer = await verifierOver(keySetOf(EC_KEY)).verify(
      tokenWithSegments({ alg: 'RS256', typ: 'JWT', kid: EC_KEY.kid }, claims()),
      AUDIENCE,
    );

    expect(answer).toBeUndefined();
  });
});

describe('a token that declares an algorithm the module never accepts', () => {
  it.each(['none', 'None', 'HS256', 'HS384', 'HS512', 'PS256', 'EdDSA', 'RS1', ''])(
    'is refused for the algorithm %j',
    async (alg) => {
      const answer = await verifier.verify(
        tokenWithSegments({ alg, typ: 'JWT', kid: ISSUER_KEY.kid }, claims()),
        AUDIENCE,
      );

      expect(answer).toBeUndefined();
    },
  );

  it('is refused when it names an accepted algorithm in another letter case, though the signature holds', async () => {
    const token = signTokenWithHeader(claims(), ISSUER_KEY, { alg: 'rs256', typ: 'JWT', kid: ISSUER_KEY.kid });

    const { alg: _declared, ...jwkWithoutAlg } = ISSUER_KEY.jwk;

    const answer = await verifierOver({ load: async () => [jwkWithoutAlg] }).verify(token, AUDIENCE);

    expect(answer).toBeUndefined();
  });

  it('is refused when it carries no signature and declares no algorithm', async () => {
    expect(await verifier.verify(unsignedToken(claims()), AUDIENCE)).toBeUndefined();
  });

  it('is refused when it is signed with HMAC using the published public key as the secret', async () => {
    const publicKeyText = JSON.stringify(ISSUER_KEY.jwk);

    const answer = await verifier.verify(hmacToken(claims(), publicKeyText, ISSUER_KEY.kid), AUDIENCE);

    expect(answer).toBeUndefined();
  });
});

describe('a text that is not a well-formed token', () => {
  it.each([
    { label: 'is empty', token: '' },
    { label: 'has two segments', token: 'aaa.bbb' },
    { label: 'has four segments', token: 'aaa.bbb.ccc.ddd' },
    { label: 'has a header that is not base64url JSON', token: `@@@.${Buffer.from('{}').toString('base64url')}.c2ln` },
    {
      label: 'has a payload that is not JSON',
      token: `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.bm90LWpzb24.c2ln`,
    },
    {
      label: 'has a payload that is a JSON array',
      token: tokenWithSegments({ alg: 'RS256', kid: ISSUER_KEY.kid }, []),
    },
    { label: 'has a payload that is JSON null', token: tokenWithSegments({ alg: 'RS256', kid: ISSUER_KEY.kid }, null) },
  ])('is refused when it $label', async ({ token }) => {
    expect(await verifier.verify(token, AUDIENCE)).toBeUndefined();
  });
});

describe('a token whose claims do not take the stated form', () => {
  it.each([
    { label: 'no issuer', claims: { iss: undefined } },
    { label: 'no audience', claims: { aud: undefined } },
    { label: 'no expiry', claims: { exp: undefined } },
    { label: 'an expiry that is a string', claims: { exp: String(NOW_SECONDS + ONE_HOUR) } },
    { label: 'an audience that is a number', claims: { aud: 7 } },
    { label: 'an audience list holding a non-string', claims: { aud: [AUDIENCE, 1] } },
    { label: 'an accessRights claim that is a string', claims: { accessRights: 'read' } },
    {
      label: 'an accessRights claim naming a resource the module does not declare',
      claims: { accessRights: { quote: ['read'] } },
    },
    {
      label: 'an accessRights claim naming an operation outside the five',
      claims: { accessRights: { productOffering: ['list'] } },
    },
    {
      label: 'a predefinedFilters claim with a value that is not a string',
      claims: { predefinedFilters: { productOffering: { rank: 3 } } },
    },
    { label: 'a roles claim that is a string', claims: { roles: 'catalog-administrator' } },
    { label: 'a roles claim holding a non-string', claims: { roles: ['auditor', 1] } },
  ])('is refused when it carries $label', async ({ claims: extra }) => {
    const answer = await verifier.verify(signToken(claims(extra), ISSUER_KEY), AUDIENCE);

    expect(answer).toBeUndefined();
  });
});

describe('the issuer of a token', () => {
  it.each([
    { label: 'another issuer', iss: 'https://other-issuer.example.test' },
    { label: 'the configured issuer with a trailing slash', iss: `${ISSUER}/` },
    { label: 'the configured issuer in another letter case', iss: ISSUER.toUpperCase() },
  ])('is refused when it names $label', async ({ iss }) => {
    expect(await verifier.verify(signToken(claims({ iss }), ISSUER_KEY), AUDIENCE)).toBeUndefined();
  });
});

describe('the audience of a token', () => {
  it.each([
    { label: 'is the audience of another module', aud: OTHER_AUDIENCE },
    { label: 'is a list that does not carry the audience asked', aud: [OTHER_AUDIENCE, 'unrelated'] },
    { label: 'is an empty list', aud: [] },
    { label: 'differs from the audience asked only by letter case', aud: AUDIENCE.toUpperCase() },
  ])('is refused when it $label', async ({ aud }) => {
    expect(await verifier.verify(signToken(claims({ aud }), ISSUER_KEY), AUDIENCE)).toBeUndefined();
  });

  it('is judged against the audience asked in each verification', async () => {
    const token = signToken(claims({ aud: OTHER_AUDIENCE }), ISSUER_KEY);

    const answers = [await verifier.verify(token, AUDIENCE), await verifier.verify(token, OTHER_AUDIENCE)];

    expect(answers.map((answer) => answer !== undefined)).toEqual([false, true]);
  });
});

describe('the validity period of a token', () => {
  it.each([
    { label: 'expired one second ago', extra: { exp: NOW_SECONDS - 1 } },
    { label: 'expiring at the instant of verification', extra: { exp: NOW_SECONDS } },
    { label: 'not valid before one second from now', extra: { nbf: NOW_SECONDS + 1 } },
  ])('is refused when it is $label', async ({ extra }) => {
    expect(await verifier.verify(signToken(claims(extra), ISSUER_KEY), AUDIENCE)).toBeUndefined();
  });

  it.each([
    { label: 'expired 10 seconds ago', extra: { exp: NOW_SECONDS - 10 } },
    { label: 'not valid before 10 seconds from now', extra: { nbf: NOW_SECONDS + 10 } },
  ])('is accepted within a leeway of 30 seconds when it is $label', async ({ extra }) => {
    const lenient = verifierOver(keySetOf(ISSUER_KEY), { leewaySeconds: 30 });

    expect(await lenient.verify(signToken(claims(extra), ISSUER_KEY), AUDIENCE)).toBeDefined();
  });

  it('is refused beyond the leeway', async () => {
    const lenient = verifierOver(keySetOf(ISSUER_KEY), { leewaySeconds: 30 });

    expect(await lenient.verify(signToken(claims({ exp: NOW_SECONDS - 31 }), ISSUER_KEY), AUDIENCE)).toBeUndefined();
  });

  it('is judged by the clock the module supplies', async () => {
    const later = createTokenVerifier({
      keySet: keySetOf(ISSUER_KEY),
      issuer: ISSUER,
      claims: CLAIMS_SCHEMA,
      now: () => new Date((NOW_SECONDS + 2 * ONE_HOUR) * 1000),
    });

    expect(await later.verify(signToken(claims(), ISSUER_KEY), AUDIENCE)).toBeUndefined();
  });
});

describe('the key set the verifier reads', () => {
  it('asks the key set again, refreshing, when no cached key fits the token, and accepts a key that was just published', async () => {
    const rotated = generateSigningKey('rotated-key', 'RS256');
    const load = vi.fn(async ({ refresh }: { refresh: boolean }): Promise<readonly KeySetKey[]> => [
      ...(refresh ? [rotated.jwk] : []),
      ISSUER_KEY.jwk,
    ]);

    const answer = await verifierOver({ load }).verify(signToken(claims(), rotated), AUDIENCE);

    expect({ accepted: answer !== undefined, calls: load.mock.calls.map(([options]) => options.refresh) }).toEqual({
      accepted: true,
      calls: [false, true],
    });
  });

  it('does not ask for a refresh when a cached key fits and the signature does not hold', async () => {
    const load = vi.fn(async (): Promise<readonly KeySetKey[]> => [ISSUER_KEY.jwk]);

    await verifierOver({ load }).verify(signToken(claims(), FOREIGN_KEY, ISSUER_KEY.kid), AUDIENCE);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('rejects with the key set load failure, rather than refusing the token, when the key set cannot be loaded', async () => {
    const failing: IKeySetSource = {
      load: async () => {
        throw new KeySetLoadError('The key set could not be loaded.', { operation: 'load-key-set' }, undefined);
      },
    };

    const failure = await rejectionOf(verifierOver(failing).verify(signToken(claims(), ISSUER_KEY), AUDIENCE));

    expect(failure).toBeInstanceOf(KeySetLoadError);
  });

  it('ignores a published key meant for encryption', async () => {
    const encryptionOnly: KeySetKey = { ...ISSUER_KEY.jwk, use: 'enc' };

    const answer = await verifierOver({ load: async () => [encryptionOnly] }).verify(
      signToken(claims(), ISSUER_KEY),
      AUDIENCE,
    );

    expect(answer).toBeUndefined();
  });
});

describe('the reason the verifier reports for a refusal', () => {
  const REASONS: readonly { reason: RefusalReason; token: () => string }[] = [
    { reason: 'malformed', token: () => 'not-a-token' },
    { reason: 'algorithm', token: () => unsignedToken(claims()) },
    { reason: 'claims', token: () => signToken(claims({ roles: 'x' }), ISSUER_KEY) },
    { reason: 'issuer', token: () => signToken(claims({ iss: 'https://other.example.test' }), ISSUER_KEY) },
    { reason: 'audience', token: () => signToken(claims({ aud: OTHER_AUDIENCE }), ISSUER_KEY) },
    { reason: 'expired', token: () => signToken(claims({ exp: NOW_SECONDS - 1 }), ISSUER_KEY) },
    { reason: 'not-yet-valid', token: () => signToken(claims({ nbf: NOW_SECONDS + 60 }), ISSUER_KEY) },
    { reason: 'signature', token: () => signToken(claims(), FOREIGN_KEY, ISSUER_KEY.kid) },
  ];

  it.each(REASONS)('is $reason', async ({ reason, token }) => {
    const reported: RefusalReason[] = [];
    const reporting = verifierOver(keySetOf(ISSUER_KEY), { onRefusal: (given) => reported.push(given) });

    const answer = await reporting.verify(token(), AUDIENCE);

    expect({ answer, reported }).toEqual({ answer: undefined, reported: [reason] });
  });

  it('is handed over alone, so the token never reaches the callback', async () => {
    const onRefusal = vi.fn();
    const token = signToken(claims({ exp: NOW_SECONDS - 1 }), ISSUER_KEY);

    await verifierOver(keySetOf(ISSUER_KEY), { onRefusal }).verify(token, AUDIENCE);

    expect(onRefusal.mock.calls).toEqual([['expired']]);
  });

  it('is not reported for a token that verifies', async () => {
    const onRefusal = vi.fn();

    await verifierOver(keySetOf(ISSUER_KEY), { onRefusal }).verify(signToken(claims(), ISSUER_KEY), AUDIENCE);

    expect(onRefusal).not.toHaveBeenCalled();
  });
});
