import { notImplemented } from '../not-implemented.js';
import type { IAccessTokenSource } from './access-token-source.js';

export interface IClientCredentialsOptions {
  readonly tokenEndpointUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly audience?: string;
  readonly scope?: string;
  readonly timeoutMs?: number;
}

export const createClientCredentialsTokenSource = (_options: IClientCredentialsOptions): IAccessTokenSource =>
  notImplemented('createClientCredentialsTokenSource');
