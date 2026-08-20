import type { DatabaseSync, StatementSync } from "node:sqlite";

export interface QueryResult<Row extends object> {
  rows: Row[];
  rowCount: number;
}

function sqliteValue(value: unknown): null | number | bigint | string | Uint8Array {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function bindings(
  sql: string,
  values: readonly unknown[],
): Record<string, ReturnType<typeof sqliteValue>> | ReturnType<typeof sqliteValue>[] {
  const normalized = values.map(sqliteValue);
  if (!/\$\d+/.test(sql)) return normalized;
  return Object.fromEntries(normalized.map((value, index) => [String(index + 1), value]));
}

/** One prepared statement run to completion: rows when it returns any, the change count when not. */
export function execute<Row extends object>(
  database: DatabaseSync,
  sql: string,
  values: readonly unknown[] = [],
): QueryResult<Row> {
  const statement: StatementSync = database.prepare(sql);
  const bound = bindings(sql, values);
  const hasNamedBindings = !Array.isArray(bound);
  if (statement.columns().length > 0) {
    const sqliteRows = hasNamedBindings ? statement.all(bound) : statement.all(...bound);
    const rows = sqliteRows.map((row) => ({ ...row })) as Row[];
    return { rows, rowCount: rows.length };
  }
  const result = hasNamedBindings ? statement.run(bound) : statement.run(...bound);
  return { rows: [], rowCount: Number(result.changes) };
}
