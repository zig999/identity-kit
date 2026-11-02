const TOKEN_RENEWAL_MARGIN_SECONDS = 30;
const MILLISECONDS_PER_SECOND = 1000;
const NOT_OBTAINED = { obtained: false };
const holdable = (result, receivedAtMs) => {
    if (!result.obtained || result.expiresIn === undefined || !Number.isFinite(result.expiresIn))
        return undefined;
    const renewAtMs = receivedAtMs + (result.expiresIn - TOKEN_RENEWAL_MARGIN_SECONDS) * MILLISECONDS_PER_SECOND;
    return renewAtMs > receivedAtMs ? { accessToken: result.accessToken, renewAtMs } : undefined;
};
const askSource = async (source) => {
    try {
        return await source.obtainAccessToken();
    }
    catch {
        return NOT_OBTAINED;
    }
};
export const createCachingTokenSource = (source, options) => {
    let held;
    let inFlight;
    const nowMs = () => options.now().getTime();
    const request = async () => {
        const result = await askSource(source);
        inFlight = undefined;
        held = holdable(result, nowMs());
        return result;
    };
    return {
        obtainAccessToken() {
            if (held !== undefined && nowMs() < held.renewAtMs) {
                return Promise.resolve({ obtained: true, accessToken: held.accessToken });
            }
            inFlight ??= request();
            return inFlight;
        },
        reportAccessTokenRefused(accessToken) {
            if (held?.accessToken === accessToken)
                held = undefined;
        },
    };
};
