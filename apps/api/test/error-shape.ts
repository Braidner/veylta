/** A route error body reduced to the fields worth comparing, for `assert.deepEqual` in tests. */
export function errorShape(response: { json(): unknown; statusCode: number }): unknown {
  const body = response.json() as {
    error: { code: string; details: unknown[]; message: string; requestId: string };
  };
  return {
    statusCode: response.statusCode,
    code: body.error.code,
    message: body.error.message,
    details: body.error.details,
  };
}
