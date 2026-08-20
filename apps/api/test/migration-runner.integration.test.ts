import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateDown, migrateUp } from "../src/database/migrations.js";
import { createDatabase, type Database } from "../src/database/pool.js";

/**
 * A parent whose CHECK must widen and a child that references it — document_blobs and
 * document_versions in miniature. SQLite cannot widen a CHECK in place, so the only sanctioned
 * way through is the manual's table rebuild, which drops a table its children still point at.
 */
const base = `
CREATE TABLE parents (
  id TEXT PRIMARY KEY,
  size INTEGER NOT NULL CHECK (size BETWEEN 1 AND 10)
);
CREATE TABLE children (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES parents(id) ON DELETE RESTRICT
);
`;

/** The manual's procedure: build the widened table, copy every row, drop the old one, rename. */
function rebuild(high: number, copied = "SELECT * FROM parents"): string {
  return `
CREATE TABLE parents_rebuilt (
  id TEXT PRIMARY KEY,
  size INTEGER NOT NULL CHECK (size BETWEEN 1 AND ${high})
);
INSERT INTO parents_rebuilt ${copied};
DROP TABLE parents;
ALTER TABLE parents_rebuilt RENAME TO parents;
`;
}

/** A folder the runner reads, filled one migration at a time so a step can run against data. */
interface MigrationFolder {
  add(name: string, sql: string): Promise<void>;
  up(): Promise<readonly string[]>;
  down(): Promise<string | null>;
}

async function withMigrations(
  operation: (database: Database, migrations: MigrationFolder) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "veylta-migration-runner-"));
  const directory = join(root, "migrations");
  await mkdir(directory);
  const database = createDatabase(join(root, "test.sqlite"));
  try {
    await operation(database, {
      add: (name, sql) => writeFile(join(directory, name), sql, "utf8"),
      up: () => migrateUp(database, directory),
      down: () => migrateDown(database, directory),
    });
  } finally {
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
}

/** The base schema applied, with one parent and the child that points at it. */
async function seeded(database: Database, migrations: MigrationFolder): Promise<void> {
  await migrations.add("0001_base.up.sql", base);
  assert.deepEqual(await migrations.up(), ["0001_base"]);
  await database.transaction(async (client) => {
    await client.query("INSERT INTO parents (id, size) VALUES ('p-1', 4)");
    await client.query("INSERT INTO children (id, parent_id) VALUES ('c-1', 'p-1')");
  });
}

/** The upper bound the live `parents` CHECK states. */
async function ceiling(database: Database): Promise<number> {
  const definition = (
    await database.query<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'parents'",
    )
  ).rows[0]?.sql;
  assert.ok(definition !== undefined, "parents is missing");
  const bound = /size BETWEEN \d+ AND (\d+)/.exec(definition);
  assert.ok(bound !== null, "parents carries no BETWEEN bound");
  return Number(bound[1]);
}

/** Whether this connection is enforcing foreign keys right now. */
async function enforcing(database: Database): Promise<boolean> {
  const rows = (await database.query<{ foreign_keys: number }>("PRAGMA foreign_keys")).rows;
  return rows[0]?.foreign_keys === 1;
}

test("a migration may rebuild a table its children still reference", async () => {
  await withMigrations(async (database, migrations) => {
    await seeded(database, migrations);

    await migrations.add("0002_widen.up.sql", rebuild(100));
    assert.deepEqual(await migrations.up(), ["0002_widen"]);

    assert.equal(await ceiling(database), 100);
    // The child kept its parent, and nothing in the database dangles.
    assert.deepEqual(
      (await database.query<{ parent_id: string }>("SELECT parent_id FROM children")).rows,
      [{ parent_id: "p-1" }],
    );
    assert.deepEqual((await database.query("PRAGMA foreign_key_check")).rows, []);
    assert.ok(await enforcing(database), "enforcement must be restored after a migration");

    // The widened bound is live, not merely printed in the schema.
    await database.query("INSERT INTO parents (id, size) VALUES ('p-2', 50)");
    assert.equal(
      (await database.query<{ size: number }>("SELECT size FROM parents WHERE id = 'p-2'")).rows[0]
        ?.size,
      50,
    );
  });
});

test("a migration that leaves a dangling reference is refused and rolled back", async () => {
  await withMigrations(async (database, migrations) => {
    await seeded(database, migrations);

    // The copy skips every parent, so the child that pointed at one now points at nothing.
    await migrations.add("0002_losing.up.sql", rebuild(100, "SELECT * FROM parents WHERE 0"));
    await assert.rejects(
      migrations.up(),
      /dangling foreign key references: children -> parents/,
      "the whole-database check is the gate a migration must pass before it commits",
    );

    // Nothing of the refused migration survives: not its row, not its schema, not its losses.
    assert.deepEqual(
      (await database.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name"))
        .rows,
      [{ name: "0001_base" }],
    );
    assert.equal(await ceiling(database), 10);
    assert.deepEqual((await database.query<{ id: string }>("SELECT id FROM parents")).rows, [
      { id: "p-1" },
    ]);
    assert.ok(await enforcing(database), "enforcement must be restored after a refusal");
  });
});

test("enforcement returns even when a migration fails on its own SQL", async () => {
  await withMigrations(async (database, migrations) => {
    await seeded(database, migrations);

    await migrations.add("0002_broken.up.sql", "INSERT INTO nowhere (id) VALUES ('x');");
    await assert.rejects(migrations.up(), /nowhere/);

    assert.ok(await enforcing(database), "enforcement must be restored after a throw");
    // The pragma reading 1 is not the proof — a refused orphan is.
    await assert.rejects(
      database.query("INSERT INTO children (id, parent_id) VALUES ('c-2', 'p-missing')"),
      /FOREIGN KEY constraint failed/,
    );
  });
});

test("a down migration rebuilds under the same rule", async () => {
  await withMigrations(async (database, migrations) => {
    await seeded(database, migrations);
    await migrations.add("0002_widen.up.sql", rebuild(100));
    await migrations.add("0002_widen.down.sql", rebuild(10));
    await migrations.up();

    assert.equal(await migrations.down(), "0002_widen");
    assert.equal(await ceiling(database), 10);
    assert.deepEqual(
      (await database.query<{ parent_id: string }>("SELECT parent_id FROM children")).rows,
      [{ parent_id: "p-1" }],
    );
    assert.ok(await enforcing(database), "enforcement must be restored after a rollback");
  });
});
