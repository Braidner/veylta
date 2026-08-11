import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Pool, PoolClient } from "pg";
import { loadConfig } from "../config.js";
import { createPool } from "./pool.js";

const defaultDirectory = fileURLToPath(new URL("../../../../db/migrations/", import.meta.url));

async function inTransaction(client: PoolClient, operation: () => Promise<void>): Promise<void> {
  await client.query("BEGIN");
  try {
    await operation();
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function ensureMigrationTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function migrateUp(pool: Pool, directory = defaultDirectory): Promise<string[]> {
  await ensureMigrationTable(pool);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".up.sql")).sort();
  const applied = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  const appliedNames = new Set(applied.rows.map(({ name }) => name));
  const completed: string[] = [];

  for (const file of files) {
    const migrationName = file.slice(0, -".up.sql".length);
    if (appliedNames.has(migrationName)) continue;
    const sql = await readFile(`${directory}/${file}`, "utf8");
    const client = await pool.connect();
    try {
      await inTransaction(client, async () => {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migrationName]);
      });
      completed.push(migrationName);
    } finally {
      client.release();
    }
  }

  return completed;
}

export async function migrateDown(
  pool: Pool,
  directory = defaultDirectory,
): Promise<string | null> {
  await ensureMigrationTable(pool);
  const latest = await pool.query<{ name: string }>(
    "SELECT name FROM schema_migrations ORDER BY applied_at DESC, name DESC LIMIT 1",
  );
  const migrationName = latest.rows[0]?.name;
  if (migrationName === undefined) return null;

  const sql = await readFile(`${directory}/${migrationName}.down.sql`, "utf8");
  const client = await pool.connect();
  try {
    await inTransaction(client, async () => {
      await client.query(sql);
      await client.query("DELETE FROM schema_migrations WHERE name = $1", [migrationName]);
    });
  } finally {
    client.release();
  }
  return migrationName;
}

async function run(): Promise<void> {
  const direction = process.argv[2];
  if (direction !== "up" && direction !== "down") {
    throw new Error("Expected migration direction: up or down");
  }
  const pool = createPool(loadConfig().databaseUrl);
  try {
    const result = direction === "up" ? await migrateUp(pool) : await migrateDown(pool);
    console.log(JSON.stringify({ service: "migrations", direction, result }));
  } finally {
    await pool.end();
  }
}

const isCli =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown migration error";
    console.error(JSON.stringify({ service: "migrations", status: "failed", message }));
    process.exitCode = 1;
  });
}
