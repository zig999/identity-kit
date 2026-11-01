import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';

import { generateSigningKey, signToken } from './signing.js';
import type { ISigningKey, SigningAlgorithm, TokenClaims } from './signing.js';

const LOOPBACK = '127.0.0.1';
const EPHEMERAL_PORT = 0;
const DISCOVERY_PATH = '/.well-known/openid-configuration';
const KEYS_PATH = '/keys';
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const DEFAULT_LIFETIME_SECONDS = 3600;
const MILLISECONDS_PER_SECOND = 1000;
const DEFAULT_SUBJECT = 'test-caller';

export interface ITestIssuerOptions {
  readonly alg?: SigningAlgorithm;
  readonly now?: () => Date;
  readonly lifetimeSeconds?: number;
}

export interface IRotationOptions {
  readonly retireCurrent?: boolean;
}

export interface ITestIssuer {
  readonly url: string;
  readonly requests: string[];
  claims(audience: string, extra?: TokenClaims): TokenClaims;
  issue(claims: TokenClaims): string;
  issueForeign(claims: TokenClaims): string;
  rotateKey(options?: IRotationOptions): ISigningKey;
  close(): Promise<void>;
}

const portOf = (server: Server): number => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the test issuer did not bind a TCP address');
  return address.port;
};

const answerJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

interface IKeyRing {
  current(): ISigningKey;
  published(): readonly ISigningKey[];
  rotate(retireCurrent: boolean): ISigningKey;
}

const keyRingOf = (alg: SigningAlgorithm): IKeyRing => {
  let sequence = 0;
  const nextKey = (): ISigningKey => generateSigningKey(`test-issuer-key-${String((sequence += 1))}`, alg);
  let keys: ISigningKey[] = [nextKey()];
  return {
    current: () => keys.at(-1) ?? nextKey(),
    published: () => keys,
    rotate: (retireCurrent) => {
      const key = nextKey();
      keys = retireCurrent ? [key] : [...keys, key];
      return key;
    },
  };
};

interface IServing {
  readonly server: Server;
  readonly url: string;
}

const serve = async (ring: IKeyRing, requests: string[]): Promise<IServing> => {
  let url = '';
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    if (request.url === DISCOVERY_PATH) answerJson(response, HTTP_OK, { issuer: url, jwks_uri: `${url}${KEYS_PATH}` });
    else if (request.url === KEYS_PATH) answerJson(response, HTTP_OK, { keys: ring.published().map((key) => key.jwk) });
    else answerJson(response, HTTP_NOT_FOUND, {});
  });
  await new Promise<void>((resolve) => server.listen(EPHEMERAL_PORT, LOOPBACK, resolve));
  url = `http://${LOOPBACK}:${String(portOf(server))}`;
  return { server, url };
};

export const createTestIssuer = async (options: ITestIssuerOptions = {}): Promise<ITestIssuer> => {
  const alg = options.alg ?? 'ES256';
  const now = options.now ?? ((): Date => new Date());
  const lifetime = options.lifetimeSeconds ?? DEFAULT_LIFETIME_SECONDS;
  const requests: string[] = [];
  const ring = keyRingOf(alg);
  const { server, url } = await serve(ring, requests);
  const foreign = generateSigningKey('foreign-key', alg);
  return {
    url,
    requests,
    claims: (audience, extra = {}) => ({
      iss: url,
      aud: audience,
      sub: DEFAULT_SUBJECT,
      exp: now().getTime() / MILLISECONDS_PER_SECOND + lifetime,
      ...extra,
    }),
    issue: (claims) => signToken(claims, ring.current()),
    issueForeign: (claims) => signToken(claims, foreign, ring.current().kid),
    rotateKey: (rotation = {}) => ring.rotate(rotation.retireCurrent === true),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
