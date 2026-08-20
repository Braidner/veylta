import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execute, type QueryResult } from "./statements.js";

export type { QueryResult };

/** Anything a read may run on: the pool itself, or one client inside a transaction. */
export interface Queryable {
  query<Row extends object>(sql: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
}

export interface DatabaseClient extends Queryable {
  exec(sql: string): Promise<void>;
}

export interface ReadinessProbe {
  check(): Promise<void>;
}

type ConstraintKind = "check" | "foreign-key" | "not-null" | "trigger" | "unique";

const requiredSchemaMigration = "0042_document_page_reread";

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

  private async runTransaction<T>(operation: (client: DatabaseClient) => Promise<T>): Promise<T> {
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
  }

  transaction<T>(operation: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return this.enqueue(() => this.runTransaction(operation));
  }

  /**
   * One schema change, run the way the SQLite manual prescribes for the table rebuilds no ALTER
   * TABLE can express: enforcement off, rebuild, `PRAGMA foreign_key_check`, commit, enforcement
   * back. Dropping a table its children still reference is itself a violation while enforcement
   * is on, and the pragma is a no-op inside a transaction — so the whole dance is one queued
   * operation and no other work on this connection ever sees enforcement lifted. The check reads
   * the whole database rather than the rows the change touched: a stricter gate than the
   * enforcement it stands in for, and the change is refused if it reports a single row.
   */
  schemaChange<T>(operation: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      this.database.exec("PRAGMA foreign_keys = OFF");
      try {
        return await this.runTransaction(async (client) => {
          const result = await operation(client);
          const { rows } = await client.query<{ parent: string; table: string }>(
            "PRAGMA foreign_key_check",
          );
          // One broken reference reports once per orphaned row; name each pair once.
          const dangling = [...new Set(rows.map(({ parent, table }) => `${table} -> ${parent}`))];
          if (dangling.length > 0) {
            throw new Error(
              `Schema change left dangling foreign key references: ${dangling.join(", ")}`,
            );
          }
          return result;
        });
      } finally {
        this.database.exec("PRAGMA foreign_keys = ON");
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
