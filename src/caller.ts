import type { IClaims, OperationType } from './claims.js';

export interface IAccessRequirement {
  readonly resource: string;
  readonly type: OperationType;
}

export interface ICaller {
  readonly claims: IClaims;
  readonly subject: string | undefined;
  readonly roles: readonly string[];
  holds(requirement: IAccessRequirement): boolean;
}

export const createCaller = (claims: IClaims): ICaller => ({
  claims,
  subject: claims.sub,
  roles: claims.roles ?? [],
  holds(requirement: IAccessRequirement): boolean {
    return claims.accessRights?.[requirement.resource]?.includes(requirement.type) === true;
  },
});
