export interface IKeySetLoadContext {
  readonly operation: string;
  readonly status?: number;
}

export class KeySetLoadError extends Error {
  readonly context: IKeySetLoadContext;

  constructor(message: string, context: IKeySetLoadContext, cause: unknown) {
    super(message, { cause });
    this.name = 'KeySetLoadError';
    this.context = context;
  }
}
