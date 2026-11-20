import { z } from 'zod';
export const OPERATION_TYPES = ['create', 'read', 'update', 'delete', 'discover'];
const onlyNamed = (resources) => (record) => Object.keys(record).every((key) => resources.includes(key));
export const defineClaimsSchema = (definition) => {
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
