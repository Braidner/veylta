import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { migrateDown, migrateUp } from "../src/database/migrations.js";
import type { Database } from "../src/database/pool.js";

const directory = fileURLToPath(new URL("../../../db/migrations/", import.meta.url));

/**
 * The migration names in apply order, read from db/migrations itself. Tests assert against the
 * files that exist rather than a copied list, so adding a migration never edits a test — the
 * runner and the suite share one source of truth: the directory.
 */
export async function migrationNames(): Promise<readonly string[]> {
  return (await readdir(directory))
    .filter((name) => name.endsWith(".up.sql"))
    .map((name) => name.slice(0, -".up.sql".length))
    .sort();
}

/** Every migration from `first` (inclusive) to the newest, in apply order. */
export async function migrationsFrom(first: string): Promise<readonly string[]> {
  const names = await migrationNames();
  const index = names.indexOf(first);
  assert.notEqual(index, -1, `${first} is not a migration`);
  return names.slice(index);
}

/**
 * Rolls back one migration at a time from the currently applied top down to and including
 * `target`, asserting that each step reverses exactly the migration the directory says comes
 * next. Returns the names reversed.
 */
export async function rollbackTo(database: Database, target: string): Promise<readonly string[]> {
  const names = await migrationNames();
  const targetIndex = names.indexOf(target);
  assert.notEqual(targetIndex, -1, `${target} is not a migration`);
  const top = (
    await database.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1",
    )
  ).rows[0]?.name;
  assert.ok(top !== undefined, "no migration is applied");
  const topIndex = names.indexOf(top);
  assert.ok(topIndex >= targetIndex, `${top} is already below ${target}`);
  const reversed: string[] = [];
  for (const name of names.slice(targetIndex, topIndex + 1).reverse()) {
    assert.equal(await migrateDown(database), name);
    reversed.push(name);
  }
  return reversed;
}

/** Applies every pending migration and asserts they are exactly the ones from `first` on. */
export async function reapplyFrom(database: Database, first: string): Promise<void> {
  assert.deepEqual(await migrateUp(database), await migrationsFrom(first));
}
