import { afterEach, describe, expect, it } from 'vitest';

import { createJwksClient } from '../../src/jwks-client.js';
import type { IKeySetSource } from '../../src/key-set.js';
import {
  DISCOVERY_URL,
  FIRST_LOAD_AT_MS,
  ISSUER,
  JWKS_URI,
  KEY_A,
  KEY_B,
  clockStartingAt,
  standInForIssuer,
  unstubFetch,
} from '../support/issuer-stand-in.js';
import type { IIssuerStandIn, IMovableClock } from '../support/issuer-stand-in.js';

const SECOND_MS = 1_000;
const TEN_MINUTES_MS = 600_000;
const THIRTY_SECONDS_MS = 30 * SECOND_MS;
const JUST_BEFORE = (limitMs: number): number => limitMs - 1;

interface ILoadedClient {
  readonly client: IKeySetSource;
  readonly issuer: IIssuerStandIn;
  readonly clock: IMovableClock;
}

const loadedOnceWith = async (first: readonly object[], then: readonly object[]): Promise<ILoadedClient> => {
  const issuer = standInForIssuer();
  const clock = clockStartingAt(FIRST_LOAD_AT_MS);
  issuer.serve(first);
  const client = createJwksClient({ issuer: ISSUER, now: clock.now });
  await client.load({ refresh: false });
  issuer.serve(then);
  issuer.requests.length = 0;
  return { client, issuer, clock };
};

const kidsOf = (keys: readonly { kid?: string | undefined }[]): (string | undefined)[] => keys.map((key) => key.kid);

afterEach(unstubFetch);

describe('the lifetime of a loaded key set', () => {
  it('serves the earlier keys, with no request to the issuer, just under 10 minutes after the load', async () => {
    const { client, issuer, clock } = await loadedOnceWith([KEY_A], [KEY_B]);
    clock.moveTo(JUST_BEFORE(TEN_MINUTES_MS));

    const keys = await client.load({ refresh: false });

    expect({ kids: kidsOf(keys), requests: issuer.requests.length }).toEqual({ kids: ['key-a'], requests: 0 });
  });

  it('fetches the key set again 10 minutes after the load and serves what the issuer now publishes', async () => {
    const { client, issuer, clock } = await loadedOnceWith([KEY_A], [KEY_B]);
    clock.moveTo(TEN_MINUTES_MS);

    const keys = await client.load({ refresh: false });

    expect({ kids: kidsOf(keys), jwksRequests: issuer.countOf(JWKS_URI) }).toEqual({
      kids: ['key-b'],
      jwksRequests: 1,
    });
  });

  it('counts the 10 minutes from each load and never from a use of the set', async () => {
    const { client, issuer, clock } = await loadedOnceWith([KEY_A], [KEY_B]);
    const offsets = [
      5 * 60_000,
      JUST_BEFORE(TEN_MINUTES_MS),
      TEN_MINUTES_MS,
      10 * 60_000 + JUST_BEFORE(TEN_MINUTES_MS),
      2 * TEN_MINUTES_MS,
    ];
    const observed: { kids: (string | undefined)[]; jwksRequests: number }[] = [];
    for (const offset of offsets) {
      clock.moveTo(offset);
      const keys = await client.load({ refresh: false });
      observed.push({ kids: kidsOf(keys), jwksRequests: issuer.countOf(JWKS_URI) });
    }

    expect(observed).toEqual([
      { kids: ['key-a'], jwksRequests: 0 },
      { kids: ['key-a'], jwksRequests: 0 },
      { kids: ['key-b'], jwksRequests: 1 },
      { kids: ['key-b'], jwksRequests: 1 },
      { kids: ['key-b'], jwksRequests: 2 },
    ]);
  });
});

describe('the minimum interval between two fetches of the key set', () => {
  it('serves the earlier keys, with no request to the issuer, for a refreshing load just under 30 seconds after the load', async () => {
    const { client, issuer, clock } = await loadedOnceWith([KEY_A], [KEY_A, KEY_B]);
    clock.moveTo(JUST_BEFORE(THIRTY_SECONDS_MS));

    const keys = await client.load({ refresh: true });

    expect({ kids: kidsOf(keys), requests: issuer.requests.length }).toEqual({ kids: ['key-a'], requests: 0 });
  });

  it('fetches the key set again for a refreshing load 30 seconds after the load', async () => {
    const { client, issuer, clock } = await loadedOnceWith([KEY_A], [KEY_A, KEY_B]);
    clock.moveTo(THIRTY_SECONDS_MS);

    const keys = await client.load({ refresh: true });

    expect({ kids: kidsOf(keys), discovery: issuer.countOf(DISCOVERY_URL), jwks: issuer.countOf(JWKS_URI) }).toEqual({
      kids: ['key-a', 'key-b'],
      discovery: 1,
      jwks: 1,
    });
  });

  it('counts the 30 seconds from each fetch, in every cycle', async () => {
    const { client, issuer, clock } = await loadedOnceWith([KEY_A], [KEY_A, KEY_B]);
    const offsets = [
      JUST_BEFORE(THIRTY_SECONDS_MS),
      THIRTY_SECONDS_MS,
      THIRTY_SECONDS_MS + JUST_BEFORE(THIRTY_SECONDS_MS),
      2 * THIRTY_SECONDS_MS,
    ];
    const jwksRequests: number[] = [];
    for (const offset of offsets) {
      clock.moveTo(offset);
      await client.load({ refresh: true });
      jwksRequests.push(issuer.countOf(JWKS_URI));
    }

    expect(jwksRequests).toEqual([0, 1, 1, 2]);
  });
});

describe('the address the key set is fetched from', () => {
  it('fetches the discovery document first and then the address its jwks_uri member gives', async () => {
    const issuer = standInForIssuer({ jwksUri: 'https://keys.example.test/published/jwks.json' });
    issuer.serve([KEY_A]);
    const client = createJwksClient({ issuer: ISSUER, now: clockStartingAt(FIRST_LOAD_AT_MS).now });

    await client.load({ refresh: false });

    expect(issuer.requests.map((request) => request.url)).toEqual([
      DISCOVERY_URL,
      'https://keys.example.test/published/jwks.json',
    ]);
  });
});

describe('loads started while the first fetch is pending', () => {
  it('share one fetch of the discovery document and of the key set, each load receiving the keys that fetch returned', async () => {
    const issuer = standInForIssuer();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const keysRequested = new Promise<void>((resolve) => {
      issuer.answerKeySetWith(async () => {
        resolve();
        await gate;
        return Response.json({ keys: [KEY_A] });
      });
    });
    const client = createJwksClient({ issuer: ISSUER, now: clockStartingAt(FIRST_LOAD_AT_MS).now });

    const first = client.load({ refresh: false });
    await keysRequested;
    const later = [client.load({ refresh: false }), client.load({ refresh: false })];
    release();
    const keysOfEachLoad = await Promise.all([first, ...later]);

    expect({
      discovery: issuer.countOf(DISCOVERY_URL),
      jwks: issuer.countOf(JWKS_URI),
      keysOfEachLoad,
    }).toEqual({ discovery: 1, jwks: 1, keysOfEachLoad: [[KEY_A], [KEY_A], [KEY_A]] });
  });
});

describe('the headers the module adds to the requests to the issuer', () => {
  it('sends the headers the module supplies on the discovery request and on the key set request', async () => {
    const issuer = standInForIssuer();
    issuer.serve([KEY_A]);
    const client = createJwksClient({
      issuer: ISSUER,
      now: clockStartingAt(FIRST_LOAD_AT_MS).now,
      requestHeaders: () => ({ traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' }),
    });

    await client.load({ refresh: false });

    expect(issuer.requests.map((request) => request.headers.get('traceparent'))).toEqual([
      '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    ]);
  });

  it('sends no header of its own beyond accept when the module supplies none', async () => {
    const issuer = standInForIssuer();
    issuer.serve([KEY_A]);
    const client = createJwksClient({ issuer: ISSUER, now: clockStartingAt(FIRST_LOAD_AT_MS).now });

    await client.load({ refresh: false });

    expect(issuer.requests.map((request) => [...request.headers.keys()])).toEqual([['accept'], ['accept']]);
  });
});
