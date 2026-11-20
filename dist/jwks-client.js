import { z } from 'zod';
import { JsonWebKeySchema, JsonWebKeySetSchema } from './key-set.js';
import { KeySetLoadError } from './key-set-load-error.js';
const DISCOVERY_PATH = '/.well-known/openid-configuration';
const LOAD_OPERATION = 'load-key-set';
const LOAD_FAILED_MESSAGE = 'The key set of the configured issuer could not be loaded.';
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_LIFETIME_MS = 600_000;
const MIN_REFRESH_INTERVAL_MS = 30_000;
const DiscoverySchema = z.looseObject({ jwks_uri: z.url() });
const fetchJson = async (url, extraHeaders) => {
    const response = await fetch(url, {
        headers: { accept: 'application/json', ...extraHeaders },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`the issuer answered status ${String(response.status)}`);
    }
    return response.json();
};
const wellFormedKeys = (entries) => entries.flatMap((entry) => {
    const parsed = JsonWebKeySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
});
const fetchKeys = async (issuer, headers) => {
    const discovery = DiscoverySchema.parse(await fetchJson(`${issuer}${DISCOVERY_PATH}`, headers));
    const keySet = JsonWebKeySetSchema.parse(await fetchJson(discovery.jwks_uri, headers));
    return wellFormedKeys(keySet.keys);
};
const loadKeys = async (issuer, headers) => {
    const keys = await fetchKeys(issuer, headers).catch((error) => {
        throw new KeySetLoadError(LOAD_FAILED_MESSAGE, { operation: LOAD_OPERATION }, error);
    });
    if (keys.length === 0) {
        throw new KeySetLoadError(LOAD_FAILED_MESSAGE, { operation: LOAD_OPERATION }, undefined);
    }
    return keys;
};
const isReusable = (cached, refresh, nowMs) => nowMs - cached.loadedAt < (refresh ? MIN_REFRESH_INTERVAL_MS : CACHE_LIFETIME_MS);
export const createJwksClient = (deps) => {
    let cached;
    let pending;
    const fetchFresh = async () => {
        try {
            const keys = await loadKeys(deps.issuer, deps.requestHeaders?.() ?? {});
            cached = { keys, loadedAt: deps.now().getTime() };
            return cached;
        }
        finally {
            pending = undefined;
        }
    };
    return {
        async load(options) {
            if (cached !== undefined && isReusable(cached, options.refresh, deps.now().getTime())) {
                return cached.keys;
            }
            pending ??= fetchFresh();
            return (await pending).keys;
        },
    };
};
