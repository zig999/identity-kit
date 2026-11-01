import { z } from 'zod';

export const JsonWebKeySchema = z.looseObject({
  kty: z.string(),
  kid: z.string().exactOptional(),
  use: z.string().exactOptional(),
  alg: z.string().exactOptional(),
  crv: z.string().exactOptional(),
  n: z.string().exactOptional(),
  e: z.string().exactOptional(),
  x: z.string().exactOptional(),
  y: z.string().exactOptional(),
});

export const JsonWebKeySetSchema = z.looseObject({ keys: z.array(z.unknown()) });

export type KeySetKey = z.infer<typeof JsonWebKeySchema>;

export interface IKeySetLoad {
  readonly refresh: boolean;
}

export interface IKeySetSource {
  load(options: IKeySetLoad): Promise<readonly KeySetKey[]>;
}
