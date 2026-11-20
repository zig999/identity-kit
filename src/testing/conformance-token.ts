import { OPERATION_TYPES } from '../claims.js';
import type { OperationType } from '../claims.js';
import type { ITestIssuer } from './test-issuer.js';
import { TestSupportError } from './test-support-error.js';

const BEARER_PREFIX = 'Bearer ';
const MILLISECONDS_PER_SECOND = 1000;
const EXPIRY_NOT_NUMERIC = 'The test issuer built claims whose exp is not a number';

export interface IConformanceTokenOptions {
  readonly resources?: readonly string[];
  readonly operations?: readonly OperationType[];
}

export interface IConformanceToken {
  readonly bearerToken: string;
  readonly expiresAt: Date;
}

const accessRightsOf = (
  resources: readonly string[],
  operations: readonly OperationType[],
): Record<string, OperationType[]> =>
  Object.fromEntries(resources.map((resource): [string, OperationType[]] => [resource, [...operations]]));

export const issueConformanceToken = (
  issuer: ITestIssuer,
  audience: string,
  options: IConformanceTokenOptions = {},
): IConformanceToken => {
  const accessRights = accessRightsOf(options.resources ?? [], options.operations ?? OPERATION_TYPES);
  const claims = issuer.claims(audience, { accessRights });
  const { exp } = claims;
  if (typeof exp !== 'number') throw new TestSupportError(EXPIRY_NOT_NUMERIC);
  return {
    bearerToken: `${BEARER_PREFIX}${issuer.issue(claims)}`,
    expiresAt: new Date(exp * MILLISECONDS_PER_SECOND),
  };
};
