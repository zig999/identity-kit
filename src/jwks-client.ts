import { z } from 'zod';

import { JsonWebKeySchema, JsonWebKeySetSchema } from './key-set.js';
import type { IKeySetLoad, IKeySetSource, KeySetKey } from './key-set.js';
import { KeySetLoadError } from './key-set-load-error.js';

const DISCOVERY_PATH = '/.well-known/openid-configuration';
const LOAD_OPERATION = 'load-key-set';
const LOAD_FAILED_MESSAGE = 'The key set of the configured issuer could not be loaded.';
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_LIFETIME_MS = 600_000;
const MIN_REFRESH_INTERVAL_MS = 30_000;

const DiscoverySchema = z.looseObject({ jwks_uri: z.url() });

export interface IJwksClientDeps {
  readonly issuer: string;
  readonly now: () => Date;
  readonly requestHeaders?: () => Readonly<Record<string, string>>;
}

interface ICachedKeys {
  readonly keys: readonly KeySetKey[];
  readonly loadedAt: number;
}

const fetchJson = async (url: string, extraHeaders: Readonly<Record<string, string>>): Promise<unknown> => {
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...extraHeaders },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`the issuer answered status ${String(response.status)}`);
  }
  return response.json();
};

const wellFormedKeys = (entries: readonly unknown[]): readonly KeySetKey[] =>
  entries.flatMap((entry) => {
    const parsed = JsonWebKeySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });

const fetchKeys = async (issuer: string, headers: Readonly<Record<string, string>>): Promise<readonly KeySetKey[]> => {
  const discovery = DiscoverySchema.parse(await fetchJson(`${issuer}${DISCOVERY_PATH}`, headers));
  const keySet = JsonWebKeySetSchema.parse(await fetchJson(discovery.jwks_uri, headers));
  return wellFormedKeys(keySet.keys);
};

const loadKeys = async (issuer: string, headers: Readonly<Record<string, string>>): Promise<readonly KeySetKey[]> => {
  const keys = await fetchKeys(issuer, headers).catch((error: unknown): never => {
    throw new KeySetLoadError(LOAD_FAILED_MESSAGE, { operation: LOAD_OPERATION }, error);
  });
  if (keys.length === 0) {
    throw new KeySetLoadError(LOAD_FAILED_MESSAGE, { operation: LOAD_OPERATION }, undefined);
  }
  return keys;
};

const isReusable = (cached: ICachedKeys, refresh: boolean, nowMs: number): boolean =>
  nowMs - cached.loadedAt < (refresh ? MIN_REFRESH_INTERVAL_MS : CACHE_LIFETIME_MS);

export const createJwksClient = (deps: IJwksClientDeps): IKeySetSource => {
  let cached: ICachedKeys | undefined;
  let pending: Promise<ICachedKeys> | undefined;
  const fetchFresh = async (): Promise<ICachedKeys> => {
    try {
      const keys = await loadKeys(deps.issuer, deps.requestHeaders?.() ?? {});
      cached = { keys, loadedAt: deps.now().getTime() };
      return cached;
    } finally {
      pending = undefined;
    }
  };
  return {
    async load(options: IKeySetLoad): Promise<readonly KeySetKey[]> {
      if (cached !== undefined && isReusable(cached, options.refresh, deps.now().getTime())) {
        return cached.keys;
      }
      pending ??= fetchFresh();
      return (await pending).keys;
    },
  };
};
