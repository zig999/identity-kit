import type { IClaims, OperationType } from './claims.js';
import { notImplemented } from './not-implemented.js';

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

export const createCaller = (_claims: IClaims): ICaller => notImplemented('createCaller');
