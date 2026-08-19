import { MAX_PROFILE_HANDLE_LENGTH, type PatientProfileKind } from "@veylta/contracts";
import type { Database, DatabaseClient } from "../database/pool.js";
import { defaultHandle, withSuffix } from "./profile-handle.js";

/** The provisional handle migration 0038 gives a row that has none yet — the same expression. */
export const provisionalHandleSql = "'p-' || lower(substr(replace(id, '-', ''), 1, 12))";

// `withSuffix` clips a long base before appending `-2` … `-9999` (`"-9999"` is the longest
// possible suffix) so the result still fits the handle length bound.
const maxClippedBaseLength = MAX_PROFILE_HANDLE_LENGTH - "-9999".length;

export function isProvisionalHandle(handle: string): boolean {
  return /^p-[0-9a-f]{12}$/.test(handle);
}

export interface NewPatientProfile {
  readonly id: string;
  readonly familyId: string;
  readonly displayName: string;
  readonly kind: PatientProfileKind;
  readonly linkedUserId: string | null;
  readonly createdByUserId: string;
  readonly createdAt: string;
  /** The linked account's username when there is one — the handle's first choice. */
  readonly username: string | null;
}

async function takenHandles(client: DatabaseClient, base: string): Promise<Set<string>> {
  // One prefix match covers the exact base, every `-n` sibling, and every clipped-suffix sibling
  // (a stored handle may share only `base`'s first `maxClippedBaseLength` characters once
  // `withSuffix` has clipped it) — the taken set may be a superset of what is truly taken, never
  // short of it.
  const rows = await client.query<{ handle: string }>(
    "SELECT handle FROM patient_profiles WHERE handle LIKE $1 || '%'",
    [base.slice(0, maxClippedBaseLength)],
  );
  return new Set(rows.rows.map((row) => row.handle.toLowerCase()));
}

/** A free handle by the default rule: the base, else the first free `-n` suffix. */
export async function freeHandle(
  client: DatabaseClient,
  input: { username: string | null; displayName: string },
): Promise<string> {
  const base = defaultHandle(input);
  const taken = await takenHandles(client, base);
  return withSuffix(base, (candidate) => taken.has(candidate));
}

/** Every new profile comes through here, so no profile is ever without a handle. */
export async function createPatientProfile(
  client: DatabaseClient,
  input: NewPatientProfile,
): Promise<string> {
  const handle = await freeHandle(client, input);
  await client.query(
    `INSERT INTO patient_profiles
       (id, family_id, display_name, kind, linked_user_id, created_by_user_id, created_at,
        handle, handle_set_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'auto')`,
    [
      input.id,
      input.familyId,
      input.displayName,
      input.kind,
      input.linkedUserId,
      input.createdByUserId,
      input.createdAt,
      handle,
    ],
  );
  return handle;
}

/**
 * Rewrites the provisional handles migration 0038 left on existing rows by the default rule —
 * run by `pnpm db:migrate` after `up`; idempotent, never touches a handle a person set.
 */
export async function backfillProfileHandles(database: Database): Promise<number> {
  return database.transaction(async (client) => {
    const rows = await client.query<{
      id: string;
      handle: string;
      display_name: string;
      username: string | null;
    }>(
      `SELECT p.id, p.handle, p.display_name, a.username
         FROM patient_profiles p
         LEFT JOIN app_accounts a ON a.user_id = p.linked_user_id
        WHERE p.handle_set_by = 'auto' AND p.handle GLOB 'p-*'
        ORDER BY p.created_at, p.rowid`,
    );
    let rewritten = 0;
    for (const row of rows.rows) {
      // The prefix alone is not enough: a name may transliterate to `p-…` and must keep its handle.
      if (!isProvisionalHandle(row.handle)) continue;
      const handle = await freeHandle(client, {
        username: row.username,
        displayName: row.display_name,
      });
      await client.query("UPDATE patient_profiles SET handle = $1 WHERE id = $2", [handle, row.id]);
      rewritten += 1;
    }
    return rewritten;
  });
}
