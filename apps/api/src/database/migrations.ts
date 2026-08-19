import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import { backfillProfileHandles } from "../family/patient-profiles.js";
import { createDatabase, type Database } from "./pool.js";

const defaultDirectory = fileURLToPath(new URL("../../../../db/migrations/", import.meta.url));

async function ensureMigrationTable(database: Database): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
}

export async function migrateUp(
  database: Database,
  directory = defaultDirectory,
): Promise<string[]> {
  await ensureMigrationTable(database);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".up.sql")).sort();
  const applied = await database.query<{ name: string }>("SELECT name FROM schema_migrations");
  const appliedNames = new Set(applied.rows.map(({ name }) => name));
  const completed: string[] = [];

  for (const file of files) {
    const migrationName = file.slice(0, -".up.sql".length);
    if (appliedNames.has(migrationName)) continue;
    const sql = await readFile(`${directory}/${file}`, "utf8");
    await database.transaction(async (client) => {
      await client.exec(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migrationName]);
    });
    completed.push(migrationName);
  }

  return completed;
}

export async function migrateDown(
  database: Database,
  directory = defaultDirectory,
): Promise<string | null> {
  await ensureMigrationTable(database);
  const latest = await database.query<{ name: string }>(
    "SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1",
  );
  const migrationName = latest.rows[0]?.name;
  if (migrationName === undefined) return null;

  const sql = await readFile(`${directory}/${migrationName}.down.sql`, "utf8");
  await database.transaction(async (client) => {
    await client.exec(sql);
    await client.query("DELETE FROM schema_migrations WHERE name = $1", [migrationName]);
  });
  return migrationName;
}

async function run(): Promise<void> {
  const direction = process.argv[2];
  if (direction !== "up" && direction !== "down") {
    throw new Error("Expected migration direction: up or down");
  }
  const database = createDatabase(loadConfig().databasePath);
  try {
    const result = direction === "up" ? await migrateUp(database) : await migrateDown(database);
    const backfilled = direction === "up" ? await backfillProfileHandles(database) : 0;
    console.log(JSON.stringify({ service: "migrations", direction, result, backfilled }));
  } finally {
    await database.close();
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
