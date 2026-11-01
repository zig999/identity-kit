import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClientCredentialsTokenSource } from '../../../src/client/client-credentials-token-source.js';
import type { IClientCredentialsOptions } from '../../../src/client/client-credentials-token-source.js';
import { createTokenEndpointStandIn, tokenAnswer } from '../../../src/testing/token-endpoint-stand-in.js';
import type { ITokenEndpointStandIn } from '../../../src/testing/token-endpoint-stand-in.js';

const CLIENT_ID = 'orders-service';
const CLIENT_SECRET = 'very-secret-value';
const ISSUED = 'issued-access-token';

const opened: ITokenEndpointStandIn[] = [];

const endpoint = async (): Promise<ITokenEndpointStandIn> => {
  const standIn = await createTokenEndpointStandIn();
  opened.push(standIn);
  return standIn;
};

const sourceFor = (standIn: ITokenEndpointStandIn, extra: Partial<IClientCredentialsOptions> = {}) =>
  createClientCredentialsTokenSource({
    tokenEndpointUrl: standIn.url,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    ...extra,
  });

const formOf = (body: string): Record<string, string> => Object.fromEntries(new URLSearchParams(body));

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(opened.splice(0).map((standIn) => standIn.close()));
});

describe('the token request the module sends', () => {
  it('is a form-encoded POST to the configured token endpoint with the client credentials grant', async () => {
    const standIn = await endpoint();

    await sourceFor(standIn).obtainAccessToken();

    const [request] = standIn.requests;
    expect({
      count: standIn.requests.length,
      method: request?.method,
      contentType: request?.headers['content-type'],
      form: formOf(request?.body ?? ''),
    }).toEqual({
      count: 1,
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      form: { grant_type: 'client_credentials' },
    });
  });

  it('authenticates the client with HTTP Basic built from the identifier and the secret', async () => {
    const standIn = await endpoint();

    await sourceFor(standIn).obtainAccessToken();

    const expected = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
    expect(standIn.requests[0]?.headers['authorization']).toBe(expected);
  });

  it('form-encodes the identifier and the secret before building the Basic credentials', async () => {
    const standIn = await endpoint();

    await sourceFor(standIn, { clientId: 'a b:c', clientSecret: 'p+q/r=s&t' }).obtainAccessToken();

    const encoded = `${encodeURIComponent('a b:c').replaceAll('%20', '+')}:${encodeURIComponent('p+q/r=s&t')}`;
    expect(standIn.requests[0]?.headers['authorization']).toBe(`Basic ${Buffer.from(encoded).toString('base64')}`);
  });

  it.each([
    { parameter: 'audience', option: { audience: 'orders-api' } },
    { parameter: 'scope', option: { scope: 'catalog.read' } },
  ])('carries the $parameter parameter when one is configured', async ({ parameter, option }) => {
    const standIn = await endpoint();

    await sourceFor(standIn, option).obtainAccessToken();

    expect(formOf(standIn.requests[0]?.body ?? '')[parameter]).toBe(Object.values(option)[0]);
  });

  it.each([
    { label: 'none is configured', options: {} },
    { label: 'each is the empty string', options: { audience: '', scope: '' } },
  ])('carries no audience and no scope parameter when $label', async ({ options }) => {
    const standIn = await endpoint();

    await sourceFor(standIn, options).obtainAccessToken();

    expect(Object.keys(formOf(standIn.requests[0]?.body ?? ''))).toEqual(['grant_type']);
  });

  it('carries both audience and scope when both are configured', async () => {
    const standIn = await endpoint();

    await sourceFor(standIn, { audience: 'orders-api', scope: 'catalog.read' }).obtainAccessToken();

    expect(formOf(standIn.requests[0]?.body ?? '')).toEqual({
      grant_type: 'client_credentials',
      audience: 'orders-api',
      scope: 'catalog.read',
    });
  });
});

describe('an answer that yields an access token', () => {
  it('is an HTTP 200 carrying an access_token and a token_type of Bearer', async () => {
    const standIn = await endpoint();
    standIn.answerWith(tokenAnswer({ access_token: ISSUED, token_type: 'Bearer' }));

    expect(await sourceFor(standIn).obtainAccessToken()).toEqual({ obtained: true, accessToken: ISSUED });
  });

  it.each(['bearer', 'BEARER', 'bEaReR'])('accepts a token_type of %s as Bearer', async (tokenType) => {
    const standIn = await endpoint();
    standIn.answerWith(tokenAnswer({ access_token: ISSUED, token_type: tokenType }));

    expect(await sourceFor(standIn).obtainAccessToken()).toMatchObject({ obtained: true });
  });

  it('passes the expires_in of the answer on with the access token', async () => {
    const standIn = await endpoint();
    standIn.answerWith(tokenAnswer({ access_token: ISSUED, token_type: 'Bearer', expires_in: 300 }));

    expect(await sourceFor(standIn).obtainAccessToken()).toEqual({
      obtained: true,
      accessToken: ISSUED,
      expiresIn: 300,
    });
  });

  it.each([
    { label: 'a string', value: '300' },
    { label: 'null', value: null },
  ])('yields the access token without a lifetime when expires_in is $label', async ({ value }) => {
    const standIn = await endpoint();
    standIn.answerWith(tokenAnswer({ access_token: ISSUED, token_type: 'Bearer', expires_in: value }));

    expect(await sourceFor(standIn).obtainAccessToken()).toEqual({ obtained: true, accessToken: ISSUED });
  });
});

describe('an outcome that yields no access token', () => {
  it('is a token endpoint that cannot be reached', async () => {
    const standIn = await endpoint();
    const source = sourceFor(standIn);
    await standIn.close();

    expect(await source.obtainAccessToken()).toEqual({ obtained: false });
  });

  it('is a token endpoint that does not answer within the time limit', async () => {
    const standIn = await endpoint();
    standIn.neverAnswer();

    expect(await sourceFor(standIn, { timeoutMs: 50 }).obtainAccessToken()).toEqual({ obtained: false });
  });

  it.each([
    { label: 'status 400', answer: tokenAnswer({ error: 'invalid_client' }, 400) },
    { label: 'status 401', answer: tokenAnswer({ error: 'invalid_client' }, 401) },
    { label: 'status 500', answer: tokenAnswer('boom', 500) },
    { label: 'status 201 carrying a token', answer: tokenAnswer({ access_token: ISSUED, token_type: 'Bearer' }, 201) },
  ])('is an answer with $label', async ({ answer }) => {
    const standIn = await endpoint();
    standIn.answerWith(answer);

    expect(await sourceFor(standIn).obtainAccessToken()).toEqual({ obtained: false });
  });

  it.each([
    { label: 'a body that is not JSON', answer: tokenAnswer('not json') },
    { label: 'a JSON array', answer: tokenAnswer([]) },
    { label: 'no access_token', answer: tokenAnswer({ token_type: 'Bearer' }) },
    { label: 'an empty access_token', answer: tokenAnswer({ access_token: '', token_type: 'Bearer' }) },
    { label: 'an access_token that is a number', answer: tokenAnswer({ access_token: 7, token_type: 'Bearer' }) },
    { label: 'an access_token that is null', answer: tokenAnswer({ access_token: null, token_type: 'Bearer' }) },
    { label: 'no token_type', answer: tokenAnswer({ access_token: ISSUED }) },
    { label: 'a token_type of mac', answer: tokenAnswer({ access_token: ISSUED, token_type: 'mac' }) },
    {
      label: 'a token_type of Bearer plus a suffix',
      answer: tokenAnswer({ access_token: ISSUED, token_type: 'Bearer2' }),
    },
  ])('is an HTTP 200 with $label', async ({ answer }) => {
    const standIn = await endpoint();
    standIn.answerWith(answer);

    expect(await sourceFor(standIn).obtainAccessToken()).toEqual({ obtained: false });
  });
});

describe('what the module lets out when no access token is obtained', () => {
  const FAILURES = [
    {
      label: 'a refused client',
      arrange: (standIn: ITokenEndpointStandIn) => standIn.answerWith(tokenAnswer({ error: 'invalid_client' }, 401)),
    },
    {
      label: 'an answer that is not JSON',
      arrange: (standIn: ITokenEndpointStandIn) => standIn.answerWith(tokenAnswer('not json')),
    },
    {
      label: 'an answer with a non-Bearer token',
      arrange: (standIn: ITokenEndpointStandIn) =>
        standIn.answerWith(tokenAnswer({ access_token: ISSUED, token_type: 'mac' })),
    },
  ];
  const BASIC = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  it.each(FAILURES)(
    'carries nothing of the secret, the Basic credentials or an issued token for $label',
    async ({ arrange }) => {
      const standIn = await endpoint();
      arrange(standIn);

      const outcome = JSON.stringify(await sourceFor(standIn).obtainAccessToken());

      expect([CLIENT_SECRET, BASIC, ISSUED].filter((secret) => outcome.includes(secret))).toEqual([]);
    },
  );

  it.each(FAILURES)('writes nothing to the console for $label', async ({ arrange }) => {
    const standIn = await endpoint();
    arrange(standIn);
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method));

    await sourceFor(standIn).obtainAccessToken();

    expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([]);
  });
});

describe('the report that the target refused an access token', () => {
  it('is accepted and changes nothing, since the source holds no token', async () => {
    const standIn = await endpoint();
    const source = sourceFor(standIn);
    await source.obtainAccessToken();

    source.reportAccessTokenRefused(ISSUED);

    expect(await source.obtainAccessToken()).toMatchObject({ obtained: true });
  });
});
