import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

import { JsonWebKeySchema } from '../../src/key-set.js';
import type { KeySetKey } from '../../src/key-set.js';

const RSA_MODULUS_BITS = 2048;
const FIXED_WIDTH_SIGNATURE_ENCODING = 'ieee-p1363' as const;

export type RsaAlgorithm = 'RS256' | 'RS384' | 'RS512';
export type EcAlgorithm = 'ES256' | 'ES384' | 'ES512';
export type SigningAlgorithm = RsaAlgorithm | EcAlgorithm;

export interface ISigningKey {
  readonly kid: string;
  readonly alg: SigningAlgorithm;
  readonly privateKey: KeyObject;
  readonly jwk: KeySetKey;
}

export type TokenClaims = Readonly<Record<string, unknown>>;

const DIGESTS: Readonly<Record<SigningAlgorithm, string>> = {
  RS256: 'sha256',
  RS384: 'sha384',
  RS512: 'sha512',
  ES256: 'sha256',
  ES384: 'sha384',
  ES512: 'sha512',
};

const CURVES: Readonly<Record<EcAlgorithm, string>> = { ES256: 'P-256', ES384: 'P-384', ES512: 'P-521' };

const encodeSegment = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export const generateRsaKey = (kid: string, alg: RsaAlgorithm = 'RS256'): ISigningKey => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: RSA_MODULUS_BITS });
  const jwk = JsonWebKeySchema.parse({ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg });
  return { kid, alg, privateKey, jwk };
};

export const generateEcKey = (kid: string, alg: EcAlgorithm = 'ES256'): ISigningKey => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: CURVES[alg] });
  const jwk = JsonWebKeySchema.parse({ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg });
  return { kid, alg, privateKey, jwk };
};

export const signTokenWithHeader = (
  claims: TokenClaims,
  key: ISigningKey,
  header: Readonly<Record<string, unknown>>,
): string => {
  const signedPart = `${encodeSegment(header)}.${encodeSegment(claims)}`;
  const options = key.alg.startsWith('ES')
    ? { key: key.privateKey, dsaEncoding: FIXED_WIDTH_SIGNATURE_ENCODING }
    : { key: key.privateKey };
  return `${signedPart}.${sign(DIGESTS[key.alg], Buffer.from(signedPart), options).toString('base64url')}`;
};

export const signToken = (claims: TokenClaims, key: ISigningKey, kid: string = key.kid): string =>
  signTokenWithHeader(claims, key, { alg: key.alg, typ: 'JWT', kid });

export const unsignedToken = (claims: TokenClaims): string =>
  `${encodeSegment({ alg: 'none', typ: 'JWT' })}.${encodeSegment(claims)}.`;

export const hmacToken = (claims: TokenClaims, secret: string, kid?: string): string => {
  const header = kid === undefined ? { alg: 'HS256', typ: 'JWT' } : { alg: 'HS256', typ: 'JWT', kid };
  const signedPart = `${encodeSegment(header)}.${encodeSegment(claims)}`;
  return `${signedPart}.${createHmac('sha256', secret).update(signedPart).digest('base64url')}`;
};

export const tokenWithSegments = (header: unknown, payload: unknown, signature = 'c2ln'): string =>
  `${encodeSegment(header)}.${encodeSegment(payload)}.${signature}`;
