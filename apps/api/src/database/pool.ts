import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

export interface QueryResult<Row extends object> {
  rows: Row[];
  rowCount: number;
}

export interface DatabaseClient {
  exec(sql: string): Promise<void>;
  query<Row extends object>(sql: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
}

export interface ReadinessProbe {
  check(): Promise<void>;
}

type ConstraintKind = "check" | "foreign-key" | "not-null" | "trigger" | "unique";

const requiredSchemaMigration = "0021_codex_preferences";

const constraintCodes: Record<ConstraintKind, ReadonlySet<number>> = {
  check: new Set([275]),
  "foreign-key": new Set([787]),
  "not-null": new Set([1299]),
  trigger: new Set([1811]),
  unique: new Set([1555, 2067]),
};

function sqliteErrorCode(error: unknown): number | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("errcode" in error) ||
    typeof error.errcode !== "number"
  ) {
    return null;
  }
  return error.errcode;
}

export function isSqliteConstraintError(error: unknown, kind?: ConstraintKind): boolean {
  const code = sqliteErrorCode(error);
  if (code === null || (code & 0xff) !== 19) return false;
  return kind === undefined || constraintCodes[kind].has(code);
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

function execute<Row extends object>(
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

class TransactionClient implements DatabaseClient {
  private active = true;

  constructor(private readonly database: DatabaseSync) {}

  release(): void {
    this.active = false;
  }

  private requireActive(): void {
    if (!this.active) throw new Error("Transaction client is no longer active");
  }

  async exec(sql: string): Promise<void> {
    this.requireActive();
    this.database.exec(sql);
  }

  async query<Row extends object>(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.requireActive();
    return execute<Row>(this.database, sql, values);
  }
}

export class Database implements DatabaseClient {
  private readonly database: DatabaseSync;
  private queue: Promise<void> = Promise.resolve();
  private closing = false;
  private closePromise: Promise<void> | null = null;

  constructor(path: string) {
    if (path.length === 0) throw new Error("Database path must not be empty");
    if (path !== ":memory:") {
      const directory = dirname(path);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    this.database = new DatabaseSync(path);
    try {
      this.database.exec("PRAGMA foreign_keys = ON");
      this.database.exec("PRAGMA busy_timeout = 5000");
      this.database.exec("PRAGMA journal_mode = WAL");
      this.database.exec("PRAGMA synchronous = NORMAL");
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error("Database is closed"));
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  exec(sql: string): Promise<void> {
    return this.enqueue(() => this.database.exec(sql));
  }

  query<Row extends object>(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return this.enqueue(() => execute<Row>(this.database, sql, values));
  }

  transaction<T>(operation: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      this.database.exec("BEGIN IMMEDIATE");
      const client = new TransactionClient(this.database);
      try {
        const result = await operation(client);
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async check(): Promise<void> {
    const [foundation, currentSchema] = await Promise.all([
      this.query<{ value: string }>(
        "SELECT value FROM service_metadata WHERE key = 'foundation_version'",
      ),
      this.query<{ name: string }>("SELECT name FROM schema_migrations WHERE name = $1", [
        requiredSchemaMigration,
      ]),
    ]);
    if (foundation.rows[0]?.value !== "1") {
      throw new Error("Database foundation migration is not available");
    }
    if (currentSchema.rows[0]?.name !== requiredSchemaMigration) {
      throw new Error("Current database schema migration is not available");
    }
  }

  close(): Promise<void> {
    if (this.closePromise !== null) return this.closePromise;
    this.closing = true;
    this.closePromise = this.queue.then(() => {
      try {
        this.database.exec("PRAGMA optimize");
      } finally {
        this.database.close();
      }
    });
    return this.closePromise;
  }
}

export function createDatabase(path: string): Database {
  return new Database(path);
}

export function databaseReadiness(database: Database): ReadinessProbe {
  return { check: () => database.check() };
}
