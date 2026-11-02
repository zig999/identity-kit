import { createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
const SEGMENT_SEPARATOR = '.';
const MILLISECONDS_PER_SECOND = 1000;
const SIGNING_KEY_USE = 'sig';
const FIXED_WIDTH_SIGNATURE_ENCODING = 'ieee-p1363';
const BASE64URL = 'base64url';
const UTF8 = 'utf8';
const REFRESH_ATTEMPTS = [false, true];
const ALGORITHM_NAMES = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'];
const SIGNATURE_ALGORITHMS = {
    RS256: { digest: 'sha256', keyType: 'RSA' },
    RS384: { digest: 'sha384', keyType: 'RSA' },
    RS512: { digest: 'sha512', keyType: 'RSA' },
    ES256: { digest: 'sha256', keyType: 'EC', curve: 'P-256' },
    ES384: { digest: 'sha384', keyType: 'EC', curve: 'P-384' },
    ES512: { digest: 'sha512', keyType: 'EC', curve: 'P-521' },
};
const HeaderSchema = z.looseObject({ alg: z.string(), kid: z.string().exactOptional() });
const PayloadSchema = z.record(z.string(), z.unknown());
const decodeJson = (segment) => {
    try {
        return JSON.parse(Buffer.from(segment, BASE64URL).toString(UTF8));
    }
    catch {
        return undefined;
    }
};
const splitToken = (token) => {
    const [headerPart, payloadPart, signaturePart, ...rest] = token.split(SEGMENT_SEPARATOR);
    if (headerPart === undefined || payloadPart === undefined || signaturePart === undefined || rest.length > 0) {
        return undefined;
    }
    const header = HeaderSchema.safeParse(decodeJson(headerPart));
    const payload = PayloadSchema.safeParse(decodeJson(payloadPart));
    if (!header.success || !payload.success)
        return undefined;
    return {
        alg: header.data.alg,
        kid: header.data.kid,
        payload: payload.data,
        signedData: Buffer.from(`${headerPart}${SEGMENT_SEPARATOR}${payloadPart}`),
        signature: Buffer.from(signaturePart, BASE64URL),
    };
};
const algorithmOf = (alg) => {
    const name = ALGORITHM_NAMES.find((candidate) => candidate === alg);
    return name === undefined ? undefined : SIGNATURE_ALGORITHMS[name];
};
const candidateKeys = (keys, parsed, algorithm) => keys.filter((key) => key.kty === algorithm.keyType &&
    (algorithm.curve === undefined || key.crv === algorithm.curve) &&
    (key.use === undefined || key.use === SIGNING_KEY_USE) &&
    (key.alg === undefined || key.alg === parsed.alg) &&
    (parsed.kid === undefined || key.kid === parsed.kid));
const signatureMatches = (key, algorithm, parsed) => {
    try {
        return verify(algorithm.digest, parsed.signedData, { key: createPublicKey({ key, format: 'jwk' }), dsaEncoding: FIXED_WIDTH_SIGNATURE_ENCODING }, parsed.signature);
    }
    catch {
        return false;
    }
};
const signatureHolds = async (keySet, parsed, algorithm) => {
    for (const refresh of REFRESH_ATTEMPTS) {
        const candidates = candidateKeys(await keySet.load({ refresh }), parsed, algorithm);
        if (candidates.length > 0) {
            return candidates.some((key) => signatureMatches(key, algorithm, parsed));
        }
    }
    return false;
};
const audienceCarries = (audience, expected) => typeof audience === 'string' ? audience === expected : audience.includes(expected);
const claimsRefusal = (claims, deps, audience) => {
    const nowMs = deps.now().getTime();
    const leewayMs = (deps.leewaySeconds ?? 0) * MILLISECONDS_PER_SECOND;
    if (claims.iss !== deps.issuer)
        return 'issuer';
    if (!audienceCarries(claims.aud, audience))
        return 'audience';
    if (claims.exp * MILLISECONDS_PER_SECOND + leewayMs <= nowMs)
        return 'expired';
    if (claims.nbf !== undefined && claims.nbf * MILLISECONDS_PER_SECOND - leewayMs > nowMs)
        return 'not-yet-valid';
    return undefined;
};
const refusalOf = async (parsed, deps, audience) => {
    if (parsed === undefined)
        return { reason: 'malformed' };
    const algorithm = algorithmOf(parsed.alg);
    if (algorithm === undefined)
        return { reason: 'algorithm' };
    const claims = deps.claims.safeParse(parsed.payload);
    if (!claims.success)
        return { reason: 'claims' };
    const reason = claimsRefusal(claims.data, deps, audience);
    if (reason !== undefined)
        return { reason };
    return (await signatureHolds(deps.keySet, parsed, algorithm)) ? { claims: claims.data } : { reason: 'signature' };
};
export const createTokenVerifier = (deps) => ({
    async verify(token, audience) {
        const outcome = await refusalOf(splitToken(token), deps, audience);
        if ('claims' in outcome)
            return outcome.claims;
        deps.onRefusal?.(outcome.reason);
        return undefined;
    },
});
