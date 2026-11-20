import type { OperationType } from '../claims.js';
import type { ITestIssuer } from './test-issuer.js';
export interface IConformanceTokenOptions {
    readonly resources?: readonly string[];
    readonly operations?: readonly OperationType[];
}
export interface IConformanceToken {
    readonly bearerToken: string;
    readonly expiresAt: Date;
}
export declare const issueConformanceToken: (issuer: ITestIssuer, audience: string, options?: IConformanceTokenOptions) => IConformanceToken;
