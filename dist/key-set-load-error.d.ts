export interface IKeySetLoadContext {
    readonly operation: string;
    readonly status?: number;
}
export declare class KeySetLoadError extends Error {
    readonly context: IKeySetLoadContext;
    constructor(message: string, context: IKeySetLoadContext, cause: unknown);
}
