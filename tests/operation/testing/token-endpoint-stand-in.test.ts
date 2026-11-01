import { afterEach, describe, expect, it } from 'vitest';

import { createClientCredentialsTokenSource } from '../../../src/client/client-credentials-token-source.js';
import { createTokenEndpointStandIn, tokenAnswer } from '../../../src/testing/token-endpoint-stand-in.js';
import type { ITokenEndpointStandIn } from '../../../src/testing/token-endpoint-stand-in.js';

const opened: ITokenEndpointStandIn[] = [];

const standIn = async (): Promise<ITokenEndpointStandIn> => {
  const created = await createTokenEndpointStandIn();
  opened.push(created);
  return created;
};

afterEach(async () => {
  await Promise.all(opened.splice(0).map((created) => created.close()));
});

describe('the token endpoint stand-in', () => {
  it('answers a token of type Bearer with a lifetime unless told otherwise', async () => {
    const endpoint = await standIn();

    const response = await fetch(endpoint.url, { method: 'POST', body: 'grant_type=client_credentials' });

    expect(await response.json()).toEqual({ access_token: 'issued', token_type: 'Bearer', expires_in: 300 });
  });

  it('records the method, the headers and the body of each request', async () => {
    const endpoint = await standIn();

    await fetch(endpoint.url, { method: 'POST', headers: { 'x-probe': 'yes' }, body: 'grant_type=client_credentials' });

    expect(endpoint.requests.map((request) => [request.method, request.headers['x-probe'], request.body])).toEqual([
      ['POST', 'yes', 'grant_type=client_credentials'],
    ]);
  });

  it('answers what the test told it to answer, status included', async () => {
    const endpoint = await standIn();
    endpoint.answerWith(tokenAnswer({ error: 'invalid_client' }, 401));

    const response = await fetch(endpoint.url, { method: 'POST' });

    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 401,
      body: { error: 'invalid_client' },
    });
  });

  it('serves the client credentials token source the kit ships', async () => {
    const endpoint = await standIn();

    const outcome = await createClientCredentialsTokenSource({
      tokenEndpointUrl: endpoint.url,
      clientId: 'client',
      clientSecret: 'secret',
    }).obtainAccessToken();

    expect(outcome).toEqual({ obtained: true, accessToken: 'issued', expiresIn: 300 });
  });

  it('holds a request unanswered when told never to answer', async () => {
    const endpoint = await standIn();
    endpoint.neverAnswer();

    const outcome = await createClientCredentialsTokenSource({
      tokenEndpointUrl: endpoint.url,
      clientId: 'client',
      clientSecret: 'secret',
      timeoutMs: 50,
    }).obtainAccessToken();

    expect({ outcome, received: endpoint.requests.length }).toEqual({ outcome: { obtained: false }, received: 1 });
  });
});
