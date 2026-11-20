export class TestSupportError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TestSupportError';
    }
}
