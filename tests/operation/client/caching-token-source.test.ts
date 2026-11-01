import { describe, expect, it, vi } from 'vitest';

import type { AccessTokenResult, IAccessTokenSource } from '../../../src/client/access-token-source.js';
import { createCachingTokenSource } from '../../../src/client/caching-token-source.js';
import { clockStartingAt } from '../../support/issuer-stand-in.js';

const START_MS = Date.UTC(2026, 0, 1, 12, 0, 0);
const SECOND_MS = 1_000;
const LIFETIME_SECONDS = 300;
const RENEWAL_MARGIN_SECONDS = 30;
const RENEWAL_POINT_MS = (LIFETIME_SECONDS - RENEWAL_MARGIN_SECONDS) * SECOND_MS;

const obtained = (accessToken: string, expiresIn?: number): AccessTokenResult =>
  expiresIn === undefined ? { obtained: true, accessToken } : { obtained: true, accessToken, expiresIn };

const NOT_OBTAINED: AccessTokenResult = { obtained: false };

const scriptedSource = (...outcomes: readonly (AccessTokenResult | Error)[]) => {
  let index = 0;
  const obtainAccessToken = vi.fn(async (): Promise<AccessTokenResult> => {
    const outcome = outcomes[Math.min(index, outcomes.length - 1)] ?? NOT_OBTAINED;
    index += 1;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  const source: IAccessTokenSource = { obtainAccessToken, reportAccessTokenRefused: vi.fn() };
  return { source, obtainAccessToken };
};

const cachingOver = (source: IAccessTokenSource) => {
  const clock = clockStartingAt(START_MS);
  return { caching: createCachingTokenSource(source, { now: clock.now }), clock };
};

describe('an access token the module reuses', () => {
  it('is handed to every demand made before 30 seconds ahead of the end of its lifetime, with one token request', async () => {
    const { source, obtainAccessToken } = scriptedSource(
      obtained('first', LIFETIME_SECONDS),
      obtained('second', LIFETIME_SECONDS),
    );
    const { caching, clock } = cachingOver(source);
    const handed: AccessTokenResult[] = [await caching.obtainAccessToken()];
    clock.moveTo(RENEWAL_POINT_MS - 1);
    handed.push(await caching.obtainAccessToken());

    expect({ handed, requests: obtainAccessToken.mock.calls.length }).toEqual({
      handed: [
        { obtained: true, accessToken: 'first', expiresIn: LIFETIME_SECONDS },
        { obtained: true, accessToken: 'first' },
      ],
      requests: 1,
    });
  });

  it('is replaced by a new token request for the first demand made at the renewal point', async () => {
    const { source, obtainAccessToken } = scriptedSource(
      obtained('first', LIFETIME_SECONDS),
      obtained('second', LIFETIME_SECONDS),
    );
    const { caching, clock } = cachingOver(source);
    await caching.obtainAccessToken();
    clock.moveTo(RENEWAL_POINT_MS);

    const renewed = await caching.obtainAccessToken();

    expect({ renewed, requests: obtainAccessToken.mock.calls.length }).toEqual({
      renewed: { obtained: true, accessToken: 'second', expiresIn: LIFETIME_SECONDS },
      requests: 2,
    });
  });

  it('counts its lifetime from the moment the answer arrived', async () => {
    const { source, obtainAccessToken } = scriptedSource(
      obtained('first', LIFETIME_SECONDS),
      obtained('second', LIFETIME_SECONDS),
    );
    const { caching, clock } = cachingOver(source);
    clock.moveTo(10 * SECOND_MS);
    await caching.obtainAccessToken();
    clock.moveTo(10 * SECOND_MS + RENEWAL_POINT_MS - 1);

    await caching.obtainAccessToken();

    expect(obtainAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe('several demands made while one token request is outstanding', () => {
  it('cause one token request and each receives its outcome', async () => {
    const { source, obtainAccessToken } = scriptedSource(obtained('shared', LIFETIME_SECONDS));
    const { caching } = cachingOver(source);

    const outcomes = await Promise.all([
      caching.obtainAccessToken(),
      caching.obtainAccessToken(),
      caching.obtainAccessToken(),
    ]);

    expect({
      requests: obtainAccessToken.mock.calls.length,
      tokens: outcomes.map((o) => o.obtained && o.accessToken),
    }).toEqual({
      requests: 1,
      tokens: ['shared', 'shared', 'shared'],
    });
  });

  it('each receive that the token was not obtained when the request failed, never an older token', async () => {
    const { source } = scriptedSource(obtained('old', LIFETIME_SECONDS), NOT_OBTAINED);
    const { caching, clock } = cachingOver(source);
    await caching.obtainAccessToken();
    clock.moveTo(RENEWAL_POINT_MS);

    const outcomes = await Promise.all([caching.obtainAccessToken(), caching.obtainAccessToken()]);

    expect(outcomes).toEqual([NOT_OBTAINED, NOT_OBTAINED]);
  });
});

describe('an answer that gives the token no usable lifetime', () => {
  it.each([
    { label: 'no lifetime', expiresIn: undefined },
    { label: 'a lifetime of zero', expiresIn: 0 },
    { label: 'a negative lifetime', expiresIn: -5 },
    { label: 'a lifetime that is not a number', expiresIn: Number.NaN },
    { label: 'an infinite lifetime', expiresIn: Number.POSITIVE_INFINITY },
    { label: 'a lifetime that does not outlast the renewal margin', expiresIn: RENEWAL_MARGIN_SECONDS },
  ])('reaches the demand but is not kept when it carries $label', async ({ expiresIn }) => {
    const { source, obtainAccessToken } = scriptedSource(obtained('t1', expiresIn), obtained('t2', expiresIn));
    const { caching } = cachingOver(source);

    const first = await caching.obtainAccessToken();
    const second = await caching.obtainAccessToken();

    expect({
      first: first.obtained && first.accessToken,
      second: second.obtained && second.accessToken,
      requests: obtainAccessToken.mock.calls.length,
    }).toEqual({
      first: 't1',
      second: 't2',
      requests: 2,
    });
  });
});

describe('a token request that failed', () => {
  it('is followed by a new token request at once for the next demand', async () => {
    const { source, obtainAccessToken } = scriptedSource(NOT_OBTAINED, obtained('after', LIFETIME_SECONDS));
    const { caching } = cachingOver(source);

    const failed = await caching.obtainAccessToken();
    const next = await caching.obtainAccessToken();

    expect({ failed, next: next.obtained && next.accessToken, requests: obtainAccessToken.mock.calls.length }).toEqual({
      failed: NOT_OBTAINED,
      next: 'after',
      requests: 2,
    });
  });

  it('is reported as not obtained, never thrown, when the source throws', async () => {
    const { source } = scriptedSource(new Error('boom'), obtained('after', LIFETIME_SECONDS));
    const { caching } = cachingOver(source);

    const outcomes = [await caching.obtainAccessToken(), await caching.obtainAccessToken()];

    expect(outcomes.map((outcome) => outcome.obtained)).toEqual([false, true]);
  });
});

describe('the report that the held access token was refused', () => {
  it('discards the held token whatever lifetime it has left, so the next demand makes a new request', async () => {
    const { source, obtainAccessToken } = scriptedSource(
      obtained('refused', LIFETIME_SECONDS),
      obtained('fresh', LIFETIME_SECONDS),
    );
    const { caching } = cachingOver(source);
    await caching.obtainAccessToken();

    caching.reportAccessTokenRefused('refused');
    const next = await caching.obtainAccessToken();

    expect({ next: next.obtained && next.accessToken, requests: obtainAccessToken.mock.calls.length }).toEqual({
      next: 'fresh',
      requests: 2,
    });
  });

  it('leaves the held token in use when the report names another token', async () => {
    const { source, obtainAccessToken } = scriptedSource(
      obtained('held', LIFETIME_SECONDS),
      obtained('other', LIFETIME_SECONDS),
    );
    const { caching } = cachingOver(source);
    await caching.obtainAccessToken();

    caching.reportAccessTokenRefused('some-other-token');
    const next = await caching.obtainAccessToken();

    expect({ next: next.obtained && next.accessToken, requests: obtainAccessToken.mock.calls.length }).toEqual({
      next: 'held',
      requests: 1,
    });
  });

  it('is accepted when no token is held', () => {
    const { source } = scriptedSource(obtained('t', LIFETIME_SECONDS));
    const { caching } = cachingOver(source);

    expect(() => caching.reportAccessTokenRefused('anything')).not.toThrow();
  });
});
