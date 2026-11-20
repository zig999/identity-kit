import { afterEach, describe, expect, it } from 'vitest';

import { createAuthenticator } from '../../../src/authenticator.js';
import { OPERATION_TYPES, defineClaimsSchema } from '../../../src/claims.js';
import { createJwksClient } from '../../../src/jwks-client.js';
import { issueConformanceToken } from '../../../src/testing/conformance-token.js';
import { TestSupportError } from '../../../src/testing/test-support-error.js';
import { createTestIssuer } from '../../../src/testing/test-issuer.js';
import type { ITestIssuer } from '../../../src/testing/test-issuer.js';
import { createTokenVerifier } from '../../../src/token-verifier.js';
import { clockStartingAt } from '../../support/issuer-stand-in.js';

const AUDIENCE = 'audience-of-this-module';
const START_MS = Date.UTC(2026, 0, 1, 12, 0, 0);
const LIFETIME_SECONDS = 7200;
const MILLISECONDS_PER_SECOND = 1000;
const BEARER_PREFIX = 'Bearer ';
const RESOURCES = ['firstResource', 'secondResource'];
const opened: ITestIssuer[] = [];

const issuerOn = async (): Promise<ITestIssuer> => {
  const issuer = await createTestIssuer({ now: () => new Date(START_MS), lifetimeSeconds: LIFETIME_SECONDS });
  opened.push(issuer);
  return issuer;
};

const authenticatorFor = (issuer: ITestIssuer) => {
  const clock = clockStartingAt(START_MS);
  return createAuthenticator(
    createTokenVerifier({
      keySet: createJwksClient({ issuer: issuer.url, now: clock.now }),
      issuer: issuer.url,
      claims: defineClaimsSchema({ resources: RESOURCES }),
      now: clock.now,
    }),
  );
};

afterEach(async () => {
  await Promise.all(opened.splice(0).map((issuer) => issuer.close()));
});

describe('the conformance token', () => {
  it('starts with the Bearer scheme and expires when the issued token does', async () => {
    const issuer = await issuerOn();

    const issued = issueConformanceToken(issuer, AUDIENCE, { resources: RESOURCES });

    expect(issued.bearerToken.startsWith(BEARER_PREFIX)).toBe(true);
    expect(issued.expiresAt).toEqual(new Date(START_MS + LIFETIME_SECONDS * MILLISECONDS_PER_SECOND));
  });

  it('carries an integer exp even when the clock stands between two seconds', async () => {
    const issuer = await createTestIssuer({ now: () => new Date(START_MS + 500), lifetimeSeconds: LIFETIME_SECONDS });
    opened.push(issuer);

    const issued = issueConformanceToken(issuer, AUDIENCE, { resources: RESOURCES });

    const payload = JSON.parse(Buffer.from(issued.bearerToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
    expect(Number.isInteger(payload.exp)).toBe(true);
    expect(issued.expiresAt).toEqual(new Date(START_MS + LIFETIME_SECONDS * MILLISECONDS_PER_SECOND));
  });

  it('is verified by a module that trusts the issuer and the audience, with every operation on each resource', async () => {
    const issuer = await issuerOn();
    const issued = issueConformanceToken(issuer, AUDIENCE, { resources: RESOURCES });

    const caller = await authenticatorFor(issuer).authenticate(issued.bearerToken, AUDIENCE);

    const held = RESOURCES.flatMap((resource) =>
      OPERATION_TYPES.map((type) => caller?.holds({ resource, type }) === true),
    );
    expect(held.every(Boolean)).toBe(true);
    expect(Object.keys(caller?.claims.accessRights ?? {})).toEqual(RESOURCES);
  });

  it('grants only the operations the caller of the function passes', async () => {
    const issuer = await issuerOn();
    const issued = issueConformanceToken(issuer, AUDIENCE, { resources: RESOURCES, operations: ['read', 'discover'] });

    const caller = await authenticatorFor(issuer).authenticate(issued.bearerToken, AUDIENCE);

    expect(caller?.claims.accessRights).toEqual({
      firstResource: ['read', 'discover'],
      secondResource: ['read', 'discover'],
    });
  });

  it.each([undefined, { resources: [] }])('grants no resource when none is informed (%j)', async (options) => {
    const issuer = await issuerOn();
    const issued = issueConformanceToken(issuer, AUDIENCE, options);

    const caller = await authenticatorFor(issuer).authenticate(issued.bearerToken, AUDIENCE);

    expect(caller?.claims.accessRights ?? {}).toEqual({});
    expect(RESOURCES.some((resource) => caller?.holds({ resource, type: 'read' }))).toBe(false);
  });

  it('is refused by a module that expects another audience', async () => {
    const issuer = await issuerOn();
    const issued = issueConformanceToken(issuer, AUDIENCE, { resources: RESOURCES });

    expect(await authenticatorFor(issuer).authenticate(issued.bearerToken, 'another-audience')).toBeUndefined();
  });

  it('writes nothing to the console while issuing', async () => {
    const issuer = await issuerOn();
    const writes: unknown[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      writes.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      issueConformanceToken(issuer, AUDIENCE, { resources: RESOURCES });
    } finally {
      process.stdout.write = original;
    }

    expect(writes).toEqual([]);
  });

  it('keeps the token out of the error it throws when the issuer builds no numeric expiry', () => {
    const token = 'header.payload.signature';
    const brokenIssuer: ITestIssuer = {
      url: 'http://issuer.test',
      requests: [],
      claims: (audience) => ({ aud: audience, exp: 'tomorrow' }),
      issue: () => token,
      issueForeign: () => token,
      rotateKey: () => {
        throw new Error('not used');
      },
      close: async () => undefined,
    };

    const failure = ((): unknown => {
      try {
        return issueConformanceToken(brokenIssuer, AUDIENCE, { resources: RESOURCES });
      } catch (error) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(TestSupportError);
    expect(String((failure as Error).message)).not.toContain(token);
  });
});
