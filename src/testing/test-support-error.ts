export class TestSupportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestSupportError';
  }
}
