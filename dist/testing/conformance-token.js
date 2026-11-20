import { OPERATION_TYPES } from '../claims.js';
import { TestSupportError } from './test-support-error.js';
const BEARER_PREFIX = 'Bearer ';
const MILLISECONDS_PER_SECOND = 1000;
const EXPIRY_NOT_NUMERIC = 'The test issuer built claims whose exp is not a number';
const accessRightsOf = (resources, operations) => Object.fromEntries(resources.map((resource) => [resource, [...operations]]));
export const issueConformanceToken = (issuer, audience, options = {}) => {
    const accessRights = accessRightsOf(options.resources ?? [], options.operations ?? OPERATION_TYPES);
    const claims = issuer.claims(audience, { accessRights });
    const { exp } = claims;
    if (typeof exp !== 'number')
        throw new TestSupportError(EXPIRY_NOT_NUMERIC);
    return {
        bearerToken: `${BEARER_PREFIX}${issuer.issue(claims)}`,
        expiresAt: new Date(exp * MILLISECONDS_PER_SECOND),
    };
};
