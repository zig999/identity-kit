import type { z } from 'zod';

import { notImplemented } from './not-implemented.js';

export const OPERATION_TYPES = ['create', 'read', 'update', 'delete', 'discover'] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];

export interface IClaims {
  readonly iss: string;
  readonly aud: string | readonly string[];
  readonly exp: number;
  readonly nbf?: number;
  readonly sub?: string;
  readonly azp?: string;
  readonly roles?: readonly string[];
  readonly accessRights?: Readonly<Record<string, readonly OperationType[]>>;
  readonly predefinedFilters?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly [claim: string]: unknown;
}

export interface IClaimsDefinition {
  readonly resources: readonly string[];
}

export const defineClaimsSchema = (_definition: IClaimsDefinition): z.ZodType<IClaims> =>
  notImplemented('defineClaimsSchema');
