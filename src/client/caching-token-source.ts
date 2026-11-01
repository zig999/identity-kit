import { notImplemented } from '../not-implemented.js';
import type { IAccessTokenSource } from './access-token-source.js';

export interface ICachingOptions {
  readonly now: () => Date;
}

export const createCachingTokenSource = (_source: IAccessTokenSource, _options: ICachingOptions): IAccessTokenSource =>
  notImplemented('createCachingTokenSource');
