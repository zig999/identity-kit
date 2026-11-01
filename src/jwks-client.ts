import type { IKeySetSource } from './key-set.js';
import { notImplemented } from './not-implemented.js';

export interface IJwksClientDeps {
  readonly issuer: string;
  readonly now: () => Date;
  readonly requestHeaders?: () => Readonly<Record<string, string>>;
}

export const createJwksClient = (_deps: IJwksClientDeps): IKeySetSource => notImplemented('createJwksClient');
