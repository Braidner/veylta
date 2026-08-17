/**
 * Per-key in-process serialization: operations under one key run one after another, keys do
 * not wait on each other. Used where a model call must not race a second turn of the same
 * conversation, on top of (never instead of) the database's own transaction.
 */
export function createSerializer(): <T>(key: string, operation: () => Promise<T>) => Promise<T> {
  const locks = new Map<string, Promise<unknown>>();
  return async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    locks.set(key, current);
    try {
      return await current;
    } finally {
      if (locks.get(key) === current) locks.delete(key);
    }
  };
}
