import { z } from 'zod';
export declare const JsonWebKeySchema: z.ZodObject<{
    kty: z.ZodString;
    kid: z.ZodExactOptional<z.ZodString>;
    use: z.ZodExactOptional<z.ZodString>;
    alg: z.ZodExactOptional<z.ZodString>;
    crv: z.ZodExactOptional<z.ZodString>;
    n: z.ZodExactOptional<z.ZodString>;
    e: z.ZodExactOptional<z.ZodString>;
    x: z.ZodExactOptional<z.ZodString>;
    y: z.ZodExactOptional<z.ZodString>;
}, z.core.$loose>;
export declare const JsonWebKeySetSchema: z.ZodObject<{
    keys: z.ZodArray<z.ZodUnknown>;
}, z.core.$loose>;
export type KeySetKey = z.infer<typeof JsonWebKeySchema>;
export interface IKeySetLoad {
    readonly refresh: boolean;
}
export interface IKeySetSource {
    load(options: IKeySetLoad): Promise<readonly KeySetKey[]>;
}
