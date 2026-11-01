import { afterEach, describe, expect, it } from 'vitest';

import { createJwksClient } from '../../src/jwks-client.js';
import { KeySetLoadError } from '../../src/key-set-load-error.js';
import {
  FIRST_LOAD_AT_MS,
  ISSUER,
  JWKS_URI,
  KEY_A,
  clockStartingAt,
  failingRequest,
  rejectionOf,
  standInForIssuer,
  unstubFetch,
} from '../support/issuer-stand-in.js';

const TEN_MINUTES_MS = 600_000;
const MALFORMED_WITHOUT_TYPE = { kid: 'broken-a', use: 'sig', alg: 'RS256', n: 'modulus-x', e: 'AQAB' };
const MALFORMED_WITH_NUMERIC_TYPE = { kty: 7, kid: 'broken-b' };

const clientOn = (clock = clockStartingAt(FIRST_LOAD_AT_MS)): ReturnType<typeof createJwksClient> =>
  createJwksClient({ issuer: ISSUER, now: clock.now });

const isLoadFailure = (error: unknown): boolean => error instanceof KeySetLoadError;

afterEach(unstubFetch);

describe('a load whose key set cannot be fetched', () => {
  it.each([
    { label: 'the discovery request fails', responder: failingRequest },
    { label: 'the discovery request answers 503', responder: () => new Response(null, { status: 503 }) },
    { label: 'the discovery document has no jwks_uri', responder: () => Response.json({ issuer: ISSUER }) },
    { label: 'the discovery document is not JSON', responder: () => new Response('not json') },
  ])('rejects with the key set load failure when $label', async ({ responder }) => {
    const issuer = standInForIssuer();
    issuer.answerDiscoveryWith(responder);

    const failure = await rejectionOf(clientOn().load({ refresh: false }));

    expect(isLoadFailure(failure)).toBe(true);
  });

  it.each([
    { label: 'the request fails', responder: failingRequest },
    { label: 'the request answers 500', responder: () => new Response(null, { status: 500 }) },
    { label: 'the answer is a JSON document with no keys member', responder: () => Response.json({ issuer: ISSUER }) },
    { label: 'the answer is not JSON', responder: () => new Response('not a key set') },
  ])('rejects with the key set load failure when the jwks_uri $label', async ({ responder }) => {
    const issuer = standInForIssuer();
    issuer.answerKeySetWith(responder);

    const failure = await rejectionOf(clientOn().load({ refresh: false }));

    expect(isLoadFailure(failure)).toBe(true);
  });

  it('names the failure KeySetLoadError and gives the same message whatever step failed', async () => {
    const atDiscovery = standInForIssuer();
    atDiscovery.answerDiscoveryWith(failingRequest);
    const discoveryFailure = await rejectionOf(clientOn().load({ refresh: false }));
    const atKeys = standInForIssuer();
    atKeys.answerKeySetWith(failingRequest);
    const keysFailure = await rejectionOf(clientOn().load({ refresh: false }));

    const summaries = [discoveryFailure, keysFailure].map((error) =>
      error instanceof Error ? { name: error.name, message: error.message } : undefined,
    );

    expect(summaries[0]).toEqual({ name: 'KeySetLoadError', message: summaries[0]?.message });
    expect(summaries[1]).toEqual(summaries[0]);
  });

  it('keeps the cause of the failure out of its message', async () => {
    const issuer = standInForIssuer();
    issuer.answerDiscoveryWith(() => {
      throw new TypeError('secret-detail-from-the-network-stack');
    });

    const failure = await rejectionOf(clientOn().load({ refresh: false }));

    expect(failure instanceof Error && failure.message.includes('secret-detail')).toBe(false);
  });
});

describe('a load whose fetched set holds no well-formed key', () => {
  it.each([
    { label: 'an empty keys array', keys: [] },
    { label: 'only malformed keys', keys: [MALFORMED_WITHOUT_TYPE, MALFORMED_WITH_NUMERIC_TYPE] },
  ])('rejects with the key set load failure for $label', async ({ keys }) => {
    const issuer = standInForIssuer();
    issuer.serve(keys);

    const failure = await rejectionOf(clientOn().load({ refresh: false }));

    expect(isLoadFailure(failure)).toBe(true);
  });

  it('requests the issuer again for the load that follows such a load', async () => {
    const issuer = standInForIssuer();
    issuer.serve([MALFORMED_WITHOUT_TYPE]);
    const client = clientOn();
    await rejectionOf(client.load({ refresh: false }));
    issuer.serve([KEY_A]);

    const keys = await client.load({ refresh: false });

    expect(keys).toEqual([KEY_A]);
  });

  it('resolves with the well-formed key and without the malformed one when the set holds both', async () => {
    const issuer = standInForIssuer();
    issuer.serve([MALFORMED_WITHOUT_TYPE, KEY_A, MALFORMED_WITH_NUMERIC_TYPE]);

    const keys = await clientOn().load({ refresh: false });

    expect(keys).toEqual([KEY_A]);
  });
});

describe('a load made after the held key set has outlived its lifetime', () => {
  it.each([{ refresh: true }, { refresh: false }])(
    'rejects with the key set load failure, serving no stale keys, when the fetch fails (refresh $refresh)',
    async ({ refresh }) => {
      const issuer = standInForIssuer();
      issuer.serve([KEY_A]);
      const clock = clockStartingAt(FIRST_LOAD_AT_MS);
      const client = clientOn(clock);
      await client.load({ refresh: false });
      issuer.answerKeySetWith(failingRequest);
      clock.moveTo(TEN_MINUTES_MS + 1);

      const failure = await rejectionOf(client.load({ refresh }));

      expect(isLoadFailure(failure)).toBe(true);
    },
  );

  it('fetches from the jwks_uri the issuer published, not from a remembered address, on the next load', async () => {
    const issuer = standInForIssuer();
    issuer.serve([KEY_A]);
    const clock = clockStartingAt(FIRST_LOAD_AT_MS);
    const client = clientOn(clock);
    await client.load({ refresh: false });
    clock.moveTo(TEN_MINUTES_MS);

    await client.load({ refresh: false });

    expect(issuer.countOf(JWKS_URI)).toBe(2);
  });
});
