import { vi } from 'vitest';

export const ISSUER = 'https://issuer.example.test';
export const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
export const JWKS_URI = `${ISSUER}/keys`;
export const FIRST_LOAD_AT_MS = Date.UTC(2026, 0, 1, 12, 0, 0);

export const KEY_A = { kty: 'RSA', kid: 'key-a', use: 'sig', alg: 'RS256', n: 'modulus-a', e: 'AQAB' };
export const KEY_B = { kty: 'RSA', kid: 'key-b', use: 'sig', alg: 'RS256', n: 'modulus-b', e: 'AQAB' };

export type Responder = () => Response | Promise<Response>;

export interface IRecordedRequest {
  readonly url: string;
  readonly headers: Headers;
}

export interface IIssuerStandIn {
  readonly requests: IRecordedRequest[];
  serve(keys: readonly object[]): void;
  answerDiscoveryWith(responder: Responder): void;
  answerKeySetWith(responder: Responder): void;
  countOf(url: string): number;
}

export interface IIssuerOptions {
  readonly jwksUri?: string;
}

export const standInForIssuer = (options: IIssuerOptions = {}): IIssuerStandIn => {
  const jwksUri = options.jwksUri ?? JWKS_URI;
  const requests: IRecordedRequest[] = [];
  let discoveryResponder: Responder = () => Response.json({ jwks_uri: jwksUri });
  let keySetResponder: Responder = () => Response.json({ keys: [] });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit): Promise<Response> => {
    requests.push({ url, headers: new Headers(init?.headers) });
    if (url === DISCOVERY_URL) return discoveryResponder();
    if (url === jwksUri) return keySetResponder();
    return new Response(null, { status: 404 });
  });
  return {
    requests,
    serve: (keys) => {
      keySetResponder = () => Response.json({ keys });
    },
    answerDiscoveryWith: (responder) => {
      discoveryResponder = responder;
    },
    answerKeySetWith: (responder) => {
      keySetResponder = responder;
    },
    countOf: (url) => requests.filter((request) => request.url === url).length,
  };
};

export const failingRequest: Responder = () => {
  throw new TypeError('fetch failed');
};

export const unstubFetch = (): void => {
  vi.unstubAllGlobals();
};

export const rejectionOf = async (loading: Promise<unknown>): Promise<unknown> => {
  try {
    await loading;
  } catch (error) {
    return error;
  }
  return undefined;
};

export interface IMovableClock {
  readonly now: () => Date;
  readonly moveTo: (offsetMs: number) => void;
}

export const clockStartingAt = (startMs: number): IMovableClock => {
  let nowMs = startMs;
  return {
    now: () => new Date(nowMs),
    moveTo: (offsetMs) => {
      nowMs = startMs + offsetMs;
    },
  };
};
