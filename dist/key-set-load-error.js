export class KeySetLoadError extends Error {
    context;
    constructor(message, context, cause) {
        super(message, { cause });
        this.name = 'KeySetLoadError';
        this.context = context;
    }
}
