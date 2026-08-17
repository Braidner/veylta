/** Runs one operation under overridden environment variables and restores them afterwards. */
export function withEnvironment(
  overrides: Record<string, string | undefined>,
  operation: () => void,
): void {
  const original = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(overrides)) {
    original.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    operation();
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
