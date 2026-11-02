import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { defineClaimsSchema } from '../../../src/claims.js';
import { createJwksClient } from '../../../src/jwks-client.js';
import { createTestIssuer } from '../../../src/testing/test-issuer.js';
import type { ITestIssuer } from '../../../src/testing/test-issuer.js';
import { createTokenVerifier } from '../../../src/token-verifier.js';
import { clockStartingAt } from '../../support/issuer-stand-in.js';

const AUDIENCE = 'audience-of-this-module';
const START_MS = Date.UTC(2026, 0, 1, 12, 0, 0);
const ALL_INTERFACES = '0.0.0.0';
const LOOPBACK = '127.0.0.1';
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;
const opened: ITestIssuer[] = [];

const freePort = async (): Promise<number> => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, LOOPBACK, resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
};

const issuerOn = async (options: Parameters<typeof createTestIssuer>[0] = {}): Promise<ITestIssuer> => {
  const issuer = await createTestIssuer({ now: () => new Date(START_MS), ...options });
  opened.push(issuer);
  return issuer;
};

const requestToken = (port: number, body: unknown): Promise<Response> =>
  fetch(`http://${LOOPBACK}:${String(port)}/issue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const payloadOf = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;

const verifierFor = (issuerUrl: string) => {
  const clock = clockStartingAt(START_MS);
  return createTokenVerifier({
    keySet: createJwksClient({ issuer: issuerUrl, now: clock.now }),
    issuer: issuerUrl,
    claims: defineClaimsSchema({ resources: ['productOffering'] }),
    now: clock.now,
  });
};

afterEach(async () => {
  await Promise.all(opened.splice(0).map((issuer) => issuer.close()));
});

describe('the address the test issuer listens on', () => {
  it('listens on the loopback with an ephemeral port when no address is given', async () => {
    const issuer = await issuerOn();

    expect(issuer.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('listens on the port that was asked for', async () => {
    const port = await freePort();

    const issuer = await issuerOn({ port });

    expect(issuer.url).toBe(`http://${LOOPBACK}:${String(port)}`);
    expect((await fetch(`${issuer.url}/keys`)).status).toBe(HTTP_OK);
  });

  it('answers on every interface when asked to listen on 0.0.0.0', async () => {
    const port = await freePort();

    await issuerOn({ host: ALL_INTERFACES, port });

    expect((await fetch(`http://${LOOPBACK}:${String(port)}/keys`)).status).toBe(HTTP_OK);
  });
});

describe('the public url of the test issuer', () => {
  it('is the issuer of the generated claims and of the discovery document, and the base of the key set address', async () => {
    const port = await freePort();
    const publicUrl = `http://localhost:${String(port)}`;

    const issuer = await issuerOn({ host: ALL_INTERFACES, port, publicUrl });
    const document = await (await fetch(`http://${LOOPBACK}:${String(port)}/.well-known/openid-configuration`)).json();

    expect(issuer.url).toBe(publicUrl);
    expect(issuer.claims(AUDIENCE).iss).toBe(publicUrl);
    expect(document).toEqual({ issuer: publicUrl, jwks_uri: `${publicUrl}/keys` });
  });

  it('is announced without a trailing slash', async () => {
    const port = await freePort();

    const issuer = await issuerOn({ port, publicUrl: `http://localhost:${String(port)}/` });

    expect(issuer.url).toBe(`http://localhost:${String(port)}`);
  });

  it('lets a verifier configured with it accept a token and refuse a token of another issuer', async () => {
    const port = await freePort();
    const issuer = await issuerOn({ host: ALL_INTERFACES, port, publicUrl: `http://localhost:${String(port)}` });
    const other = await issuerOn();
    const verifier = verifierFor(issuer.url);

    const accepted = await verifier.verify(issuer.issue(issuer.claims(AUDIENCE)), AUDIENCE);
    const refused = await verifier.verify(other.issue(other.claims(AUDIENCE)), AUDIENCE);

    expect(accepted?.iss).toBe(issuer.url);
    expect(refused).toBeUndefined();
  });
});

describe('the route that issues a token on demand', () => {
  it('does not exist unless it was turned on', async () => {
    const port = await freePort();
    await issuerOn({ port });

    expect((await requestToken(port, { audience: AUDIENCE })).status).toBe(HTTP_NOT_FOUND);
  });

  it('issues a token for the audience, the subject and the roles that were asked for', async () => {
    const port = await freePort();
    const issuer = await issuerOn({ port, issuanceRoute: true });

    const response = await requestToken(port, { audience: AUDIENCE, subject: 'ctk', roles: ['administrator'] });
    const { token } = (await response.json()) as { token: string };

    expect(response.status).toBe(HTTP_OK);
    expect(payloadOf(token)).toMatchObject({ iss: issuer.url, aud: AUDIENCE, sub: 'ctk', roles: ['administrator'] });
  });

  it('uses the default subject, no roles and the default lifetime when only the audience is asked for', async () => {
    const port = await freePort();
    const issuer = await issuerOn({ port, issuanceRoute: true });

    const { token } = (await (await requestToken(port, { audience: AUDIENCE })).json()) as { token: string };

    expect(payloadOf(token)).toEqual(issuer.claims(AUDIENCE));
  });

  it('signs with the key that the issuer publishes, so a verifier accepts the token', async () => {
    const port = await freePort();
    const issuer = await issuerOn({
      host: ALL_INTERFACES,
      port,
      publicUrl: `http://localhost:${String(port)}`,
      issuanceRoute: true,
    });
    const { token } = (await (await requestToken(port, { audience: AUDIENCE, roles: ['administrator'] })).json()) as {
      token: string;
    };

    const claims = await verifierFor(issuer.url).verify(token, AUDIENCE);

    expect(claims?.roles).toEqual(['administrator']);
  });

  it('reports an issuer iss equal to the public url, also for a token asked for by another host', async () => {
    const port = await freePort();
    const publicUrl = `http://localhost:${String(port)}`;
    await issuerOn({ host: ALL_INTERFACES, port, publicUrl, issuanceRoute: true });

    const { token } = (await (await requestToken(port, { audience: AUDIENCE })).json()) as { token: string };

    expect(payloadOf(token)['iss']).toBe(publicUrl);
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['a body without audience', JSON.stringify({ subject: 'ctk' })],
    ['an audience that is not a string', JSON.stringify({ audience: 7 })],
    ['roles that are not a list of strings', JSON.stringify({ audience: AUDIENCE, roles: [1] })],
  ])('refuses %s with status 400', async (_name, body) => {
    const port = await freePort();
    await issuerOn({ port, issuanceRoute: true });

    const response = await fetch(`http://${LOOPBACK}:${String(port)}/issue`, { method: 'POST', body });

    expect(response.status).toBe(HTTP_BAD_REQUEST);
  });

  it('answers 404 to a method other than POST on the route', async () => {
    const port = await freePort();
    await issuerOn({ port, issuanceRoute: true });

    expect((await fetch(`http://${LOOPBACK}:${String(port)}/issue`)).status).toBe(HTTP_NOT_FOUND);
  });
});
