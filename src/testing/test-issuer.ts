import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { z } from 'zod';

import { generateSigningKey, signToken } from './signing.js';
import type { ISigningKey, SigningAlgorithm, TokenClaims } from './signing.js';

const LOOPBACK = '127.0.0.1';
const EPHEMERAL_PORT = 0;
const DISCOVERY_PATH = '/.well-known/openid-configuration';
const KEYS_PATH = '/keys';
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;
const ISSUE_PATH = '/issue';
const TRAILING_SLASHES = /\/+$/u;
const DEFAULT_LIFETIME_SECONDS = 3600;
const MILLISECONDS_PER_SECOND = 1000;
const DEFAULT_SUBJECT = 'test-caller';

export interface ITestIssuerOptions {
  readonly alg?: SigningAlgorithm;
  readonly now?: () => Date;
  readonly lifetimeSeconds?: number;
  readonly host?: string;
  readonly port?: number;
  readonly publicUrl?: string;
  readonly issuanceRoute?: boolean;
}

const IssueRequestSchema = z.object({
  audience: z.string(),
  subject: z.string().optional(),
  roles: z.array(z.string()).optional(),
});

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

interface IListening {
  readonly host: string;
  readonly port: number;
  readonly publicUrl?: string | undefined;
}

interface IIssuance {
  readonly claims: (audience: string, extra?: TokenClaims) => TokenClaims;
  readonly issue: (claims: TokenClaims) => string;
}

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
};

const parseIssueRequest = (body: string): z.infer<typeof IssueRequestSchema> | undefined => {
  try {
    const parsed = IssueRequestSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

const answerIssue = async (request: IncomingMessage, response: ServerResponse, issuance: IIssuance): Promise<void> => {
  const asked = parseIssueRequest(await readBody(request));
  if (asked === undefined) {
    answerJson(response, HTTP_BAD_REQUEST, {});
    return;
  }
  const extra: TokenClaims = { ...(asked.subject === undefined ? {} : { sub: asked.subject }) };
  const claims = asked.roles === undefined ? extra : { ...extra, roles: asked.roles };
  answerJson(response, HTTP_OK, { token: issuance.issue(issuance.claims(asked.audience, claims)) });
};

interface IRoutes {
  readonly ring: IKeyRing;
  readonly requests: string[];
  readonly issuance?: IIssuance | undefined;
  readonly url: () => string;
}

const route = (routes: IRoutes, request: IncomingMessage, response: ServerResponse): void => {
  const url = routes.url();
  routes.requests.push(request.url ?? '');
  if (request.url === DISCOVERY_PATH) answerJson(response, HTTP_OK, { issuer: url, jwks_uri: `${url}${KEYS_PATH}` });
  else if (request.url === KEYS_PATH)
    answerJson(response, HTTP_OK, { keys: routes.ring.published().map((key) => key.jwk) });
  else if (request.url === ISSUE_PATH && request.method === 'POST' && routes.issuance !== undefined) {
    void answerIssue(request, response, routes.issuance);
  } else answerJson(response, HTTP_NOT_FOUND, {});
};

const serve = async (listening: IListening, routes: Omit<IRoutes, 'url'>): Promise<IServing> => {
  let url = listening.publicUrl?.replace(TRAILING_SLASHES, '') ?? '';
  const server = createServer((request, response) => route({ ...routes, url: () => url }, request, response));
  await new Promise<void>((resolve) => server.listen(listening.port, listening.host, resolve));
  if (url === '') url = `http://${listening.host}:${String(portOf(server))}`;
  return { server, url };
};

interface IIssuanceSetup {
  readonly issuance: IIssuance;
  readonly bindIssuer: (issuerUrl: string) => void;
}

const issuanceOf = (ring: IKeyRing, options: ITestIssuerOptions): IIssuanceSetup => {
  const now = options.now ?? ((): Date => new Date());
  const lifetime = options.lifetimeSeconds ?? DEFAULT_LIFETIME_SECONDS;
  let url = '';
  return {
    bindIssuer: (issuerUrl) => {
      url = issuerUrl;
    },
    issuance: {
      claims: (audience, extra = {}) => ({
        iss: url,
        aud: audience,
        sub: DEFAULT_SUBJECT,
        exp: now().getTime() / MILLISECONDS_PER_SECOND + lifetime,
        ...extra,
      }),
      issue: (claims) => signToken(claims, ring.current()),
    },
  };
};

export const createTestIssuer = async (options: ITestIssuerOptions = {}): Promise<ITestIssuer> => {
  const alg = options.alg ?? 'ES256';
  const requests: string[] = [];
  const ring = keyRingOf(alg);
  const { issuance, bindIssuer } = issuanceOf(ring, options);
  const listening = {
    host: options.host ?? LOOPBACK,
    port: options.port ?? EPHEMERAL_PORT,
    publicUrl: options.publicUrl,
  };
  const serving = await serve(listening, {
    ring,
    requests,
    issuance: options.issuanceRoute === true ? issuance : undefined,
  });
  bindIssuer(serving.url);
  const foreign = generateSigningKey('foreign-key', alg);
  return {
    url: serving.url,
    requests,
    ...issuance,
    issueForeign: (claims) => signToken(claims, foreign, ring.current().kid),
    rotateKey: (rotation = {}) => ring.rotate(rotation.retireCurrent === true),
    close: async () => {
      serving.server.closeAllConnections();
      await new Promise<void>((resolve) => serving.server.close(() => resolve()));
    },
  };
};
