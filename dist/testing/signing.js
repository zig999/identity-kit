import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { JsonWebKeySchema } from '../key-set.js';
const RSA_MODULUS_BITS = 2048;
const FIXED_WIDTH_SIGNATURE_ENCODING = 'ieee-p1363';
const BASE64URL = 'base64url';
const EC_PREFIX = 'ES';
const DIGESTS = {
    RS256: 'sha256',
    RS384: 'sha384',
    RS512: 'sha512',
    ES256: 'sha256',
    ES384: 'sha384',
    ES512: 'sha512',
};
const CURVES = { ES256: 'P-256', ES384: 'P-384', ES512: 'P-521' };
const encodeSegment = (value) => Buffer.from(JSON.stringify(value)).toString(BASE64URL);
const isEc = (alg) => alg.startsWith(EC_PREFIX);
const keyPairFor = (alg) => isEc(alg)
    ? generateKeyPairSync('ec', { namedCurve: CURVES[alg] })
    : generateKeyPairSync('rsa', { modulusLength: RSA_MODULUS_BITS });
export const generateSigningKey = (kid, alg = 'ES256') => {
    const { privateKey, publicKey } = keyPairFor(alg);
    const jwk = JsonWebKeySchema.parse({ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg });
    return { kid, alg, privateKey, jwk };
};
export const signTokenWithHeader = (claims, key, header) => {
    const signedPart = `${encodeSegment(header)}.${encodeSegment(claims)}`;
    const options = isEc(key.alg)
        ? { key: key.privateKey, dsaEncoding: FIXED_WIDTH_SIGNATURE_ENCODING }
        : { key: key.privateKey };
    return `${signedPart}.${sign(DIGESTS[key.alg], Buffer.from(signedPart), options).toString(BASE64URL)}`;
};
export const signToken = (claims, key, kid = key.kid) => signTokenWithHeader(claims, key, { alg: key.alg, typ: 'JWT', kid });
export const unsignedToken = (claims) => `${encodeSegment({ alg: 'none', typ: 'JWT' })}.${encodeSegment(claims)}.`;
export const hmacToken = (claims, secret, kid) => {
    const header = kid === undefined ? { alg: 'HS256', typ: 'JWT' } : { alg: 'HS256', typ: 'JWT', kid };
    const signedPart = `${encodeSegment(header)}.${encodeSegment(claims)}`;
    return `${signedPart}.${createHmac('sha256', secret).update(signedPart).digest(BASE64URL)}`;
};
export const tokenWithSegments = (header, payload, signature = 'c2ln') => `${encodeSegment(header)}.${encodeSegment(payload)}.${signature}`;
