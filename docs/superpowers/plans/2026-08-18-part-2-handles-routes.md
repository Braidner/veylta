# Part 2 — Profile handles and short routes: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every profile gets a server-unique handle; the browser addresses a profile as `/<handle>`, its tabs as path segments (`/<handle>/docs`, `/history`, `/dossier`, `/assistants/<id>`, `/settings[/app]`), sign-in lives at `/login`, and the old `/families/:f/profiles/:p…` links redirect.

**Architecture:** The handle is a nullable `patient_profiles.handle` column (migration 0038 fills a provisional `p-<hex>` value; `pnpm db:migrate` then backfills the default rule in code); one `createPatientProfile` helper sets it for every new profile; the session and every `PatientProfileSummary` carry it; `PUT …/profiles/:id/handle` lets an owner or the linked adult change it. On the web, `app/paths.ts` builds handle-based paths only, a `ProfileRouteProvider` hands the handle to components that build links, `VeyltaApp` resolves `/<handle>` against the session, and thin Next pages under `app/[handle]/…` plus `app/login` replace the `families/…` tree, whose pages become client redirectors. API paths keep their UUIDs.

**Tech Stack:** Fastify + `node:sqlite` migrations (SQL files run by `apps/api/src/database/migrations.ts`), Next.js 16 app router, React 19, TypeScript strict, `node:test`, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-08-18-shell-routes-documents-history-design.md` — Part 2.

## Global Constraints

- Handle alphabet and bounds: lower-case `a–z`, `0–9`, `-`; first character a letter or digit; no trailing hyphen; 3–30 characters; reserved words rejected. One regex in contracts: `/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/` (3–30 characters, no trailing hyphen — a two-character handle never matches).
- Reserved handles (contracts, verbatim): `login`, `logout`, `settings`, `families`, `profiles`, `profile`, `health-api`, `api`, `docs`, `documents`, `history`, `dossier`, `plan`, `assistants`, `app`, `admin`, `static`, `_next`, `manifest.webmanifest`, `favicon.ico`, `robots.txt`.
- Uniqueness is server-wide and case-insensitive; archived profiles keep their handle.
- API routes stay `/v1/families/:familyId/profiles/:profileId/…`; only browser routes change.
- Audit rows stay payload-free: `profile.handle.changed` carries no handle.
- A new migration bumps `requiredSchemaMigration` in `apps/api/src/database/pool.ts` and needs a working `.down.sql` (CI runs migrate → rollback → migrate).
- Contract shape changes bump the version: `FAMILY_PROFILE_CONTRACT_VERSION = "family-profile/v3"`; every literal copy in tests changes with it.
- No source file over 250 lines; legacy files (`apps/api/src/family/family-service.ts` 1216, `apps/api/src/family/routes.ts` 377, `apps/web/app/components/veylta-app.tsx` 7390, `apps/api/test/family-profiles.integration.test.ts` 1389) may only shrink — new code goes into new modules.
- UI text Russian; code, comments, commits English; commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- After editing `packages/contracts`, run `pnpm --filter @veylta/contracts build` before API/web typechecks.

---

### Task 1: Contracts — the handle vocabulary and `PatientProfileSummary.handle`

**Files:**
- Create: `packages/contracts/src/profile-handle.ts`
- Create: `packages/contracts/src/profile-handle.test.ts`
- Modify: `packages/contracts/src/index.ts` (`FAMILY_PROFILE_CONTRACT_VERSION`, `PatientProfileSummary`, an `export *`)
- Modify: `packages/contracts/src/index.test.ts` (line ≈80, the version pin)
- Modify: `apps/api/test/family-profiles.integration.test.ts` (line ≈158, the literal `"family-profile/v2"`)

**Interfaces:**
- Produces: `PROFILE_HANDLE_PATTERN: RegExp`, `RESERVED_PROFILE_HANDLES: readonly string[]`, `isValidProfileHandle(value: string): boolean` (pattern and not reserved), `MAX_PROFILE_HANDLE_LENGTH = 30`, `MIN_PROFILE_HANDLE_LENGTH = 3`, `ProfileHandleRequest { handle: string }`, `ProfileHandleResponse { contractVersion: "family-profile/v3"; profileId: string; handle: string }`; `PatientProfileSummary.handle: string`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/profile-handle.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  FAMILY_PROFILE_CONTRACT_VERSION,
  isValidProfileHandle,
  type PatientProfileSummary,
  PROFILE_HANDLE_PATTERN,
  RESERVED_PROFILE_HANDLES,
} from "./index.js";

test("a handle is short lower-case latin with hyphens inside, never a reserved route word", () => {
  assert.equal(FAMILY_PROFILE_CONTRACT_VERSION, "family-profile/v3");
  for (const good of ["anna", "braidner", "anna-2", "p-0123456789ab", "a1b"]) {
    assert.equal(isValidProfileHandle(good), true, good);
  }
  for (const bad of ["an", "Anna", "anna_", "-anna", "anna-", "анна", "a".repeat(31), "a b", ""]) {
    assert.equal(isValidProfileHandle(bad), false, bad);
  }
  for (const reserved of RESERVED_PROFILE_HANDLES) {
    assert.equal(isValidProfileHandle(reserved), false, reserved);
  }
  assert.ok(RESERVED_PROFILE_HANDLES.includes("login"));
  assert.ok(RESERVED_PROFILE_HANDLES.includes("docs"));
  assert.ok(RESERVED_PROFILE_HANDLES.includes("health-api"));
  assert.equal(PROFILE_HANDLE_PATTERN.test("a-b"), true);
});

test("a profile summary names its handle", () => {
  const profile = {
    id: "00000000-0000-4000-8000-000000000001",
    familyId: "00000000-0000-4000-8000-000000000002",
    displayName: "Анна",
    kind: "adult",
    access: "owner",
    handle: "anna",
    createdAt: "2026-08-18T00:00:00.000Z",
  } as const satisfies PatientProfileSummary;
  assert.equal(profile.handle, "anna");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @veylta/contracts exec tsx --test src/profile-handle.test.ts`
Expected: FAIL — `isValidProfileHandle` is not exported / the version is still v2.

- [ ] **Step 3: Write the module and wire the index**

```ts
// packages/contracts/src/profile-handle.ts
/**
 * A profile's handle: the one browser-facing name of a person — `/<handle>` is their page. Unique
 * across the whole server (the address carries no family), lower-case, short, never a word the
 * router already owns. The API keeps UUID paths; the handle is only for people and their links.
 */
export const MIN_PROFILE_HANDLE_LENGTH = 3;
export const MAX_PROFILE_HANDLE_LENGTH = 30;
export const PROFILE_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

/** Top-level browser segments and well-known files a handle may not shadow. */
export const RESERVED_PROFILE_HANDLES: readonly string[] = [
  "login",
  "logout",
  "settings",
  "families",
  "profiles",
  "profile",
  "health-api",
  "api",
  "docs",
  "documents",
  "history",
  "dossier",
  "plan",
  "assistants",
  "app",
  "admin",
  "static",
  "_next",
  "manifest.webmanifest",
  "favicon.ico",
  "robots.txt",
];

export function isValidProfileHandle(value: string): boolean {
  return PROFILE_HANDLE_PATTERN.test(value) && !RESERVED_PROFILE_HANDLES.includes(value);
}

/** `PUT /v1/families/:familyId/profiles/:profileId/handle` */
export interface ProfileHandleRequest {
  readonly handle: string;
}

export interface ProfileHandleResponse {
  readonly contractVersion: "family-profile/v3";
  readonly profileId: string;
  readonly handle: string;
}
```

In `packages/contracts/src/index.ts`:
- change `export const FAMILY_PROFILE_CONTRACT_VERSION = "family-profile/v2" as const;` to `"family-profile/v3"`;
- add `export * from "./profile-handle.js";` next to the other `export *` lines (there are such lines near the top; keep alphabetical order if the file orders them);
- in `export interface PatientProfileSummary` add after `displayName: string;`:
  ```ts
  /** The browser-facing name of this person: `/<handle>` is their page. Unique server-wide. */
  handle: string;
  ```
- in `packages/contracts/src/index.test.ts` line ≈80 change the pin to `"family-profile/v3"`.
- in `apps/api/test/family-profiles.integration.test.ts` line ≈158 change `"family-profile/v2"` to `"family-profile/v3"`.

- [ ] **Step 4: Build and test the contracts; check the API/web typecheck for new gaps**

Run: `pnpm --filter @veylta/contracts build && pnpm --filter @veylta/contracts test`
Expected: PASS (the new test plus the existing ones).
Run: `pnpm --filter @veylta/api typecheck 2>&1 | grep -E "error TS" | head`
Expected: errors only where `PatientProfileSummary` objects are built without `handle` (`apps/api/src/family/family-service.ts` `profileSummary`, `apps/api/src/accounts/account-service.ts` or `settings/home-settings-service.ts` if they build summaries) — Task 4 fixes them; note the list.

- [ ] **Step 5: Commit**

```bash
pnpm exec biome check --write packages/contracts/src apps/api/test/family-profiles.integration.test.ts
git add packages/contracts/src apps/api/test/family-profiles.integration.test.ts
git commit -m "feat(contracts): profile handles — pattern, reserved words, family-profile/v3

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(The API typecheck is red between this task and Task 4; Tasks 2–4 land before a push.)

---

### Task 2: The default handle rule (API, pure)

**Files:**
- Create: `apps/api/src/family/profile-handle.ts`
- Create: `apps/api/src/family/profile-handle.test.ts`

**Interfaces:**
- Produces: `transliterate(value: string): string` (Cyrillic → Latin, lower-case), `handleFromName(displayName: string): string`, `handleFromUsername(username: string): string`, `defaultHandle(input: { username: string | null; displayName: string }): string` — always a valid, non-reserved base (falls back to `profile`), and `withSuffix(base: string, taken: (candidate: string) => boolean): string` — `base`, then `base-2`, `base-3`, … until `taken` says free, keeping the 30-character bound by trimming the base.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/family/profile-handle.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultHandle,
  handleFromName,
  handleFromUsername,
  transliterate,
  withSuffix,
} from "./profile-handle.js";

test("names transliterate to lower-case latin and keep only the first word", () => {
  assert.equal(transliterate("Анна Иванова"), "anna ivanova");
  assert.equal(transliterate("Щука Ёжик"), "shchuka yozhik");
  assert.equal(handleFromName("Анна Иванова"), "anna");
  assert.equal(handleFromName("Маша"), "masha");
  assert.equal(handleFromName("Jean-Luc Picard"), "jean-luc");
  assert.equal(handleFromName("  Ю  "), "profile", "too short falls back");
  assert.equal(handleFromName("!!!"), "profile");
  assert.equal(handleFromName("Оченьдлинноеимясовсембезпробеловиконца"), "ochendlinnoeimyasovsembezprobel");
});

test("a username becomes a handle in the handle alphabet", () => {
  assert.equal(handleFromUsername("braidner"), "braidner");
  assert.equal(handleFromUsername("home.admin_2"), "home-admin-2");
  assert.equal(handleFromUsername("a.b"), "a-b");
  assert.equal(handleFromUsername("x.y.z.very.long.username.here.ok"), "x-y-z-very-long-username-here-");
});

test("the default rule prefers the username, then the name, never a reserved word", () => {
  assert.equal(defaultHandle({ username: "braidner", displayName: "Владелец" }), "braidner");
  assert.equal(defaultHandle({ username: null, displayName: "Анна Иванова" }), "anna");
  assert.equal(defaultHandle({ username: "login", displayName: "Кто-то" }), "login-2");
  assert.equal(defaultHandle({ username: null, displayName: "Docs" }), "docs-2");
});

test("a taken handle gets the next free suffix within the length bound", () => {
  const taken = new Set(["anna", "anna-2"]);
  assert.equal(withSuffix("anna", (candidate) => taken.has(candidate)), "anna-3");
  assert.equal(withSuffix("olga", (candidate) => taken.has(candidate)), "olga");
  const long = "a".repeat(30);
  const result = withSuffix(long, (candidate) => candidate === long);
  assert.equal(result.length, 30);
  assert.equal(result, `${"a".repeat(28)}-2`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @veylta/api exec tsx --test src/family/profile-handle.test.ts`
Expected: FAIL — cannot find `./profile-handle.js`.

- [ ] **Step 3: Write the module**

```ts
// apps/api/src/family/profile-handle.ts
import {
  isValidProfileHandle,
  MAX_PROFILE_HANDLE_LENGTH,
  MIN_PROFILE_HANDLE_LENGTH,
  RESERVED_PROFILE_HANDLES,
} from "@veylta/contracts";

/** A plain Cyrillic transliteration for names — a household convenience, not a standard. */
const letters: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  і: "i", ї: "yi", є: "ye", ґ: "g",
};

export function transliterate(value: string): string {
  return [...value.toLowerCase()].map((char) => letters[char] ?? char).join("");
}

const fallback = "profile";

function clip(value: string): string {
  return value.slice(0, MAX_PROFILE_HANDLE_LENGTH).replace(/-+$/, "");
}

/** The first word of a name in the handle alphabet; too short or empty → `profile`. */
export function handleFromName(displayName: string): string {
  const first = transliterate(displayName).trim().split(/\s+/)[0] ?? "";
  const cleaned = clip(first.replace(/[^a-z0-9-]/g, "").replace(/^-+/, ""));
  return cleaned.length < MIN_PROFILE_HANDLE_LENGTH ? fallback : cleaned;
}

/** A username (`[a-z0-9._-]`) in the handle alphabet: dots and underscores become hyphens. */
export function handleFromUsername(username: string): string {
  const cleaned = clip(username.toLowerCase().replace(/[._]/g, "-").replace(/[^a-z0-9-]/g, "").replace(/^-+/, ""));
  return cleaned.length < MIN_PROFILE_HANDLE_LENGTH ? fallback : cleaned;
}

/** `base`, `base-2`, `base-3`, … — the first one `taken` does not know, within the bound. */
export function withSuffix(base: string, taken: (candidate: string) => boolean): string {
  if (!taken(base)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, MAX_PROFILE_HANDLE_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken(candidate)) return candidate;
  }
  throw new Error("No free profile handle");
}

/**
 * The default rule: the account's username for a linked profile, the name otherwise; a reserved
 * word is treated as taken so it is suffixed. Uniqueness against the database is the caller's
 * `taken` — this function only knows the reserved list.
 */
export function defaultHandle(input: { username: string | null; displayName: string }): string {
  const base = input.username === null ? handleFromName(input.displayName) : handleFromUsername(input.username);
  return withSuffix(base, (candidate) => !isValidProfileHandle(candidate) && RESERVED_PROFILE_HANDLES.includes(candidate));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @veylta/api exec tsx --test src/family/profile-handle.test.ts`
Expected: PASS (4 tests). If `handleFromUsername("x.y.z.very.long.username.here.ok")` differs by the trailing hyphen, note that `clip` strips trailing hyphens — adjust the expectation in the test to the clipped value the implementation returns **only if** it still satisfies the 30-character bound and the no-trailing-hyphen rule (the expected value above already does).

- [ ] **Step 5: Commit**

```bash
pnpm exec biome check --write apps/api/src/family/profile-handle.ts apps/api/src/family/profile-handle.test.ts
git add apps/api/src/family/profile-handle.ts apps/api/src/family/profile-handle.test.ts
git commit -m "feat(api): the default profile handle rule — username, then name, suffixed when taken

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Migration 0038, one profile insert helper, the backfill

**Files:**
- Create: `db/migrations/0038_profile_handles.up.sql`, `db/migrations/0038_profile_handles.down.sql`
- Create: `apps/api/src/family/patient-profiles.ts`
- Create: `apps/api/test/profile-handles-migration.integration.test.ts`
- Modify: `apps/api/src/database/pool.ts` (`requiredSchemaMigration`)
- Modify: `apps/api/src/database/migrations.ts` (`run()` backfills after `up`)
- Modify: `apps/api/src/family/family-service.ts` (three `INSERT INTO patient_profiles` sites, lines ≈497, ≈732, ≈1152)
- Modify: `apps/api/src/settings/home-settings-service.ts` (≈211), `apps/api/src/accounts/account-service.ts` (≈216)

**Interfaces:**
- Produces: `createPatientProfile(client, input: NewPatientProfile): Promise<string>` (returns the handle), `backfillProfileHandles(database): Promise<number>` (rows rewritten), `provisionalHandleSql` (the SQL expression both the migration and the session queries use), `isProvisionalHandle(handle): boolean`.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0038_profile_handles.up.sql
-- A profile's handle is its browser-facing name: `/<handle>` is the person's page. Unique across
-- the server (the address carries no family), lower-case latin, 3–30 characters. Existing rows get
-- a provisional `p-<hex>` handle here; `pnpm db:migrate` then rewrites provisional handles by the
-- default rule (username, then name) in code — see apps/api/src/family/patient-profiles.ts.
ALTER TABLE patient_profiles ADD COLUMN handle TEXT COLLATE NOCASE CHECK (
  handle IS NULL
  OR (
    length(handle) BETWEEN 3 AND 30
    AND handle = lower(handle)
    AND handle GLOB '[a-z0-9]*'
    AND handle NOT GLOB '*[^a-z0-9-]*'
    AND handle NOT GLOB '*-'
  )
);
ALTER TABLE patient_profiles ADD COLUMN handle_set_by TEXT NOT NULL DEFAULT 'auto' CHECK (
  handle_set_by IN ('auto', 'person')
);

UPDATE patient_profiles
   SET handle = 'p-' || lower(substr(replace(id, '-', ''), 1, 12))
 WHERE handle IS NULL;

CREATE UNIQUE INDEX patient_profiles_handle_unique
  ON patient_profiles (handle COLLATE NOCASE);
```

```sql
-- db/migrations/0038_profile_handles.down.sql
DROP INDEX IF EXISTS patient_profiles_handle_unique;
ALTER TABLE patient_profiles DROP COLUMN handle_set_by;
ALTER TABLE patient_profiles DROP COLUMN handle;
```

In `apps/api/src/database/pool.ts` set `const requiredSchemaMigration = "0038_profile_handles";`.

- [ ] **Step 2: Write the failing integration test**

```ts
// apps/api/test/profile-handles-migration.integration.test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase } from "../src/database/pool.js";
import { backfillProfileHandles, createPatientProfile } from "../src/family/patient-profiles.js";
import { reapplyFrom, rollbackTo } from "./migration-chain.js";

async function seedFamily(database: Awaited<ReturnType<typeof createDatabase>>, suffix: string) {
  const userId = randomUUID();
  const familyId = randomUUID();
  const now = new Date().toISOString();
  await database.transaction(async (client) => {
    await client.query(`INSERT INTO users (id, display_name, created_at) VALUES ($1, $2, $3)`, [
      userId,
      `Владелец ${suffix}`,
      now,
    ]);
    await client.query(
      `INSERT INTO app_accounts (user_id, username, password_hash, role, created_at, updated_at)
       VALUES ($1, $2, $3, 'user', $4, $4)`,
      [userId, `owner-${suffix}`, `scrypt-v1$${"x".repeat(90)}`, now],
    );
    await client.query(
      `INSERT INTO families (id, display_name, created_by_user_id, created_at) VALUES ($1, $2, $3, $4)`,
      [familyId, `Семья ${suffix}`, userId, now],
    );
    await client.query(
      `INSERT INTO family_memberships (id, family_id, user_id, role, status, created_at)
       VALUES ($1, $2, $3, 'owner', 'active', $4)`,
      [randomUUID(), familyId, userId, now],
    );
  });
  return { userId, familyId, now };
}

test("0038: existing profiles get provisional handles, the backfill applies the rule, the helper keeps uniqueness", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-handles-"));
  const database = createDatabase(join(root, "test.sqlite"));
  try {
    await migrateUp(database);
    await rollbackTo(database, "0038_profile_handles");
    const { userId, familyId, now } = await seedFamily(database, "a");
    const linked = randomUUID();
    const child = randomUUID();
    await database.transaction(async (client) => {
      await client.query(
        `INSERT INTO patient_profiles (id, family_id, display_name, kind, linked_user_id, created_by_user_id, created_at)
         VALUES ($1, $2, 'Владелец A', 'adult', $3, $3, $4)`,
        [linked, familyId, userId, now],
      );
      await client.query(
        `INSERT INTO patient_profiles (id, family_id, display_name, kind, linked_user_id, created_by_user_id, created_at)
         VALUES ($1, $2, 'Анна Иванова', 'dependent', NULL, $3, $4)`,
        [child, familyId, userId, now],
      );
    });
    await reapplyFrom(database, "0038_profile_handles");
    const provisional = await database.query<{ id: string; handle: string; handle_set_by: string }>(
      `SELECT id, handle, handle_set_by FROM patient_profiles ORDER BY created_at, rowid`,
    );
    for (const row of provisional.rows) {
      assert.match(row.handle, /^p-[0-9a-f]{12}$/);
      assert.equal(row.handle_set_by, "auto");
    }

    const rewritten = await backfillProfileHandles(database);
    assert.equal(rewritten, 2);
    const after = await database.query<{ id: string; handle: string }>(
      `SELECT id, handle FROM patient_profiles WHERE id IN ($1, $2) ORDER BY created_at, rowid`,
      [linked, child],
    );
    assert.deepEqual(
      after.rows.map((row) => row.handle),
      ["owner-a", "anna"],
      "the linked profile takes the username, the dependent the name",
    );
    assert.equal(await backfillProfileHandles(database), 0, "idempotent");

    // The helper: a second Анна becomes anna-2; case differs only → still taken.
    const handle = await database.transaction((client) =>
      createPatientProfile(client, {
        id: randomUUID(),
        familyId,
        displayName: "Анна Петрова",
        kind: "dependent",
        linkedUserId: null,
        createdByUserId: userId,
        createdAt: now,
        username: null,
      }),
    );
    assert.equal(handle, "anna-2");
    await assert.rejects(
      database.transaction((client) =>
        client.query(`UPDATE patient_profiles SET handle = 'ANNA' WHERE id = $1`, [child]),
      ),
      /UNIQUE constraint failed/,
      "unique regardless of case",
    );

    // Rollback drops the columns; re-apply brings provisional handles back.
    await rollbackTo(database, "0038_profile_handles");
    const columns = await database.query<{ name: string }>(`PRAGMA table_info(patient_profiles)`);
    assert.equal(columns.rows.some((column) => column.name === "handle"), false);
    await reapplyFrom(database, "0038_profile_handles");
    const again = await database.query<{ handle: string }>(`SELECT handle FROM patient_profiles`);
    assert.ok(again.rows.every((row) => /^p-[0-9a-f]{12}$/.test(row.handle)));
  } finally {
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
});
```

Read `apps/api/test/migration-chain.ts` for the exact signatures of `rollbackTo(database, migrationName)` (rolls back down to and including that migration) and `reapplyFrom(database, migrationName)`; `apps/api/test/assistant-ids-migration.integration.test.ts` shows them in use. The `users` table columns: check `db/migrations/0002_family_profiles.up.sql` — if `users` has other NOT NULL columns, add them to the seed INSERT.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @veylta/api exec tsx --test --test-concurrency=1 test/profile-handles-migration.integration.test.ts`
Expected: FAIL — `../src/family/patient-profiles.js` does not exist (after writing the SQL files the migration itself applies).

- [ ] **Step 4: Write the helper module**

```ts
// apps/api/src/family/patient-profiles.ts
import type { PatientProfileKind } from "@veylta/contracts";
import type { Database, QueryResult } from "../database/pool.js";
import { defaultHandle, withSuffix } from "./profile-handle.js";

interface Queryable {
  query<T extends object>(sql: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

/** The provisional handle migration 0038 gives a row that has none yet — the same expression. */
export const provisionalHandleSql = "'p-' || lower(substr(replace(id, '-', ''), 1, 12))";

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

async function takenHandles(client: Queryable, base: string): Promise<Set<string>> {
  const rows = await client.query<{ handle: string }>(
    `SELECT handle FROM patient_profiles WHERE handle = $1 COLLATE NOCASE OR handle LIKE $2`,
    [base, `${base}-%`],
  );
  return new Set(rows.rows.map((row) => row.handle.toLowerCase()));
}

/** A free handle by the default rule: the base, else the first free `-n` suffix. */
export async function freeHandle(
  client: Queryable,
  input: { username: string | null; displayName: string },
): Promise<string> {
  const base = defaultHandle(input);
  const taken = await takenHandles(client, base);
  return withSuffix(base, (candidate) => taken.has(candidate));
}

/** Every new profile comes through here, so no profile is ever without a handle. */
export async function createPatientProfile(
  client: Queryable,
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
    const rows = await client.query<{ id: string; display_name: string; username: string | null }>(
      `SELECT p.id, p.display_name, a.username
         FROM patient_profiles p
         LEFT JOIN app_accounts a ON a.user_id = p.linked_user_id
        WHERE p.handle_set_by = 'auto' AND p.handle GLOB 'p-[0-9a-f]*'
        ORDER BY p.created_at, p.rowid`,
    );
    let rewritten = 0;
    for (const row of rows.rows) {
      const handle = await freeHandle(client, { username: row.username, displayName: row.display_name });
      await client.query(`UPDATE patient_profiles SET handle = $1 WHERE id = $2`, [handle, row.id]);
      rewritten += 1;
    }
    return rewritten;
  });
}
```

- [ ] **Step 5: Route every profile insert through the helper**

Replace the raw `INSERT INTO patient_profiles …` statements at the five sites with `createPatientProfile(client, { … })`:

1. `apps/api/src/family/family-service.ts` `createProfile` (≈line 497): the new profile is unlinked — `await createPatientProfile(client, { id: row.id, familyId, displayName: row.display_name, kind: row.kind, linkedUserId: null, createdByUserId: actor.userId, createdAt: row.created_at, username: null });` and keep the returned handle on the row for `profileSummary` (Task 4 adds `handle` to `ProfileRow`; until then store it in a local `const handle = await createPatientProfile(…)` and spread it into the summary in Task 4).
2. `family-service.ts` invitation acceptance (≈732): `await createPatientProfile(client, { id: ids.profile, familyId: invitation.family_id, displayName: profileName, kind: "adult", linkedUserId: ids.user, createdByUserId: ids.user, createdAt: now, username: null });` (a demo invitation creates no account, so no username).
3. `family-service.ts` demo registration (≈1152): same shape with `username: null`.
4. `apps/api/src/settings/home-settings-service.ts` (≈211): the admin creates an account with a username — pass `username: <the validated username variable used for the INSERT INTO app_accounts just above>`.
5. `apps/api/src/accounts/account-service.ts` (≈216): first-administrator setup — pass the setup username.

Import `createPatientProfile` from `"../family/patient-profiles.js"` (or `./patient-profiles.js` inside `family/`). In `apps/api/src/database/migrations.ts` `run()`, after `const result = direction === "up" ? await migrateUp(database) : await migrateDown(database);` add:

```ts
    const backfilled = direction === "up" ? await backfillProfileHandles(database) : 0;
    console.log(JSON.stringify({ service: "migrations", direction, result, backfilled }));
```

(and drop the previous `console.log` line; import `backfillProfileHandles` from `"../family/patient-profiles.js"`).

- [ ] **Step 6: Run the migration test, then the whole integration suite**

Run: `pnpm --filter @veylta/api exec tsx --test --test-concurrency=1 test/profile-handles-migration.integration.test.ts`
Expected: PASS.
Run: `pnpm --filter @veylta/api typecheck && pnpm test:integration`
Expected: typecheck may still name `profileSummary` (Task 4); integration tests that create profiles through the API pass because the helper sets handles.

- [ ] **Step 7: Commit**

```bash
pnpm exec biome check --write apps/api/src apps/api/test db/migrations
git add db/migrations/0038_profile_handles.up.sql db/migrations/0038_profile_handles.down.sql apps/api/src/database/pool.ts apps/api/src/database/migrations.ts apps/api/src/family/patient-profiles.ts apps/api/src/family/family-service.ts apps/api/src/settings/home-settings-service.ts apps/api/src/accounts/account-service.ts apps/api/test/profile-handles-migration.integration.test.ts
git commit -m "feat(api): profile handles — migration 0038, one insert helper, the backfill by the default rule

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Handles in every profile read, and `PUT …/handle`

**Files:**
- Modify: `apps/api/src/family/family-service.ts` (`ProfileRow` ≈149, `profileSummary` ≈288, the two `SELECT` queries ≈398 and ≈413, `createProfile` return)
- Create: `apps/api/src/family/profile-handle-service.ts`
- Create: `apps/api/src/family/profile-handle-routes.ts`
- Create: `apps/api/test/profile-handle.integration.test.ts`
- Modify: `apps/api/src/server.ts` (register the route), `apps/api/test/medical-profile-app.ts` (register the route in the shared test app)

**Interfaces:**
- Produces: `setProfileHandle(database, { actor, scope: { familyId, profileId }, handle, correlationId }): Promise<ProfileHandleResponse>`; `registerProfileHandleRoutes(app, family: FamilyService, database: Database, options: { allowedMutationOrigins: readonly string[] })`; every `PatientProfileSummary` from the API carries `handle`.

- [ ] **Step 1: Write the failing integration test**

```ts
// apps/api/test/profile-handle.integration.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { register, startMedicalProfileApp, webOrigin } from "./medical-profile-app.js";

test("handles: the session names them, an owner renames within the rule, uniqueness and reserved words hold", async () => {
  const { app, database, close } = await startMedicalProfileApp();
  try {
    const owner = await register(app, "Handle owner");
    const other = await register(app, "Handle other");
    const session = await app.inject({ method: "GET", url: "/v1/session", headers: { cookie: owner.cookie } });
    const profile = session.json().families[0].profiles[0];
    assert.equal(session.json().contractVersion, "family-profile/v3");
    assert.match(profile.handle, /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/);
    assert.equal(profile.handle, owner.body.profile.handle, "registration and session agree");

    const path = `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/handle`;
    const headers = { cookie: owner.cookie, origin: webOrigin };
    const renamed = await app.inject({ method: "PUT", url: path, headers, payload: { handle: "Anna-K" } });
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.deepEqual(renamed.json(), {
      contractVersion: "family-profile/v3",
      profileId: owner.body.profile.id,
      handle: "anna-k",
    });
    const again = await app.inject({ method: "GET", url: "/v1/session", headers: { cookie: owner.cookie } });
    assert.equal(again.json().families[0].profiles[0].handle, "anna-k");
    const stored = await database.query<{ handle_set_by: string }>(
      `SELECT handle_set_by FROM patient_profiles WHERE id = $1`,
      [owner.body.profile.id],
    );
    assert.equal(stored.rows[0]?.handle_set_by, "person");

    for (const [handle, status] of [
      ["login", 422],
      ["docs", 422],
      ["an", 422],
      ["anna_k", 422],
      ["anna-", 422],
      [other.body.profile.handle.toUpperCase(), 409],
    ] as const) {
      const response = await app.inject({ method: "PUT", url: path, headers, payload: { handle } });
      assert.equal(response.statusCode, status, `${handle}: ${response.body}`);
    }
    const same = await app.inject({ method: "PUT", url: path, headers, payload: { handle: "anna-k" } });
    assert.equal(same.statusCode, 200, "the same handle again is a no-op");

    const stranger = await app.inject({
      method: "PUT",
      url: path,
      headers: { cookie: other.cookie, origin: webOrigin },
      payload: { handle: "stolen" },
    });
    assert.equal(stranger.statusCode, 404);
    const noOrigin = await app.inject({ method: "PUT", url: path, headers: { cookie: owner.cookie }, payload: { handle: "x-y-z" } });
    assert.equal(noOrigin.statusCode, 403);

    const audit = await database.query<{ action: string; metadata: string }>(
      `SELECT action, metadata FROM audit_events WHERE family_id = $1 AND action = 'profile.handle.changed'`,
      [owner.body.family.id],
    );
    assert.equal(audit.rows.length, 1, "a no-op rename is not audited");
    assert.deepEqual(JSON.parse(audit.rows[0]?.metadata ?? "{}"), { contractVersion: "family-profile/v3" });
  } finally {
    await close();
  }
});
```

`startMedicalProfileApp` must register the handle route (step 4); `register` returns `{ body: DemoRegistrationResponse, cookie, userId }` — `owner.body.profile.handle` exists once Task 4 step 2 is done.

- [ ] **Step 2: Carry the handle in every read**

In `apps/api/src/family/family-service.ts`:
- `interface ProfileRow` gains `handle: string;`.
- `profileSummary(row)` returns `handle: row.handle,` after `displayName`.
- Both profile queries select the handle with the provisional fallback (rows inserted raw by old tests have none):
  - in `profilesFor`: `SELECT id, family_id, display_name, kind, 'owner' AS access, created_at, COALESCE(handle, ${provisionalHandleSql}) AS handle FROM patient_profiles …`
  - in `profilesForGrantedUser`: add `COALESCE(p.handle, 'p-' || lower(substr(replace(p.id, '-', ''), 1, 12))) AS handle,` to the select list (the table alias `p.` prevents reusing `provisionalHandleSql` verbatim; keep the expression identical otherwise).
- `createProfile`: the `row: ProfileRow` literal gets `handle` from `createPatientProfile`'s return (build the row after the insert, or assign `row.handle = await createPatientProfile(…)` with `row` declared `const row: ProfileRow = { …, handle: "" }` then reassigned — prefer: `const handle = await createPatientProfile(client, {...}); return { ...row, handle };`).
- Search the file for any other place a `PatientProfileSummary` object is built (e.g. demo registration's response `profile:`) and add `handle` from the same helper's return.
- `apps/api/src/settings/home-settings-service.ts` / `accounts/account-service.ts`: if they return a `PatientProfileSummary`, add the handle returned by `createPatientProfile`.

Run `pnpm --filter @veylta/api typecheck` — it must be clean now.

- [ ] **Step 3: Write the service and the route**

```ts
// apps/api/src/family/profile-handle-service.ts
import { randomUUID } from "node:crypto";
import {
  FAMILY_PROFILE_CONTRACT_VERSION,
  isValidProfileHandle,
  type ProfileHandleResponse,
} from "@veylta/contracts";
import type { Database } from "../database/pool.js";
import {
  DomainConflictError,
  DomainValidationError,
  type SessionActor,
} from "./family-service.js";
import { canonicalProfileScope, type ProfileScope, requireProfileWrite } from "./profile-access.js";

/**
 * A person's own name for their page. Lower-cased before anything else; invalid or reserved is a
 * 422, taken by another profile (any case) a 409, a profile the session may not write a 404. The
 * same handle again changes nothing and writes no audit row.
 */
export async function setProfileHandle(
  database: Database,
  input: { actor: SessionActor; scope: ProfileScope; handle: string; correlationId: string },
): Promise<ProfileHandleResponse> {
  const scope = canonicalProfileScope(input.scope);
  const handle = input.handle.trim().toLowerCase();
  if (!isValidProfileHandle(handle)) throw new DomainValidationError();
  return database.transaction(async (client) => {
    await requireProfileWrite(client, input.actor, scope);
    const current = await client.query<{ handle: string }>(
      `SELECT handle FROM patient_profiles WHERE family_id = $1 AND id = $2`,
      [scope.familyId, scope.profileId],
    );
    if (current.rows[0]?.handle.toLowerCase() === handle) {
      return { contractVersion: FAMILY_PROFILE_CONTRACT_VERSION, profileId: scope.profileId, handle };
    }
    const taken = await client.query<{ id: string }>(
      `SELECT id FROM patient_profiles WHERE handle = $1 COLLATE NOCASE AND id <> $2`,
      [handle, scope.profileId],
    );
    if (taken.rows.length > 0) throw new DomainConflictError();
    const now = new Date();
    await client.query(
      `UPDATE patient_profiles SET handle = $1, handle_set_by = 'person' WHERE family_id = $2 AND id = $3`,
      [handle, scope.familyId, scope.profileId],
    );
    await client.query(
      `INSERT INTO audit_events
         (id, family_id, actor_user_id, action, resource_type, resource_id, result,
          correlation_id, metadata, created_at)
       VALUES ($1, $2, $3, 'profile.handle.changed', 'PatientProfile', $4, 'success', $5, $6, $7)`,
      [
        randomUUID(),
        scope.familyId,
        input.actor.userId,
        scope.profileId,
        input.correlationId,
        { contractVersion: FAMILY_PROFILE_CONTRACT_VERSION },
        now,
      ],
    );
    return { contractVersion: FAMILY_PROFILE_CONTRACT_VERSION, profileId: scope.profileId, handle };
  });
}
```

Check how other modules pass `metadata` to `audit_events` (`apps/api/src/assistant/assistant-storage.ts` passes an object; the pool serialises JSON) and `created_at` (a `Date`); mirror exactly.

```ts
// apps/api/src/family/profile-handle-routes.ts
import type { ProfileHandleRequest } from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import type { Database } from "../database/pool.js";
import {
  canonicalUuidSchema,
  privateResponse,
  requireActor,
  requireTrustedOrigin,
  sendDomainError,
} from "../http/route-helpers.js";
import type { FamilyService } from "./family-service.js";
import { setProfileHandle } from "./profile-handle-service.js";

interface ProfileParams {
  familyId: string;
  profileId: string;
}

/** `PUT /v1/families/:familyId/profiles/:profileId/handle` — the person's own name for their page. */
export function registerProfileHandleRoutes(
  app: FastifyInstance,
  family: FamilyService,
  database: Database,
  options: { allowedMutationOrigins: readonly string[] },
): void {
  const origins = new Set(options.allowedMutationOrigins);
  app.put<{ Params: ProfileParams; Body: ProfileHandleRequest }>(
    "/v1/families/:familyId/profiles/:profileId/handle",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["familyId", "profileId"],
          properties: { familyId: canonicalUuidSchema, profileId: canonicalUuidSchema },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["handle"],
          properties: {
            // Only a sane size here: the pattern and the reserved words are the service's 422,
            // so a two-letter or a Cyrillic handle gets the same answer as a reserved one.
            handle: { type: "string", minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      if (!requireTrustedOrigin(origins, request, reply)) return;
      const actor = await requireActor(family, request, reply);
      if (actor === null) return;
      try {
        reply.send(
          await setProfileHandle(database, {
            actor,
            scope: request.params,
            handle: request.body.handle,
            correlationId: request.id,
          }),
        );
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );
}
```

The body schema bounds only the size; the pattern and the reserved words are judged by the service (422), so the test's `an` and `anna_` get 422, not a schema 400. The contract's min/max constants serve the web form.

- [ ] **Step 4: Register the route**

- `apps/api/src/server.ts`: after `registerFamilyRoutes(app, familyService, {…});` add
  ```ts
  registerProfileHandleRoutes(app, familyService, database, {
    allowedMutationOrigins: config.webOrigins,
  });
  ```
  with `import { registerProfileHandleRoutes } from "./family/profile-handle-routes.js";`.
- `apps/api/test/medical-profile-app.ts` (`startMedicalProfileApp`): register the same route after `registerFamilyRoutes` with `{ allowedMutationOrigins: [webOrigin] }`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @veylta/api exec tsx --test --test-concurrency=1 test/profile-handle.integration.test.ts test/family-profiles.integration.test.ts`
Expected: PASS (the family test's `deepEqual` of session profiles compares server objects that both carry `handle`).
Run: `pnpm --filter @veylta/api test && pnpm test:integration && pnpm lint`
Expected: green; `family-service.ts` shorter than 1216 (three INSERT blocks gone).

- [ ] **Step 6: Commit**

```bash
pnpm exec biome check --write apps/api/src apps/api/test
git add apps/api/src/family apps/api/src/server.ts apps/api/test/medical-profile-app.ts apps/api/test/profile-handle.integration.test.ts
git commit -m "feat(api): the session and every profile summary carry the handle; PUT …/profiles/:id/handle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Web — handle-based paths, `/login`, `/<handle>/…` pages, legacy redirects

**Files:**
- Modify: `apps/web/app/paths.ts` (rewrite the builders)
- Create: `apps/web/app/paths.test.ts`
- Create: `apps/web/app/profile-route.tsx` (`ProfileRouteProvider`, `useProfileHandle`)
- Create: `apps/web/app/login/page.tsx`, `apps/web/app/[handle]/page.tsx`, `apps/web/app/[handle]/docs/page.tsx`, `apps/web/app/[handle]/docs/[documentId]/page.tsx`, `apps/web/app/[handle]/history/page.tsx`, `apps/web/app/[handle]/dossier/page.tsx`, `apps/web/app/[handle]/assistants/[assistantId]/page.tsx`, `apps/web/app/[handle]/settings/page.tsx`, `apps/web/app/[handle]/settings/app/page.tsx`
- Create: `apps/web/app/components/legacy-redirect.tsx`
- Modify: `apps/web/app/page.tsx`, `apps/web/app/settings/page.tsx`, `apps/web/app/settings/app/page.tsx`, `apps/web/app/families/[familyId]/profiles/[profileId]/page.tsx`, `…/documents/[documentId]/page.tsx`, `…/assistants/[assistantId]/page.tsx`
- Modify: `apps/web/app/components/veylta-app.tsx` (props, context resolution, redirects, all path builder calls)
- Modify: the components listed in step 6

**Interfaces:**
- Produces (`app/paths.ts`): `profilePath(handle)`, `profileTabPath(handle, tab)` (`overview` → `/<handle>`, `documents` → `/<handle>/docs`, `history` → `/<handle>/history`, `dossier` → `/<handle>/dossier`), `documentPath(handle, documentId)` → `/<handle>/docs/<id>`, `assistantPath(handle, assistantId, conversationId?)`, `assistantAskPath(handle, ask)`, `settingsPath(handle, section)` → `/<handle>/settings` | `/<handle>/settings/app`, `historyPath(handle, code?)` → `/<handle>/history?code=<code>`, `loginPath = "/login"`, `documentApiPath(familyId, profileId, documentId)` → `/v1/families/<f>/profiles/<p>/documents/<d>` (for the agent panel's API calls), `parseProfileTabSegment(segment: string | undefined): ProfileTab` (`docs` → documents, `history`, `dossier`, else overview), `legacyTabToSegment(tab: string | undefined)`.
- Produces (`app/profile-route.tsx`): `<ProfileRouteProvider handle>`, `useProfileHandle(): string`.
- `VeyltaApp` props: `requestedHandle?: string`, `requestedLogin?: boolean`, `legacy?: { familyId: string; profileId: string; tab?: string; documentId?: string; assistantId?: string; conversationId?: string; ask?: string; canonicalCode?: string }`; `requestedSettingsProfileId` is replaced by the handle (settings open on that person).

- [ ] **Step 1: Write the failing paths test**

```ts
// apps/web/app/paths.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  assistantAskPath,
  assistantPath,
  documentApiPath,
  documentPath,
  historyPath,
  loginPath,
  parseProfileTabSegment,
  profilePath,
  profileTabPath,
  settingsPath,
} from "./paths";

test("every browser path starts at the handle; tabs are segments; settings has two sections", () => {
  assert.equal(loginPath, "/login");
  assert.equal(profilePath("anna"), "/anna");
  assert.equal(profileTabPath("anna", "overview"), "/anna");
  assert.equal(profileTabPath("anna", "documents"), "/anna/docs");
  assert.equal(profileTabPath("anna", "history"), "/anna/history");
  assert.equal(profileTabPath("anna", "dossier"), "/anna/dossier");
  assert.equal(documentPath("anna", "00000000-0000-4000-8000-000000000001"), "/anna/docs/00000000-0000-4000-8000-000000000001");
  assert.equal(assistantPath("anna", "physician"), "/anna/assistants/physician");
  assert.equal(assistantPath("anna", "trainer", "00000000-0000-4000-8000-000000000002"), "/anna/assistants/trainer?conversationId=00000000-0000-4000-8000-000000000002");
  assert.equal(assistantAskPath("anna", "cardiologist"), "/anna/assistants/physician?ask=cardiologist");
  assert.equal(settingsPath("anna", "user"), "/anna/settings");
  assert.equal(settingsPath("anna", "app"), "/anna/settings/app");
  assert.equal(historyPath("anna"), "/anna/history");
  assert.equal(historyPath("anna", "tsh"), "/anna/history?code=tsh");
  assert.equal(parseProfileTabSegment("docs"), "documents");
  assert.equal(parseProfileTabSegment("history"), "history");
  assert.equal(parseProfileTabSegment("dossier"), "dossier");
  assert.equal(parseProfileTabSegment(undefined), "overview");
  assert.equal(parseProfileTabSegment("plan"), "dossier");
});

test("API paths keep the family and profile ids — they are selectors, never links", () => {
  assert.equal(
    documentApiPath("f1", "p1", "d1"),
    "/v1/families/f1/profiles/p1/documents/d1",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @veylta/web exec tsx --test app/paths.test.ts`
Expected: FAIL (old signatures).

- [ ] **Step 3: Rewrite `app/paths.ts`**

```ts
// apps/web/app/paths.ts
import { ASSISTANT_IDS, type AssistantId, type AssistantSpecialty } from "@veylta/contracts";

/** The browser routes of a person; one place, so no surface spells a URL by hand. */
export const profileTabs = ["overview", "documents", "history", "dossier"] as const;
export type ProfileTab = (typeof profileTabs)[number];

export const loginPath = "/login";

const tabSegment: Record<ProfileTab, string> = {
  overview: "",
  documents: "/docs",
  history: "/history",
  dossier: "/dossier",
};

/** `/<handle>/<segment>` back to a tab; `plan` is the dossier's old name and still answers. */
export function parseProfileTabSegment(segment: string | undefined): ProfileTab {
  switch (segment) {
    case "docs":
    case "documents":
      return "documents";
    case "history":
      return "history";
    case "dossier":
    case "plan":
      return "dossier";
    default:
      return "overview";
  }
}

export function profilePath(handle: string): string {
  return `/${encodeURIComponent(handle)}`;
}

export function profileTabPath(handle: string, tab: ProfileTab): string {
  return `${profilePath(handle)}${tabSegment[tab]}`;
}

export function documentPath(handle: string, documentId: string): string {
  return `${profilePath(handle)}/docs/${encodeURIComponent(documentId)}`;
}

export function historyPath(handle: string, code?: string): string {
  const base = profileTabPath(handle, "history");
  return code === undefined ? base : `${base}?code=${encodeURIComponent(code)}`;
}

/** The `/assistants/:id` segment as one of the closed ids; anything else is no assistant. */
export function parseAssistantId(value: string | undefined): AssistantId | undefined {
  return (ASSISTANT_IDS as readonly string[]).includes(value ?? "")
    ? (value as AssistantId)
    : undefined;
}

export function assistantPath(
  handle: string,
  assistantId: AssistantId,
  conversationId?: string | null,
): string {
  const base = `${profilePath(handle)}/assistants/${encodeURIComponent(assistantId)}`;
  return conversationId === undefined || conversationId === null
    ? base
    : `${base}?conversationId=${encodeURIComponent(conversationId)}`;
}

/** The dossier's way in: the physician's room opens the conversation kept for this addressee. */
export function assistantAskPath(handle: string, ask: AssistantSpecialty | "consilium"): string {
  return `${assistantPath(handle, "physician")}?ask=${encodeURIComponent(ask)}`;
}

/** Settings as a page of this person: «Пользователь» by default, «Приложение» for an admin. */
export function settingsPath(handle: string, section: "user" | "app"): string {
  return `${profilePath(handle)}/settings${section === "app" ? "/app" : ""}`;
}

/** API paths keep the family and profile ids — selectors for the server, never links for people. */
export function documentApiPath(familyId: string, profileId: string, documentId: string): string {
  return `/v1/families/${encodeURIComponent(familyId)}/profiles/${encodeURIComponent(profileId)}/documents/${encodeURIComponent(documentId)}`;
}
```

Delete `normalizeProfileTab` if nothing else uses it after this task (grep); `parseProfileTabSegment` replaces it. Update `app/settings-sections.test.ts` (Task 1 of Part 1) for the new `settingsPath(handle, section)` signature: `settingsPath("anna", "user") === "/anna/settings"`, `settingsPath("anna", "app") === "/anna/settings/app"` (the `?profile=` form is gone — the handle is the person).

- [ ] **Step 4: Run the paths test**

Run: `pnpm --filter @veylta/web exec tsx --test app/paths.test.ts app/settings-sections.test.ts`
Expected: PASS.

- [ ] **Step 5: The route context**

```tsx
// apps/web/app/profile-route.tsx
"use client";

import { createContext, type ReactNode, useContext } from "react";

const ProfileRouteContext = createContext<string | null>(null);

/** The handle of the profile the page is about — what every link on the page is built from. */
export function ProfileRouteProvider({
  handle,
  children,
}: {
  readonly handle: string;
  readonly children: ReactNode;
}) {
  return <ProfileRouteContext.Provider value={handle}>{children}</ProfileRouteContext.Provider>;
}

export function useProfileHandle(): string {
  const handle = useContext(ProfileRouteContext);
  if (handle === null) throw new Error("useProfileHandle outside a ProfileRouteProvider");
  return handle;
}
```

- [ ] **Step 6: Pages**

```tsx
// apps/web/app/login/page.tsx
import { VeyltaApp } from "../components/veylta-app";

/** Sign-in (or first-administrator setup); a signed-in session is sent to its first profile. */
export default function LoginPage() {
  return <VeyltaApp requestedLogin />;
}
```

```tsx
// apps/web/app/page.tsx
import { VeyltaApp } from "./components/veylta-app";

/** `/` is a doorway: the first profile of the session, or /login. */
export default function Home() {
  return <VeyltaApp />;
}
```

```tsx
// apps/web/app/[handle]/page.tsx
import { VeyltaApp } from "../components/veylta-app";

interface ProfilePageProps {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ tab?: string | string[]; canonicalCode?: string | string[] }>;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** `/<handle>` — the overview; an old `?tab=` or `?canonicalCode=` still lands where it pointed. */
export default async function ProfilePage({ params, searchParams }: ProfilePageProps) {
  const { handle } = await params;
  const { tab, canonicalCode } = await searchParams;
  return (
    <VeyltaApp
      requestedHandle={handle}
      requestedTab="overview"
      legacyTab={first(tab)}
      requestedCanonicalCode={first(canonicalCode)}
    />
  );
}
```

```tsx
// apps/web/app/[handle]/docs/page.tsx
import { VeyltaApp } from "../../components/veylta-app";

export default async function DocumentsPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <VeyltaApp requestedHandle={handle} requestedTab="documents" />;
}
```

```tsx
// apps/web/app/[handle]/docs/[documentId]/page.tsx
import { VeyltaApp } from "../../../components/veylta-app";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ handle: string; documentId: string }>;
}) {
  const { handle, documentId } = await params;
  return <VeyltaApp requestedHandle={handle} requestedDocumentId={documentId} />;
}
```

```tsx
// apps/web/app/[handle]/history/page.tsx
import { VeyltaApp } from "../../components/veylta-app";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ code?: string | string[]; canonicalCode?: string | string[] }>;
}) {
  const { handle } = await params;
  const { code, canonicalCode } = await searchParams;
  return (
    <VeyltaApp
      requestedHandle={handle}
      requestedTab="history"
      requestedCanonicalCode={first(code) ?? first(canonicalCode)}
    />
  );
}
```

```tsx
// apps/web/app/[handle]/dossier/page.tsx
import { VeyltaApp } from "../../components/veylta-app";

export default async function DossierPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <VeyltaApp requestedHandle={handle} requestedTab="dossier" />;
}
```

```tsx
// apps/web/app/[handle]/assistants/[assistantId]/page.tsx
import { VeyltaApp } from "../../../components/veylta-app";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; assistantId: string }>;
  searchParams: Promise<{ conversationId?: string | string[]; ask?: string | string[] }>;
}) {
  const { handle, assistantId } = await params;
  const { conversationId, ask } = await searchParams;
  return (
    <VeyltaApp
      requestedHandle={handle}
      requestedAssistantId={assistantId}
      requestedConversationId={first(conversationId)}
      requestedAssistantAsk={first(ask)}
    />
  );
}
```

```tsx
// apps/web/app/[handle]/settings/page.tsx
import { VeyltaApp } from "../../components/veylta-app";

export default async function SettingsPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <VeyltaApp requestedHandle={handle} requestedSettings requestedSettingsSection="user" />;
}
```

```tsx
// apps/web/app/[handle]/settings/app/page.tsx
import { VeyltaApp } from "../../../components/veylta-app";

export default async function SettingsAppPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <VeyltaApp requestedHandle={handle} requestedSettings requestedSettingsSection="app" />;
}
```

Legacy pages become redirectors: the pure destination rule in `app/legacy-destination.ts` (tested), a thin client component in `components/legacy-redirect.tsx`.

```ts
// apps/web/app/legacy-destination.ts
import type { SessionResponse } from "@veylta/contracts";
import {
  assistantPath,
  documentPath,
  historyPath,
  parseAssistantId,
  parseProfileTabSegment,
  profileTabPath,
  settingsPath,
} from "./paths";

export interface LegacyTarget {
  readonly familyId?: string;
  readonly profileId?: string;
  readonly tab?: string;
  readonly documentId?: string;
  readonly assistantId?: string;
  readonly conversationId?: string;
  readonly ask?: string;
  readonly canonicalCode?: string;
  readonly settings?: "user" | "app";
}

/** Where an old `/families/…` or `/settings` link points now, given the session's profiles. */
export function legacyDestination(session: SessionResponse, target: LegacyTarget): string | null {
  const profiles = session.families.flatMap((family) => family.profiles);
  const profile =
    target.profileId === undefined
      ? profiles[0]
      : profiles.find((candidate) => candidate.id === target.profileId);
  if (profile === undefined) return null;
  const handle = profile.handle;
  if (target.settings !== undefined) return settingsPath(handle, target.settings);
  if (target.documentId !== undefined) return documentPath(handle, target.documentId);
  const assistantId = parseAssistantId(target.assistantId);
  if (assistantId !== undefined) {
    const base = assistantPath(handle, assistantId, target.conversationId ?? null);
    return target.ask === undefined ? base : `${base}${base.includes("?") ? "&" : "?"}ask=${encodeURIComponent(target.ask)}`;
  }
  const tab = parseProfileTabSegment(target.tab);
  if (tab === "history") return historyPath(handle, target.canonicalCode);
  return profileTabPath(handle, tab);
}

/** Drops undefined fields so a target literal satisfies `exactOptionalPropertyTypes`. */
export function definedOnly<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}
```

```tsx
// apps/web/app/components/legacy-redirect.tsx
"use client";

import type { SessionResponse } from "@veylta/contracts";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ApiError, apiRequest } from "../api-client";
import { type LegacyTarget, legacyDestination } from "../legacy-destination";
import { loginPath } from "../paths";

/** Renders nothing; replaces the URL once the session is known, or sends to /login. */
export function LegacyRedirect({ target }: { readonly target: LegacyTarget }) {
  const router = useRouter();
  useEffect(() => {
    let active = true;
    apiRequest<SessionResponse>("/v1/session")
      .then((session) => {
        if (!active) return;
        router.replace(legacyDestination(session, target) ?? "/");
      })
      .catch((error: unknown) => {
        if (!active) return;
        router.replace(error instanceof ApiError && error.status === 401 ? loginPath : "/");
      });
    return () => {
      active = false;
    };
  }, [router, target]);
  return null;
}
```

The rule's test:

```ts
// apps/web/app/legacy-destination.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { legacyDestination } from "./legacy-destination";

const session = {
  contractVersion: "family-profile/v3",
  user: { id: "u", username: "braidner", displayName: "Владелец", role: "admin" },
  families: [
    {
      id: "f1",
      displayName: "Семья",
      role: "owner",
      createdAt: "2026-08-18T00:00:00.000Z",
      profiles: [
        { id: "p1", familyId: "f1", displayName: "Владелец", kind: "adult", access: "owner", handle: "braidner", createdAt: "2026-08-18T00:00:00.000Z" },
        { id: "p2", familyId: "f1", displayName: "Анна", kind: "dependent", access: "owner", handle: "anna", createdAt: "2026-08-18T00:00:00.000Z" },
      ],
    },
  ],
} as const;

test("old links land on the same person and surface", () => {
  assert.equal(legacyDestination(session, { familyId: "f1", profileId: "p2" }), "/anna");
  assert.equal(legacyDestination(session, { familyId: "f1", profileId: "p2", tab: "dossier" }), "/anna/dossier");
  assert.equal(legacyDestination(session, { familyId: "f1", profileId: "p2", tab: "history", canonicalCode: "tsh" }), "/anna/history?code=tsh");
  assert.equal(legacyDestination(session, { familyId: "f1", profileId: "p1", documentId: "d1" }), "/braidner/docs/d1");
  assert.equal(legacyDestination(session, { familyId: "f1", profileId: "p1", assistantId: "physician", ask: "consilium" }), "/braidner/assistants/physician?ask=consilium");
  assert.equal(legacyDestination(session, { settings: "app" }), "/braidner/settings/app");
  assert.equal(legacyDestination(session, { profileId: "p2", settings: "user" }), "/anna/settings");
  assert.equal(legacyDestination(session, { familyId: "f1", profileId: "nope" }), null);
});
```

(`FamilySummary` may have more required fields — copy them from `packages/contracts/src/index.ts` into the fixture; pass the fixture as `legacyDestination(session as unknown as SessionResponse, …)`.)

The legacy pages:

```tsx
// apps/web/app/families/[familyId]/profiles/[profileId]/page.tsx
import { LegacyRedirect } from "../../../../components/legacy-redirect";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function LegacyProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string; profileId: string }>;
  searchParams: Promise<{ tab?: string | string[]; canonicalCode?: string | string[] }>;
}) {
  const { familyId, profileId } = await params;
  const { tab, canonicalCode } = await searchParams;
  return (
    <LegacyRedirect
      target={{ familyId, profileId, tab: first(tab), canonicalCode: first(canonicalCode) }}
    />
  );
}
```

and likewise `…/documents/[documentId]/page.tsx` → `target={{ familyId, profileId, documentId }}`, `…/assistants/[assistantId]/page.tsx` → `target={definedOnly({ familyId, profileId, assistantId, conversationId: first(conversationId), ask: first(ask) })}`, `app/settings/page.tsx` → `target={definedOnly({ profileId: first(profile), settings: "user" })}`, `app/settings/app/page.tsx` → `target={definedOnly({ profileId: first(profile), settings: "app" })}`. Wrap every target that may hold `undefined` fields in `definedOnly(…)` (imported from `../legacy-destination`) — `exactOptionalPropertyTypes` rejects an explicit `undefined`.

- [ ] **Step 7: `VeyltaApp` — props, context by handle, redirects**

In `apps/web/app/components/veylta-app.tsx`:

1. Props (`VeyltaAppProps`, ≈319–331): replace `requestedFamilyId?: string; requestedProfileId?: string;` with `requestedHandle?: string | undefined;` and add `requestedLogin?: boolean;` and `legacyTab?: string | undefined;` (the overview page passes an old `?tab=`); remove `requestedSettingsProfileId` (settings open on `requestedHandle`'s person); keep the rest. Destructure accordingly (`requestedLogin = false`).
2. Context: replace `findProfileContext(session, familyId, profileId)` with
   ```ts
   function findProfileByHandle(
     session: SessionResponse,
     handle: string,
   ): { family: SessionFamily; profile: PatientProfileSummary } | undefined {
     const wanted = handle.toLowerCase();
     for (const family of session.families) {
       const profile = family.profiles.find((candidate) => candidate.handle.toLowerCase() === wanted);
       if (profile !== undefined) return { family, profile };
     }
     return undefined;
   }
   ```
   `requestedContext` becomes `requestedHandle`; `hasRequestedProfile = requestedHandle !== undefined`; `context = session && requestedHandle ? findProfileByHandle(session, requestedHandle) : undefined`.
3. Redirects in the first `useEffect`:
   - no session: `if (!requestedLogin) router.replace(loginPath)` (instead of `router.replace("/")`);
   - session present: `if (requestedLogin || (!hasRequestedProfile && profile !== undefined)) router.replace(profilePath(profile.handle))`; at `/` with no profile → stay (NoAuthorizedProfilesScreen).
   - After login/setup handlers (`handleLogin`, `handleSetup`): `router.replace(profilePath(profile.handle))`; `refreshSession` on 401 → `router.replace(loginPath)`; logout → `router.replace(loginPath)`.
   - `legacyTab`: when `requestedHandle` and `legacyTab` are defined and `parseProfileTabSegment(legacyTab) !== "overview"`, `router.replace(profileTabPath(requestedHandle, parseProfileTabSegment(legacyTab)))` once the session is known.
4. `activeTab`: `requestedSettings ? "settings" : requestedDocumentId !== undefined ? "documents" : requestedAssistantId !== undefined ? "overview" : (requestedTab as ProfileTab | undefined) ?? "overview"` — `requestedTab` is now always one of `profileTabs` from the pages (type the prop `requestedTab?: ProfileTab`).
5. Settings: `HomeSettingsScreen` gets `initialProfileId={context?.profile.id}`; it renders only when `context !== undefined` (a `/<handle>/settings` for an unknown handle → `MissingProfileScreen`). Wrap the settings screen and the profile workspace in `<ProfileRouteProvider handle={context.profile.handle}>`.
6. `SettingsGear` (Part 1) now takes `handle: string` and links to `settingsPath(handle, "user")`; render it only when `navigationProfile !== undefined` (it has a handle) — update `settings-gear.tsx` accordingly (`profileId` prop → `handle`).
7. Every `profilePath(x.familyId, x.id)` / `profileTabPath(familyId, profileId, tab)` / `documentPath(…)` / `assistantPath(…)` inside this file becomes the handle form: the profile is at hand wherever these are called (`profile.handle`, `navigationProfile.handle`, `context.profile.handle`, `created.profile.handle`, `fallback.handle`). Use `grep -n "profilePath(\|profileTabPath(\|documentPath(\|assistantPath(\|assistantAskPath(" apps/web/app/components/veylta-app.tsx` and convert each call; `documentProcessingPath(familyId, profileId, documentId, runId)` (≈line 189) builds an **API** path — rewrite it on `documentApiPath(familyId, profileId, documentId)`.
8. `onProfileChange={(familyId, profileId) => …}` → the profile switcher passes the chosen profile; `router.push(profilePath(profile.handle))`.
9. Page title / `aria-label`s unchanged.

- [ ] **Step 8: Components that build links take the handle from the route context**

For each file, add `import { useProfileHandle } from "../profile-route";`, call `const handle = useProfileHandle();` at the top of the component, and convert the calls (the `familyId`/`profileId` props stay for API calls where they are used for that; remove them where they were only for links and fix the call sites):

- `assistant-header.tsx`: `profileTabPath(handle, "overview")`, `profileTabPath(handle, "dossier")`.
- `assistant-panel.tsx` (line ≈130): `profileTabPath(handle, "dossier")`.
- `assistant-workspace.tsx` (≈101, 122, 186): `assistantPath(handle, assistantId, …)`.
- `assistant-source-refs.tsx` (≈36), `assistant-blocks.tsx` (≈98): `documentPath(handle, …)`.
- `clinician-records-panel.tsx` (≈143), `dossier-attention.tsx` (≈136), `dossier-focus.tsx` (≈95): `assistantAskPath(handle, …)`.
- `dossier-gauge.tsx` (≈101): `const href = series.code === null ? historyPath(handle) : historyPath(handle, series.code);`.
- `identity-chips.tsx` (≈51): `profileTabPath(handle, "dossier")`.
- `settings-section-switch.tsx` (Part 1): drop the `profileId` prop, `const handle = useProfileHandle();` and `settingsPath(handle, section)`; `settings-gear.tsx`: prop `handle: string`, `href={settingsPath(handle, "user")}`, rendered only when the header knows a profile.
- `document-agent-panel.tsx` (≈15, ≈229): `documentApiPath(familyId, profileId, documentId)` — these are API URLs.
- `app/profile-dashboard.ts` (pure, no hook): `const { handle } = overview.profile;` and `assistantPath(handle, "physician")`, `profileTabPath(handle, "documents")`, `documentPath(handle, …)`, `assistantPath(handle, "nutritionist")`, `assistantPath(handle, "trainer")`; update `app/profile-dashboard.test.ts` fixtures (`overview.profile.handle = "review"`) and its URL assertions (`/\/assistants\/nutritionist$/` still holds).
- `app/dossier-ask.ts` / `app/clinician-records.ts` — if they build paths, same conversion (grep says they do not; verify).

- [ ] **Step 9: Typecheck, unit tests, line budget**

Run: `pnpm exec biome check --write apps/web/app && pnpm --filter @veylta/web typecheck && pnpm --filter @veylta/web test && pnpm lint`
Expected: green; `veylta-app.tsx` not above its baseline.

- [ ] **Step 10: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): /<handle> routes with tabs as segments, /login, legacy /families redirects

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: The handle field in «Пользователь»

**Files:**
- Create: `apps/web/app/components/profile-handle-form.tsx`
- Create: `apps/web/app/profile-handle-copy.ts`, `apps/web/app/profile-handle-copy.test.ts`
- Modify: `apps/web/app/components/settings-user-section.tsx` (render the form above `ProfileManagementSettings` for the selected profile when `access === "owner"` or `"self"`)

**Interfaces:**
- Consumes: `PUT /v1/families/:f/profiles/:p/handle` (Task 4), `isValidProfileHandle`, `RESERVED_PROFILE_HANDLES` (contracts), `useProfileHandle` (Task 5), `settingsPath` (Task 5).
- Produces: `handleFieldError(value: string): string | null` (copy for an invalid/reserved value), `handleSaveErrorCopy(error: unknown): string`.

- [ ] **Step 1: Write the failing copy test**

```ts
// apps/web/app/profile-handle-copy.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "./api-client";
import { handleFieldError, handleSaveErrorCopy } from "./profile-handle-copy";

test("the field explains the rule before the server has to", () => {
  assert.equal(handleFieldError("anna"), null);
  assert.equal(handleFieldError("Anna"), null, "case is folded, not refused");
  assert.match(handleFieldError("an") ?? "", /от 3 до 30/);
  assert.match(handleFieldError("анна") ?? "", /латиница/);
  assert.match(handleFieldError("anna-") ?? "", /дефис/);
  assert.match(handleFieldError("login") ?? "", /занято системой/);
});

test("the server's answers read as sentences", () => {
  assert.match(handleSaveErrorCopy(new ApiError(409, "CONFLICT")), /уже занят/);
  assert.match(handleSaveErrorCopy(new ApiError(422, "VALIDATION")), /не подходит/);
  assert.match(handleSaveErrorCopy(new Error("network")), /соединение/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @veylta/web exec tsx --test app/profile-handle-copy.test.ts` — FAIL (module missing).

- [ ] **Step 3: Write the copy module and the form**

```ts
// apps/web/app/profile-handle-copy.ts
import {
  isValidProfileHandle,
  MAX_PROFILE_HANDLE_LENGTH,
  MIN_PROFILE_HANDLE_LENGTH,
  PROFILE_HANDLE_PATTERN,
  RESERVED_PROFILE_HANDLES,
} from "@veylta/contracts";
import { ApiError } from "./api-client";

/** The rule in the person's words, before the request; null when the value may be sent. */
export function handleFieldError(value: string): string | null {
  const handle = value.trim().toLowerCase();
  if (handle.length < MIN_PROFILE_HANDLE_LENGTH || handle.length > MAX_PROFILE_HANDLE_LENGTH) {
    return `Адрес — от ${MIN_PROFILE_HANDLE_LENGTH} до ${MAX_PROFILE_HANDLE_LENGTH} символов.`;
  }
  if (/[^a-z0-9-]/.test(handle)) return "Только латиница, цифры и дефис.";
  if (!PROFILE_HANDLE_PATTERN.test(handle)) return "Дефис не может стоять в начале или в конце.";
  if (RESERVED_PROFILE_HANDLES.includes(handle)) return "Это слово занято системой.";
  return isValidProfileHandle(handle) ? null : "Адрес не подходит.";
}

export function handleSaveErrorCopy(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) return "Такой адрес уже занят другим профилем.";
  if (error instanceof ApiError && error.status === 422) return "Адрес не подходит по правилам.";
  return "Не удалось сохранить адрес. Проверьте соединение и повторите.";
}
```

```tsx
// apps/web/app/components/profile-handle-form.tsx
"use client";

import type { PatientProfileSummary, ProfileHandleResponse } from "@veylta/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { apiRequest } from "../api-client";
import { settingsPath } from "../paths";
import { handleFieldError, handleSaveErrorCopy } from "../profile-handle-copy";

/**
 * The person's own address: `/<handle>` on this server. Validated in the field by the same rule
 * the server enforces; on success the session is refreshed and the page moves to the new address.
 */
export function ProfileHandleForm({
  profile,
  onSaved,
}: {
  readonly profile: PatientProfileSummary;
  readonly onSaved: () => Promise<void>;
}) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(profile.handle);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldError = handleFieldError(value);
  const unchanged = value.trim().toLowerCase() === profile.handle;

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (fieldError !== null || unchanged) return;
    setPending(true);
    setError(null);
    try {
      const saved = await apiRequest<ProfileHandleResponse>(
        `/v1/families/${encodeURIComponent(profile.familyId)}/profiles/${encodeURIComponent(profile.id)}/handle`,
        { method: "PUT", body: JSON.stringify({ handle: value.trim().toLowerCase() }) },
      );
      await onSaved();
      router.replace(settingsPath(saved.handle, "user"));
    } catch (requestError) {
      setError(handleSaveErrorCopy(requestError));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="profile-handle" aria-labelledby={`${id}-title`} onSubmit={(event) => void save(event)}>
      <div className="settings-section-heading">
        <div>
          <p className="section-label">Адрес страницы</p>
          <h2 id={`${id}-title`}>{profile.displayName}</h2>
        </div>
        <p>
          /<strong>{profile.handle}</strong>
        </p>
      </div>
      <label htmlFor={`${id}-handle`}>
        Адрес
        <input
          id={`${id}-handle`}
          value={value}
          maxLength={30}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={fieldError !== null}
          aria-describedby={`${id}-hint`}
          onChange={(event) => setValue(event.target.value)}
          disabled={pending}
        />
      </label>
      <small id={`${id}-hint`} className="field-hint">
        {fieldError ?? "Латиница, цифры и дефис, от 3 до 30 символов. Старый адрес перестанет открываться."}
      </small>
      <button
        className="button button--secondary"
        type="submit"
        disabled={pending || unchanged || fieldError !== null}
      >
        {pending ? "Сохраняем…" : "Сохранить адрес"}
      </button>
      {error !== null ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
```

In `settings-user-section.tsx`: find the managed profile (the one of `initialProfileId`, else the first) the way `ProfileManagementSettings` does, and when `selected.family.role === "owner" || selected.profile.access === "self"` render `<ProfileHandleForm profile={selected.profile} onSaved={onSessionRefresh} />` above `ProfileManagementSettings`; `SettingsUserSection` gains `onSessionRefresh: () => Promise<void>` (passed from `HomeSettingsScreen`'s `onSessionRefresh`). Add CSS in `globals.css`: `.profile-handle { display: grid; gap: 10px; margin-bottom: 18px; } .profile-handle input { max-width: 320px; }` following the existing settings form styles (`.settings-section-heading` already applies).

- [ ] **Step 4: Tests and typecheck**

Run: `pnpm --filter @veylta/web exec tsx --test app/profile-handle-copy.test.ts && pnpm --filter @veylta/web typecheck && pnpm lint`
Expected: PASS / green.

- [ ] **Step 5: Commit**

```bash
pnpm exec biome check --write apps/web/app
git add apps/web/app
git commit -m "feat(web): a person sets their page address in settings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: e2e — the stand on handle routes, plus a handles scenario

**Files:**
- Modify: `e2e/support/synthetic-family.ts` (`createSyntheticFamily` path and the acceptance path), `e2e/support/review.ts` (`openReview` URL regex), `e2e/support/dossier.ts` (`?tab=dossier`)
- Modify: every spec under `e2e/` that matches `grep -l "/families/\|tab=\|/documents/" e2e/*.spec.ts`: `assistant.spec.ts`, `assistant-nutritionist.spec.ts`, `assistant-trainer.spec.ts`, `assistant-outcomes.spec.ts`, `clinician-records.spec.ts`, `dashboard-redesign.spec.ts`, `document-review.spec.ts`, `document-upload.spec.ts`, `dossier.spec.ts`, `family-profile.spec.ts`, `health-summary.spec.ts`, `observation-history.spec.ts`, `readme-screenshots.spec.ts`, `account-setup.spec.ts`
- Create: `e2e/profile-handles.spec.ts`

- [ ] **Step 1: Support helpers**

`e2e/support/synthetic-family.ts`: `DemoRegistrationResponse.profile` now has `handle`; `const path = \`/${registration.profile.handle}\`;` and `page.goto(path)`; `expect(page).toHaveURL(new RegExp(\`${path}$\`))`. In `acceptSyntheticInvitation`: `accepted.profile === null ? "/" : \`/${accepted.profile.handle}\`` (the acceptance response's `profile` carries `handle` from Task 4; if that response type is `{ id } | null` only, extend the e2e type to `{ id: string; handle: string } | null` — the API returns the full summary).

`e2e/support/review.ts` `openReview`: the regex becomes `/\/[a-z0-9-]+\/docs\/[0-9a-f-]{36}$/`.

`e2e/support/dossier.ts`: `page.goto(\`${profileUrl}/dossier\`)`.

- [ ] **Step 2: Sweep the specs**

Mechanical rules (apply with care, then read each diff):
- `profileUrl = page.url().replace(/\/documents\/[0-9a-f-]{36}$/, "")` → `.replace(/\/docs\/[0-9a-f-]{36}$/, "")`.
- `${profileUrl}?tab=dossier` → `${profileUrl}/dossier`; `?tab=documents` → `/docs`; `?tab=history` → `/history`; `?tab=history&canonicalCode=X` → `/history?code=X`.
- URL regexes `/\/families\/[0-9a-f-]+\/profiles\/[0-9a-f-]+$/` → `/\/[a-z0-9-]+$/`; `…\/documents\/[0-9a-f-]{36}$/` → `/\/[a-z0-9-]+\/docs\/[0-9a-f-]{36}$/`; `/\/assistants\/physician$/` and the `?conversationId=` forms stay.
- `page.goto("/settings")` in `account-setup.spec.ts` → the gear now opens `/<handle>/settings`; the URL regex `/\/settings\?profile=…$/` from Part 1 becomes `/\/[a-z0-9-]+\/settings$/` and `/\/[a-z0-9-]+\/settings\/app$/`; the forbidden-access check `page.goto("/settings")` → `page.goto(\`${userProfileUrl}/settings/app\`)` and expect «Настройки недоступны».
- `dashboard-redesign.spec.ts` asserts links on the overview — replace any `/families/` expectations with handle paths (`/\/[a-z0-9-]+\/docs$/` etc.).
- After sign-in/registration, assertions `toHaveURL(/\/families\/…$/)` → `/\/[a-z0-9-]+$/` but **exclude** `/login`: use `/^http:\/\/[^/]+\/(?!login$)[a-z0-9-]+$/`.

- [ ] **Step 3: The handles scenario**

```ts
// e2e/profile-handles.spec.ts
import { expect, test } from "@playwright/test";
import { registerDemoFamily } from "./support/review";

// A person's page lives at /<handle>; /login signs in; the owner renames the handle and the
// address follows; the old /families/… link still lands on the same person.

test("the profile lives at its handle, sign-in at /login, the owner renames, old links redirect", async ({
  page,
}) => {
  await registerDemoFamily(page);
  await expect(page).toHaveURL(/\/[a-z0-9-]+$/);
  const handle = new URL(page.url()).pathname.slice(1);
  expect(handle).not.toBe("login");

  // Old address shapes redirect to the handle.
  const session = await page.request.get("/health-api/v1/session");
  const body = (await session.json()) as { families: Array<{ id: string; profiles: Array<{ id: string; handle: string }> }> };
  const family = body.families[0];
  const profile = family?.profiles[0];
  if (family === undefined || profile === undefined) throw new Error("no profile");
  expect(profile.handle).toBe(handle);
  await page.goto(`/families/${family.id}/profiles/${profile.id}?tab=dossier`);
  await expect(page).toHaveURL(new RegExp(`/${handle}/dossier$`));
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/${handle}$`));

  // Rename in settings; the page moves with it; the old handle is gone.
  await page.getByTestId("settings-gear").click();
  await expect(page).toHaveURL(new RegExp(`/${handle}/settings$`));
  const field = page.getByLabel("Адрес");
  await field.fill("login");
  await expect(page.getByText("Это слово занято системой.")).toBeVisible();
  await field.fill("Anna-Test");
  await page.getByRole("button", { name: "Сохранить адрес" }).click();
  await expect(page).toHaveURL(/\/anna-test\/settings$/);
  await page.goto("/anna-test");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Добрый");
  await page.goto(`/${handle}`);
  await expect(page.getByRole("heading", { level: 1, name: "Профиль недоступен" })).toBeVisible();

  // Signed out, every page is the door.
  await page.request.delete("/health-api/v1/session").catch(() => undefined);
  await page.goto("/anna-test/docs");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Войдите в Veylta" })).toBeVisible();
});
```

The sign-out is `DELETE /v1/session` (what «Выйти» calls): `await page.request.delete("/health-api/v1/session", { headers: { origin: "http://127.0.0.1:4400" } })`. The greeting heading text («Добрый …») is the overview's time-of-day greeting — assert `page.getByRole("heading", { name: "Помощники" })` instead if it proves brittle.

- [ ] **Step 4: Run the whole e2e suite**

Run: `pnpm build && pnpm test:e2e`
Expected: all specs pass (≈45). Fix any regex left behind by reading the failure's received URL.

- [ ] **Step 5: Commit**

```bash
pnpm exec biome check --write e2e
git add e2e
git commit -m "test(e2e): the stand speaks /<handle> routes; a handles scenario

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, full check, push

**Files:**
- Modify: `CLAUDE.md` (the «Web ↔ API» and «Settings» paragraphs, the Medical profile/Assistants mentions of `app/paths.ts`), `README.md` (any URL shapes mentioned), `docs/status.md` (item 28), `docs/superpowers/specs/2026-08-18-shell-routes-documents-history-design.md` (Part 2 status line)

- [ ] **Step 1: Docs**

`CLAUDE.md` — add to the «Web ↔ API» paragraph:

```md
Browser routes address a person by handle (`patient_profiles.handle`, server-unique, migration
0038; `apps/api/src/family/profile-handle.ts` is the default rule — username, then the
transliterated name, suffixed when taken; `patient-profiles.ts` `createPatientProfile` is the one
insert; `pnpm db:migrate` backfills provisional `p-<hex>` handles): `/<handle>`, `/<handle>/docs`,
`/<handle>/docs/:id`, `/<handle>/history?code=`, `/<handle>/dossier`, `/<handle>/assistants/:id`,
`/<handle>/settings[/app]`, `/login`; `app/paths.ts` is the only place that builds them and
`useProfileHandle()` (`app/profile-route.tsx`) hands the handle to components. Old
`/families/:f/profiles/:p…` and `/settings` links redirect through `components/legacy-redirect.tsx`.
API paths keep `/v1/families/:f/profiles/:p/…`; `PUT …/profiles/:p/handle` renames (owner or the
linked adult; 422 invalid/reserved, 409 taken; audited payload-free).
```

`docs/status.md` item 28:

```md
28. reach a person at `/<handle>` — the login, or the name — with the tabs as path segments and
    sign-in at `/login`; an owner renames the handle in settings; old `/families/…` links redirect.
```

Spec: in Part 2 add «Status: delivered on <date>» under the heading.

- [ ] **Step 2: Full check sequence, local migrate, push**

Run: `pnpm license:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:e2e`
Expected: green.
Run: `pnpm db:migrate` (the local stand: applies 0038 and prints `backfilled: N`), then `curl -s localhost:4301/readyz` → `"status":"ok"`.

```bash
git add CLAUDE.md README.md docs/status.md docs/superpowers/specs/2026-08-18-shell-routes-documents-history-design.md
git commit -m "docs: profile handles and the short browser routes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
gh run list --limit 1
```

Wait for the run (`gh run view <id> --json status,conclusion`) to be `success`.
