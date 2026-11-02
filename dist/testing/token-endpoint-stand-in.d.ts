import type { IncomingHttpHeaders } from 'node:http';
export interface ITokenEndpointAnswer {
    readonly status: number;
    readonly body: string;
}
export interface IRecordedTokenRequest {
    readonly method: string;
    readonly headers: IncomingHttpHeaders;
    readonly body: string;
}
export interface ITokenEndpointStandIn {
    readonly url: string;
    readonly requests: IRecordedTokenRequest[];
    answerWith(answer: ITokenEndpointAnswer): void;
    neverAnswer(): void;
    close(): Promise<void>;
}
export declare const tokenAnswer: (body: unknown, status?: number) => ITokenEndpointAnswer;
export declare const createTokenEndpointStandIn: () => Promise<ITokenEndpointStandIn>;
