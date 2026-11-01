import type { AccessTokenResult, IAccessTokenNotObtained, IAccessTokenSource } from './access-token-source.js';

const TOKEN_RENEWAL_MARGIN_SECONDS = 30;
const MILLISECONDS_PER_SECOND = 1000;

const NOT_OBTAINED: IAccessTokenNotObtained = { obtained: false };

export interface ICachingOptions {
  readonly now: () => Date;
}

interface IHeldAccessToken {
  readonly accessToken: string;
  readonly renewAtMs: number;
}

const holdable = (result: AccessTokenResult, receivedAtMs: number): IHeldAccessToken | undefined => {
  if (!result.obtained || result.expiresIn === undefined || !Number.isFinite(result.expiresIn)) return undefined;
  const renewAtMs = receivedAtMs + (result.expiresIn - TOKEN_RENEWAL_MARGIN_SECONDS) * MILLISECONDS_PER_SECOND;
  return renewAtMs > receivedAtMs ? { accessToken: result.accessToken, renewAtMs } : undefined;
};

const askSource = async (source: IAccessTokenSource): Promise<AccessTokenResult> => {
  try {
    return await source.obtainAccessToken();
  } catch {
    return NOT_OBTAINED;
  }
};

export const createCachingTokenSource = (source: IAccessTokenSource, options: ICachingOptions): IAccessTokenSource => {
  let held: IHeldAccessToken | undefined;
  let inFlight: Promise<AccessTokenResult> | undefined;
  const nowMs = (): number => options.now().getTime();
  const request = async (): Promise<AccessTokenResult> => {
    const result = await askSource(source);
    inFlight = undefined;
    held = holdable(result, nowMs());
    return result;
  };
  return {
    obtainAccessToken(): Promise<AccessTokenResult> {
      if (held !== undefined && nowMs() < held.renewAtMs) {
        return Promise.resolve({ obtained: true, accessToken: held.accessToken });
      }
      inFlight ??= request();
      return inFlight;
    },
    reportAccessTokenRefused(accessToken: string): void {
      if (held?.accessToken === accessToken) held = undefined;
    },
  };
};
