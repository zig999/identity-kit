import type { IAccessTokenSource } from './access-token-source.js';
export interface ICachingOptions {
    readonly now: () => Date;
}
export declare const createCachingTokenSource: (source: IAccessTokenSource, options: ICachingOptions) => IAccessTokenSource;
