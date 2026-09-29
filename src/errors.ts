export class CollectionError extends Error {
  readonly code: string;
  constructor(code: string, readonly httpStatus?: number) {
    super(code);
    this.name = 'CollectionError';
    this.code = code;
  }
}
export function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new CollectionError(code);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function errorHttpStatus(error:unknown):number|undefined {
  return isRecord(error) && typeof error.httpStatus==='number'?error.httpStatus:undefined;
}
