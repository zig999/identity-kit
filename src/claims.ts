import { z } from 'zod';

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

const onlyNamed =
  (resources: readonly string[]) =>
  (record: Readonly<Record<string, unknown>>): boolean =>
    Object.keys(record).every((key) => resources.includes(key));

export const defineClaimsSchema = (definition: IClaimsDefinition): z.ZodType<IClaims> => {
  const declared = onlyNamed(definition.resources);
  return z.looseObject({
    iss: z.string(),
    aud: z.union([z.string(), z.array(z.string())]),
    exp: z.number(),
    nbf: z.number().exactOptional(),
    sub: z.string().exactOptional(),
    azp: z.string().exactOptional(),
    roles: z.array(z.string()).exactOptional(),
    accessRights: z
      .record(z.string(), z.array(z.enum(OPERATION_TYPES)))
      .refine(declared)
      .exactOptional(),
    predefinedFilters: z.record(z.string(), z.record(z.string(), z.string())).refine(declared).exactOptional(),
  });
};
