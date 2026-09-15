export class CollectionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CollectionError';
    this.code = code;
  }
}
export function requireCondition(condition, code) {
  if (!condition) throw new CollectionError(code);
}
