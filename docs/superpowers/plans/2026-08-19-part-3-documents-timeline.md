# Part 3 — Documents: Queue and Timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The documents tab becomes a short queue of documents that still need the machine or the person, and below it a vertical timeline of reviewed documents by their effective date — which the person can correct.

**Architecture:** One pure rule decides a document's *effective date* (`override → intelligence.documentDate → uploadedAt`) and one pure rule decides *queue membership* (`processing.state !== "completed" || pendingFactCount > 0`); both live where API and web can share them (contracts for the queue rule and the out-of-range rule, `apps/api/src/documents/document-date.ts` for the date rule with `latestCorrectableDate` in contracts). Migration 0039 adds `documents.document_date_override`; a new `PUT …/documents/:id/date` and a new `GET …/documents/timeline` (whole-day pages) live in their own service and route modules beside `document-service.ts`, which only gains `effectiveDate` in `summary()` and `documentCount` in the overview after a DRY extraction of its two overview document queries makes room. The web gets pure modules `app/document-queue.ts` and `app/document-timeline.ts`, hooks `use-archive-actions.ts` / `use-document-timeline.ts`, and components `documents-workspace.tsx` → `document-queue.tsx` + `document-timeline.tsx` + `document-date-editor.tsx`; `veylta-app.tsx` loses its documents-tab markup to them.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Fastify + `node:sqlite` (`apps/api`), Next.js 16 / React 19 (`apps/web`), `node:test` + `node:assert/strict`, Playwright e2e on the synthetic stand (`scripts/run-e2e.mjs`, fake codex).

**Spec:** `docs/superpowers/specs/2026-08-18-shell-routes-documents-history-design.md` — section «Part 3 — documents: queue and timeline» (lines 143–194) plus «Delivery, verification, boundaries». Parts 1–2 are delivered; Part 4 follows this plan.

## Global Constraints

- Contract versions bump on every shape change and every literal copy follows: `document/v7` → `document/v8` (`DocumentSummary` and `DocumentDetail` gain `effectiveDate`), `profile-overview/v2` → `profile-overview/v3` (`ProfileOverviewDocument.effectiveDate`, `ProfileOverviewResponse.documentCount`), new `document-timeline/v1`. Literal copies today: `packages/contracts/src/index.test.ts`, `apps/api/src/processing/processing-job-service.test.ts` (4× `document/v7`), `apps/web/app/profile-dashboard.test.ts` (`profile-overview/v2`), e2e `document-upload.spec.ts` (2×), `document-review.spec.ts` (1×), `document-agent.spec.ts` (2×), `README.md:275`.
- Effective date rule (spec): `override` → `intelligence.documentDate` → `uploadedAt` as a UTC calendar day (`substr(uploaded_at, 1, 10)`), with `source: "person" | "document" | "upload"`.
- Queue rule (spec): a document is in the queue while `processing.state !== "completed"` **or** it still has facts without a review decision; everything else is in the timeline. The timeline endpoint returns only documents that left the queue.
- `PUT …/documents/:documentId/date` with `{ documentDate }` (`YYYY-MM-DD` or `null`): `requireProfileWrite`, 422 for a malformed date or one later than tomorrow (UTC), 404 for an unknown/unauthorised/deleted document, audited payload-free as `document.date.corrected` (no date in the audit row); the same value again changes nothing and writes no audit row.
- `GET …/documents/timeline?before=<YYYY-MM-DD>&limit=<1..50>`: entries ordered by `effectiveDate` desc, `uploadedAt` desc, `id` desc; **a page is whole days** — the `limit` most recent days (before `before`, exclusive) that have an entry, with every entry of those days; `nextBefore` is the oldest returned day or `null`. Entry: `id, originalFilename, contentType, uploadedAt, effectiveDate, category, title, shortSummary, confirmedCount, outsideRangeCount, recordCount`.
- «Outside range» is the dossier's rule: printed bounds first (`sourceLow`/`sourceHigh` read as numbers, «6,8» → 6.8), then the laboratory's flag, else unknown; the rule moves to `packages/contracts/src/observation-status.ts` and the dossier imports it — one rule, API and web.
- Audit rows payload-free; cross-tenant/unauthorised → 404 never 403; routes → service → storage; services throw `ResourceNotFoundError` / `DomainConflictError` / `DomainValidationError` (`sendDomainError` maps them). New migration bumps `requiredSchemaMigration` in `apps/api/src/database/pool.ts`; `.down.sql` must reverse (CI runs migrate → rollback → migrate).
- `pnpm lint` file ratchet: no file over 250 lines; legacy files listed in `config/file-length-baseline.json` may only shrink (never edit the JSON): `document-service.ts` 5015, `documents/routes.ts` 720, `veylta-app.tsx` 7363, `packages/contracts/src/index.ts` 1483, `e2e/document-upload.spec.ts` 298, `e2e/document-review.spec.ts` 321, `apps/api/test/profile-overview.integration.test.ts` 406, `apps/api/test/document-upload.integration.test.ts` 787. New code goes to new files; a legacy file is edited only where the change must live there.
- UI text Russian; code, comments, commits English; `.js` extensions on relative imports in `apps/api` and `packages/contracts`, extensionless in `apps/web`; optional fields via conditional spread; `node:test` + `node:assert/strict`; integration tests on temp databases (`mkdtemp` + `migrateUp`), never `.local/veylta.sqlite`; synthetic data only.
- Commit trailer on every commit: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Contracts — `document/v8`, `profile-overview/v3`, `document-timeline/v1`, the shared queue and out-of-range rules

**Files:**
- Create: `packages/contracts/src/document-timeline.ts`, `packages/contracts/src/document-timeline.test.ts`
- Create: `packages/contracts/src/observation-status.ts`, `packages/contracts/src/observation-status.test.ts`
- Modify: `packages/contracts/src/index.ts` (versions at lines 21 and 31; `DocumentSummary` ≈642–659; `ProfileOverviewDocument` ≈846–853; `ProfileOverviewResponse` ≈865–883; `export *` block ≈13–20), `packages/contracts/src/index.test.ts` (lines 75, 86)
- Modify (literal sweep + fixtures): `apps/api/src/processing/processing-job-service.test.ts` (lines 410, 416, 454, 525), `apps/web/app/profile-dashboard.test.ts` (line 8 + fixture fields), `e2e/document-upload.spec.ts` (174, 199), `e2e/document-review.spec.ts` (213), `e2e/document-agent.spec.ts` (65, 110), `README.md` (275)
- Modify (web adopts the shared rule): `apps/web/app/dossier.ts` (`statusOf` 46–59, `outside` 61–62, `PointStatus` 12), `apps/web/app/dossier-numbers.ts` (`numberOf` 9–15)

**Interfaces:**
- Produces: `DOCUMENT_TIMELINE_CONTRACT_VERSION = "document-timeline/v1"`, `DOCUMENT_DATE_SOURCES`, `DocumentDateSource`, `DocumentEffectiveDate { value, source }`, `DocumentDateRequest { documentDate: string | null }`, `DocumentDateResponse { contractVersion: typeof DOCUMENT_CONTRACT_VERSION; documentId; effectiveDate }`, `DocumentTimelineEntry`, `DocumentTimelineResponse { contractVersion; entries; nextBefore }`, `MAX_DOCUMENT_TIMELINE_DAYS = 50`, `isInDocumentQueue(processing, pendingFactCount)`, `latestCorrectableDate(now: Date): string`; `numberOf`, `POINT_STATUSES`, `PointStatus`, `PrintedRange`, `pointStatus(value, range)`, `isOutsideRange(status)`; `DocumentSummary.effectiveDate`, `ProfileOverviewDocument.effectiveDate`, `ProfileOverviewResponse.documentCount`.

- [ ] **Step 1: Write the failing contract tests**

```ts
// packages/contracts/src/document-timeline.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_TIMELINE_CONTRACT_VERSION,
  isInDocumentQueue,
  latestCorrectableDate,
  MAX_DOCUMENT_TIMELINE_DAYS,
} from "./document-timeline.js";

test("a document is in the queue until its processing completed and every fact is decided", () => {
  assert.equal(isInDocumentQueue({ state: "not_started" }, 0), true);
  assert.equal(isInDocumentQueue({ state: "queued", updatedAt: "2026-08-10T08:00:00.000Z" }, 0), true);
  assert.equal(
    isInDocumentQueue({ state: "text_extraction", updatedAt: "2026-08-10T08:00:00.000Z" }, 0),
    true,
  );
  assert.equal(
    isInDocumentQueue(
      {
        state: "failed",
        updatedAt: "2026-08-10T08:00:00.000Z",
        category: "extraction_failed",
        retryAllowed: true,
      },
      0,
    ),
    true,
  );
  assert.equal(
    isInDocumentQueue(
      { state: "awaiting_review", updatedAt: "2026-08-10T08:00:00.000Z", factCount: 2, needsReviewCount: 1 },
      2,
    ),
    true,
  );
  assert.equal(
    isInDocumentQueue({ state: "completed", updatedAt: "2026-08-10T08:00:00.000Z", factCount: 2 }, 1),
    true,
    "a completed run with an undecided fact is still the person's turn",
  );
  assert.equal(
    isInDocumentQueue({ state: "completed", updatedAt: "2026-08-10T08:00:00.000Z", factCount: 2 }, 0),
    false,
  );
});

test("the latest correctable date is tomorrow in UTC", () => {
  assert.equal(latestCorrectableDate(new Date("2026-08-19T23:30:00.000Z")), "2026-08-20");
  assert.equal(latestCorrectableDate(new Date("2026-12-31T00:00:00.000Z")), "2027-01-01");
  assert.equal(MAX_DOCUMENT_TIMELINE_DAYS, 50);
  assert.equal(DOCUMENT_TIMELINE_CONTRACT_VERSION, "document-timeline/v1");
});
```

```ts
// packages/contracts/src/observation-status.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { isOutsideRange, numberOf, pointStatus } from "./observation-status.js";

test("printed numbers read with a comma or a dot; anything else is no number", () => {
  assert.equal(numberOf("6,8"), 6.8);
  assert.equal(numberOf(" 12.50 "), 12.5);
  assert.equal(numberOf("-0,4"), -0.4);
  assert.equal(numberOf("< 0,1"), null);
  assert.equal(numberOf("отр."), null);
  assert.equal(numberOf(null), null);
  assert.equal(numberOf(undefined), null);
});

test("status comes from the printed bounds, then from the laboratory's own flag, else unknown", () => {
  const range = (sourceLow: string | null, sourceHigh: string | null, flag: boolean | null) => ({
    sourceLow,
    sourceHigh,
    laboratoryOutOfRange: flag,
  });
  assert.equal(pointStatus(0.2, range("0,4", "4,0", null)), "below");
  assert.equal(pointStatus(9.9, range("0,4", "4,0", null)), "above");
  assert.equal(pointStatus(2.2, range("0,4", "4,0", null)), "within");
  assert.equal(pointStatus(9.9, range(null, "5", null)), "above", "one bound is enough");
  assert.equal(pointStatus(9.9, range(null, null, true)), "flagged");
  assert.equal(pointStatus(9.9, range(null, null, false)), "within");
  assert.equal(pointStatus(9.9, range(null, null, null)), "unknown");
  assert.equal(pointStatus(null, range(null, "5", null)), "unknown", "a comparison value has no number");
  assert.equal(pointStatus(null, range(null, "5", true)), "flagged", "no number, but the laboratory said so");
  assert.equal(pointStatus(9.9, null), "unknown");
  assert.deepEqual(
    ["above", "below", "flagged", "within", "unknown"].map((status) =>
      isOutsideRange(status as "above" | "below" | "flagged" | "within" | "unknown"),
    ),
    [true, true, true, false, false],
  );
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @veylta/contracts exec tsx --test src/document-timeline.test.ts src/observation-status.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Write the two modules**

```ts
// packages/contracts/src/document-timeline.ts
import type { DocumentCategory, DocumentProcessingStatus, SyntheticDocumentContentType } from "./index.js";
import type { DOCUMENT_CONTRACT_VERSION } from "./index.js";

export const DOCUMENT_TIMELINE_CONTRACT_VERSION = "document-timeline/v1" as const;

/** Days per timeline page: a page is whole days, so `limit` counts days with an entry. */
export const MAX_DOCUMENT_TIMELINE_DAYS = 50;

/** Where a document's effective date comes from: the person's correction, the document, the upload. */
export const DOCUMENT_DATE_SOURCES = ["person", "document", "upload"] as const;
export type DocumentDateSource = (typeof DOCUMENT_DATE_SOURCES)[number];

export interface DocumentEffectiveDate {
  /** A calendar day, `YYYY-MM-DD`. */
  readonly value: string;
  readonly source: DocumentDateSource;
}

/** `PUT …/documents/:documentId/date` — a calendar day, or null to drop the correction. */
export interface DocumentDateRequest {
  readonly documentDate: string | null;
}

export interface DocumentDateResponse {
  readonly contractVersion: typeof DOCUMENT_CONTRACT_VERSION;
  readonly documentId: string;
  readonly effectiveDate: DocumentEffectiveDate;
}

export interface DocumentTimelineEntry {
  readonly id: string;
  readonly originalFilename: string;
  readonly contentType: SyntheticDocumentContentType;
  readonly uploadedAt: string;
  readonly effectiveDate: DocumentEffectiveDate;
  readonly category: DocumentCategory | null;
  readonly title: string | null;
  readonly shortSummary: string | null;
  /** Confirmed observations of this document. */
  readonly confirmedCount: number;
  /** Confirmed observations outside their printed range or flagged by the laboratory. */
  readonly outsideRangeCount: number;
  /** Confirmed clinician records of this document. */
  readonly recordCount: number;
}

/**
 * `GET …/documents/timeline?before=<YYYY-MM-DD>&limit=<1..50>`: the `limit` most recent days
 * (strictly before `before`) that carry a reviewed document, with every entry of those days,
 * newest first. `nextBefore` is the oldest returned day, or null when nothing older exists.
 */
export interface DocumentTimelineResponse {
  readonly contractVersion: typeof DOCUMENT_TIMELINE_CONTRACT_VERSION;
  readonly entries: readonly DocumentTimelineEntry[];
  readonly nextBefore: string | null;
}

/**
 * The one queue rule, shared by the timeline query and the web: a document stays in the queue
 * while the machine is not done with it or the person still has a fact to decide.
 */
export function isInDocumentQueue(
  processing: DocumentProcessingStatus,
  pendingFactCount: number,
): boolean {
  return processing.state !== "completed" || pendingFactCount > 0;
}

/** The latest date a person may give a document: tomorrow, in UTC — one rule for 422 and for the field's max. */
export function latestCorrectableDate(now: Date): string {
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.toISOString().slice(0, 10);
}
```

```ts
// packages/contracts/src/observation-status.ts
/** The dossier's reading of one value against the source's own reference — API and web share it. */

export const POINT_STATUSES = ["above", "below", "within", "flagged", "unknown"] as const;
export type PointStatus = (typeof POINT_STATUSES)[number];

export interface PrintedRange {
  readonly sourceLow: string | null;
  readonly sourceHigh: string | null;
  readonly laboratoryOutOfRange: boolean | null;
}

/** «6,8» → 6.8; anything that is not one plain number («< 0,1», «отр.») → null. */
export function numberOf(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Printed bounds first, then the laboratory's flag, else unknown; a value without a number never compares. */
export function pointStatus(value: number | null, range: PrintedRange | null): PointStatus {
  if (range === null) return "unknown";
  const low = numberOf(range.sourceLow);
  const high = numberOf(range.sourceHigh);
  if (value !== null && (low !== null || high !== null)) {
    if (low !== null && value < low) return "below";
    if (high !== null && value > high) return "above";
    return "within";
  }
  if (range.laboratoryOutOfRange === true) return "flagged";
  if (range.laboratoryOutOfRange === false) return "within";
  return "unknown";
}

export const isOutsideRange = (status: PointStatus): boolean =>
  status === "above" || status === "below" || status === "flagged";
```

- [ ] **Step 4: Change `index.ts`**

In `packages/contracts/src/index.ts`:
- line 21: `export const DOCUMENT_CONTRACT_VERSION = "document/v8" as const;`
- line 31: `export const PROFILE_OVERVIEW_CONTRACT_VERSION = "profile-overview/v3" as const;`
- in the `export *` block (≈13–20) add, alphabetically: `export * from "./document-timeline.js";` and `export * from "./observation-status.js";`
- `DocumentSummary` (≈642–659): after `readonly uploadedAt: string;` add `readonly effectiveDate: DocumentEffectiveDate;` with `import type { DocumentEffectiveDate } from "./document-timeline.js";` at the top (type-only, so the cycle stays erased at runtime — the same pattern `profile-responses.ts` uses toward `index.ts`).
- `ProfileOverviewDocument` (≈846–853): after `readonly uploadedAt: string;` add `readonly effectiveDate: DocumentEffectiveDate;`.
- `ProfileOverviewResponse` (≈865–883): after `readonly profile: PatientProfileSummary;` add `/** Active documents of the profile — the «всего» of the documents page; `recentDocuments` is capped. */ readonly documentCount: number;`.
- `index.test.ts` lines 75 and 86: `"document/v8"`, `"profile-overview/v3"`.

`index.ts` must stay ≤ 1483 lines (it is 1446; these edits add ≤ 8).

- [ ] **Step 5: The web adopts the shared rule; the literal sweep**

`apps/web/app/dossier-numbers.ts`: delete the local `numberOf` (lines 9–15) and add `export { numberOf } from "@veylta/contracts";` so `dossier.ts` and `dossier-passport.ts` keep importing it from here.

`apps/web/app/dossier.ts`: delete `statusOf` (46–59) and `outside` (61–62) and the local `export type PointStatus = …` (12); add `import { isOutsideRange, type PointStatus, pointStatus } from "@veylta/contracts";` and `export type { PointStatus };` (keeps the type exported from the dossier for its consumers); at line ≈71 `status: pointStatus(value, item.referenceRange),` — the old call site passed `(item, value)`; `item.referenceRange` already has the `PrintedRange` fields (`sourceLow`, `sourceHigh`, `laboratoryOutOfRange`, plus `sourceText`/`sourceUnit`, which a structural type accepts); replace the three `outside(…)` calls (≈116, 181, 207) with `isOutsideRange(…)`. `dossier.test.ts` stays as it is and must still pass.

Literal sweep: `apps/api/src/processing/processing-job-service.test.ts` 410/416/454/525 → `"document/v8"`; `e2e/document-upload.spec.ts` 174/199, `e2e/document-review.spec.ts` 213, `e2e/document-agent.spec.ts` 65/110 → `"document/v8"`; `README.md:275` → `document/v8`; `apps/web/app/profile-dashboard.test.ts` line 8 → `"profile-overview/v3"`. Web test fixtures that build the changed shapes must gain the new fields or `pnpm --filter @veylta/web typecheck` goes red: `profile-dashboard.test.ts` and `documents-archive.test.ts` (their `ProfileOverviewResponse` literals gain `documentCount: <the number of documents listed>` and every `recentDocuments` entry gains `effectiveDate: { value: "<its uploadedAt day>", source: "upload" }`), `document-experience.test.ts` (its `DocumentSummary` literal gains the same `effectiveDate`). Grep `recentDocuments:` and `originalFilename:` under `apps/web/app/*.test.ts` to be sure none is missed.

- [ ] **Step 6: Build, test, check sizes**

Run: `pnpm --filter @veylta/contracts build && pnpm --filter @veylta/contracts test && pnpm --filter @veylta/web typecheck && pnpm --filter @veylta/web test && pnpm exec biome check --write packages/contracts/src apps/web/app e2e && pnpm lint`
Expected: contracts tests pass (the two new files + the version pins), web typecheck and tests green (fixtures updated), `File lengths OK`. `pnpm --filter @veylta/api typecheck` is now red on `effectiveDate`/`documentCount` (Task 3 closes it) — the only red allowed between Tasks 1 and 3.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src apps/web/app/dossier.ts apps/web/app/dossier-numbers.ts apps/web/app/profile-dashboard.test.ts apps/api/src/processing/processing-job-service.test.ts e2e/document-upload.spec.ts e2e/document-review.spec.ts e2e/document-agent.spec.ts README.md
git commit -m "feat(contracts): document/v8 with the effective date, profile-overview/v3, document-timeline/v1; the queue and out-of-range rules shared

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: API — one builder for the overview's two document queries (room and DRY)

**Files:**
- Create: `apps/api/src/documents/overview-documents-query.ts`
- Modify: `apps/api/src/documents/document-service.ts` (the `recentDocuments` query ≈3623–3714 and the `reviewDocuments` query ≈3750–3842 inside `getProfileOverview`; the `MAX_PROFILE_OVERVIEW_REVIEW_DOCUMENTS` import if it becomes unused)

**Interfaces:**
- Produces: `overviewDocumentsSql(options: { onlyAwaitingReview: boolean; limit: number }): string` — the SQL of the overview's document query with `$1 = familyId`, `$2 = profileId`; the row shape is `ProfileOverviewDocumentRow` unchanged. Task 3 adds `d.document_date_override` here, in one place.

- [ ] **Step 1: Write the builder**

The two queries differ only in how `extraction_runs r` is joined (`LEFT JOIN` vs `JOIN … AND r.status = 'awaiting_review'`), in the position of the `processing_jobs` join (irrelevant to the result) and in the `LIMIT`. Write:

```ts
// apps/api/src/documents/overview-documents-query.ts
/**
 * The overview's document query: one document per row with its first version, blob, latest
 * job, latest extraction run, latest intelligence and the fact/review counts of that run.
 * `recentDocuments` reads every active document; the review queue reads only those whose
 * latest run awaits review. Parameters: `$1` family id, `$2` profile id.
 */
export function overviewDocumentsSql(options: {
  readonly onlyAwaitingReview: boolean;
  readonly limit: number;
}): string {
  const runJoin = options.onlyAwaitingReview
    ? `JOIN extraction_runs r
         ON r.id = (
           SELECT latest_run.id
             FROM extraction_runs latest_run
            WHERE latest_run.family_id = d.family_id
              AND latest_run.document_version_id = v.id
            ORDER BY latest_run.created_at DESC, latest_run.id DESC
            LIMIT 1
         )
        AND r.status = 'awaiting_review'`
    : `LEFT JOIN extraction_runs r
         ON r.id = (
           SELECT latest_run.id
             FROM extraction_runs latest_run
            WHERE latest_run.family_id = d.family_id
              AND latest_run.document_version_id = v.id
            ORDER BY latest_run.created_at DESC, latest_run.id DESC
            LIMIT 1
         )`;
  return `SELECT d.id,
                 d.family_id,
                 d.patient_profile_id,
                 d.status,
                 d.original_filename,
                 d.uploaded_at,
                 duplicate.id AS duplicate_of_document_id,
                 duplicate.patient_profile_id AS duplicate_profile_id,
                 COALESCE(blob_type.content_type, b.content_type) AS content_type,
                 b.byte_size,
                 b.sha256,
                 b.storage_key,
                 v.id AS document_version_id,
                 j.id AS job_id,
                 j.state AS job_state,
                 j.current_stage AS job_current_stage,
                 j.last_error_code AS job_last_error_code,
                 j.updated_at AS job_updated_at,
                 r.id AS extraction_run_id,
                 r.status AS extraction_status,
                 intelligence.provider AS intelligence_provider,
                 intelligence.model_id AS intelligence_model_id,
                 intelligence.runtime_version AS intelligence_runtime_version,
                 intelligence.schema_version AS intelligence_schema_version,
                 intelligence.category AS intelligence_category,
                 intelligence.title AS intelligence_title,
                 intelligence.short_summary AS intelligence_short_summary,
                 intelligence.document_date AS intelligence_document_date,
                 intelligence.confidence AS intelligence_confidence,
                 COUNT(f.id) AS fact_count,
                 COALESCE(SUM(CASE WHEN d_review.id IS NULL AND f.id IS NOT NULL THEN 1 ELSE 0 END), 0)
                   AS pending_fact_count,
                 COALESCE(SUM(CASE
                   WHEN d_review.id IS NULL AND f.review_status = 'needs_review' THEN 1
                   ELSE 0
                 END), 0) AS needs_attention_fact_count
            FROM documents d
            JOIN document_versions v
              ON v.family_id = d.family_id AND v.document_id = d.id AND v.version_number = 1
            JOIN document_blobs b
              ON b.family_id = v.family_id AND b.id = v.blob_id
            LEFT JOIN document_blob_content_types blob_type
              ON blob_type.family_id = b.family_id AND blob_type.blob_id = b.id
            LEFT JOIN documents duplicate
              ON duplicate.family_id = d.family_id AND duplicate.id = d.duplicate_of_document_id
             AND duplicate.deleted_at IS NULL
            LEFT JOIN processing_jobs j
              ON j.id = (
                SELECT latest_job.id
                  FROM processing_jobs latest_job
                 WHERE latest_job.family_id = d.family_id
                   AND latest_job.document_version_id = v.id
                   AND latest_job.kind = 'document_extraction'
                 ORDER BY latest_job.created_at DESC, latest_job.id DESC
                 LIMIT 1
              )
            ${runJoin}
            LEFT JOIN document_intelligence_results intelligence
              ON intelligence.id = (
                SELECT latest_intelligence.id
                  FROM document_intelligence_results latest_intelligence
                 WHERE latest_intelligence.family_id = d.family_id
                   AND latest_intelligence.document_version_id = v.id
                 ORDER BY latest_intelligence.created_at DESC, latest_intelligence.id DESC
                 LIMIT 1
              )
            LEFT JOIN extracted_facts f
              ON f.family_id = r.family_id AND f.extraction_run_id = r.id
            LEFT JOIN review_decisions d_review
              ON d_review.family_id = f.family_id AND d_review.extracted_fact_id = f.id
           WHERE d.family_id = $1 AND d.patient_profile_id = $2 AND d.deleted_at IS NULL
           GROUP BY d.id, d.family_id, d.patient_profile_id, d.status, d.original_filename,
                    d.uploaded_at, duplicate.id, duplicate.patient_profile_id,
                    blob_type.content_type, b.content_type, b.byte_size, b.sha256, b.storage_key,
                    v.id, j.id, j.state, j.current_stage, j.last_error_code, j.updated_at,
                    r.id, r.status, intelligence.provider, intelligence.model_id,
                    intelligence.runtime_version, intelligence.schema_version,
                    intelligence.category, intelligence.title, intelligence.short_summary,
                    intelligence.document_date, intelligence.confidence
           ORDER BY d.uploaded_at DESC, d.id DESC
           LIMIT ${options.limit}`;
}
```

(The review-queue query today writes `latest_run.family_id = v.family_id`; `v.family_id = d.family_id` by the join, so one spelling is exact for both.)

- [ ] **Step 2: Use it in `getProfileOverview`**

Replace the whole `recentDocuments` query text with `overviewDocumentsSql({ onlyAwaitingReview: false, limit: 50 })` and the `reviewDocuments` query text with `overviewDocumentsSql({ onlyAwaitingReview: true, limit: MAX_PROFILE_OVERVIEW_REVIEW_DOCUMENTS })`, both still `client.query<ProfileOverviewDocumentRow>(…, [scope.familyId, scope.profileId])`. Add `import { overviewDocumentsSql } from "./overview-documents-query.js";`.

- [ ] **Step 3: Verify — behaviour unchanged**

Run: `pnpm --filter @veylta/api typecheck; pnpm --filter @veylta/api exec tsx --test --test-concurrency=1 test/profile-overview.integration.test.ts test/document-review.integration.test.ts && pnpm lint`
Expected: typecheck still shows only Task 1's `effectiveDate`/`documentCount` errors (none new); the two suites pass; `File lengths OK`; `document-service.ts` lost ≈170 lines (report the number).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/documents/overview-documents-query.ts apps/api/src/documents/document-service.ts
git commit -m "refactor(api): one builder for the overview's two document queries

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: API — migration 0039, the effective-date rule, `effectiveDate` on every summary, `documentCount`

**Files:**
- Create: `db/migrations/0039_document_date_override.up.sql`, `db/migrations/0039_document_date_override.down.sql`
- Create: `apps/api/src/documents/document-date.ts`, `apps/api/src/documents/document-date.test.ts`
- Create: `apps/api/test/document-date-migration.integration.test.ts`
- Modify: `apps/api/src/database/pool.ts` (`requiredSchemaMigration`), `apps/api/src/documents/document-service.ts` (`DocumentRow` ≈296; `summary()` ≈1334; the `documentRow()` SELECT ≈1722; the evidence-bundle document SELECT ≈2779; `getProfileOverview` response), `apps/api/src/documents/overview-documents-query.ts` (select + GROUP BY), `apps/api/test/profile-overview.integration.test.ts`, `apps/api/test/document-upload.integration.test.ts`

**Interfaces:**
- Produces: `effectiveDocumentDate(input: { override: string | null; documentDate: string | null; uploadedAt: string }): DocumentEffectiveDate`, `isCalendarDate(value: string): boolean`; `DocumentRow.document_date_override: string | null`; `ProfileOverviewResponse.documentCount`.

- [ ] **Step 1: Write the failing unit test of the rule**

```ts
// apps/api/src/documents/document-date.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { effectiveDocumentDate, isCalendarDate } from "./document-date.js";

test("the effective date: the person's correction, then the document's own date, then the upload day in UTC", () => {
  const uploadedAt = "2026-08-19T23:40:00.000Z";
  assert.deepEqual(
    effectiveDocumentDate({ override: "2026-05-14", documentDate: "2026-08-12", uploadedAt }),
    { value: "2026-05-14", source: "person" },
  );
  assert.deepEqual(effectiveDocumentDate({ override: null, documentDate: "2026-08-12", uploadedAt }), {
    value: "2026-08-12",
    source: "document",
  });
  assert.deepEqual(effectiveDocumentDate({ override: null, documentDate: null, uploadedAt }), {
    value: "2026-08-19",
    source: "upload",
  });
});

test("a calendar date is ten characters that round-trip through the calendar", () => {
  assert.equal(isCalendarDate("2026-02-28"), true);
  assert.equal(isCalendarDate("2026-02-30"), false);
  assert.equal(isCalendarDate("2026-8-1"), false);
  assert.equal(isCalendarDate("2026-08-12T00:00:00.000Z"), false);
  assert.equal(isCalendarDate("yesterday"), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @veylta/api exec tsx --test src/documents/document-date.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Write the rule**

```ts
// apps/api/src/documents/document-date.ts
import type { DocumentEffectiveDate } from "@veylta/contracts";

/** `YYYY-MM-DD` naming a real day (no `2026-02-30`, no timestamp, no short form). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The one rule for a document's date: what the person said, else what the document says,
 * else the day it was uploaded (UTC). Every projection and the timeline order read this.
 */
export function effectiveDocumentDate(input: {
  readonly override: string | null;
  readonly documentDate: string | null;
  readonly uploadedAt: string;
}): DocumentEffectiveDate {
  if (input.override !== null) return { value: input.override, source: "person" };
  if (input.documentDate !== null) return { value: input.documentDate, source: "document" };
  return { value: new Date(input.uploadedAt).toISOString().slice(0, 10), source: "upload" };
}

/** The same rule as SQL, for ordering and paging in the timeline query; `alias` is the documents alias. */
export function effectiveDateSql(alias: string, intelligenceAlias: string): string {
  return `COALESCE(${alias}.document_date_override, ${intelligenceAlias}.document_date, substr(${alias}.uploaded_at, 1, 10))`;
}
```

Run the test again: PASS.

- [ ] **Step 4: Migration 0039 and the readiness gate**

```sql
-- db/migrations/0039_document_date_override.up.sql
-- The person's correction of a document's date; NULL means the document's own date or the upload day applies.
ALTER TABLE documents ADD COLUMN document_date_override TEXT CHECK (
  document_date_override IS NULL
  OR (
    length(document_date_override) = 10
    AND document_date_override GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(document_date_override) = document_date_override
  )
);
```

```sql
-- db/migrations/0039_document_date_override.down.sql
-- Rolling back and re-applying forgets every date a person corrected.
ALTER TABLE documents DROP COLUMN document_date_override;
```

`apps/api/src/database/pool.ts`: `requiredSchemaMigration` → `"0039_document_date_override"`.

Migration test (the chain helper reads the list, so no literal list anywhere):

```ts
// apps/api/test/document-date-migration.integration.test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase } from "../src/database/pool.js";
import { reapplyFrom, rollbackTo } from "./migration-chain.js";

test("0039 adds a checked document_date_override, rolls back and re-applies", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-document-date-"));
  const database = createDatabase(join(root, "test.sqlite"));
  try {
    await migrateUp(database);
    const columns = await database.query<{ name: string }>(`PRAGMA table_info(documents)`);
    assert.ok(columns.rows.some((column) => column.name === "document_date_override"));
    // Foreign keys are on (pool.ts `PRAGMA foreign_keys = ON`): a user, a family, a profile, a document.
    const userId = randomUUID();
    const familyId = randomUUID();
    const profileId = randomUUID();
    const documentId = randomUUID();
    const now = "2026-08-19T10:00:00.000Z";
    await database.transaction(async (client) => {
      await client.query("INSERT INTO users (id, display_name, created_at) VALUES ($1, $2, $3)", [
        userId,
        "Владелец",
        now,
      ]);
      await client.query(
        `INSERT INTO families (id, display_name, created_by_user_id, created_at) VALUES ($1, $2, $3, $4)`,
        [familyId, "Семья", userId, now],
      );
      await client.query(
        `INSERT INTO patient_profiles (id, family_id, display_name, kind, linked_user_id, created_by_user_id, created_at)
         VALUES ($1, $2, 'Анна', 'adult', $3, $3, $4)`,
        [profileId, familyId, userId, now],
      );
      await client.query(
        `INSERT INTO documents (id, family_id, patient_profile_id, status, original_filename, uploaded_by_user_id, uploaded_at)
         VALUES ($1, $2, $3, 'uploaded', 'report.pdf', $4, $5)`,
        [documentId, familyId, profileId, userId, now],
      );
    });
    await database.query(`UPDATE documents SET document_date_override = '2026-05-14' WHERE id = $1`, [documentId]);
    await assert.rejects(
      database.query(`UPDATE documents SET document_date_override = '2026-02-30' WHERE id = $1`, [documentId]),
      /CHECK constraint failed/,
    );
    await assert.rejects(
      database.query(`UPDATE documents SET document_date_override = '14.05.2026' WHERE id = $1`, [documentId]),
      /CHECK constraint failed/,
    );
    await rollbackTo(database, "0039_document_date_override");
    const after = await database.query<{ name: string }>(`PRAGMA table_info(documents)`);
    assert.ok(!after.rows.some((column) => column.name === "document_date_override"));
    await reapplyFrom(database, "0039_document_date_override");
    const again = await database.query<{ name: string }>(`PRAGMA table_info(documents)`);
    assert.ok(again.rows.some((column) => column.name === "document_date_override"));
  } finally {
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
});
```

(The four inserts are the ones `apps/api/test/profile-handles-migration.integration.test.ts` `seedFamily` uses, minus `app_accounts` and `family_memberships`, which no FK here needs; `patient_profiles.handle` stays NULL — nullable by 0038.)

Run: `pnpm --filter @veylta/api exec tsx --test --test-concurrency=1 test/document-date-migration.integration.test.ts` → PASS.

- [ ] **Step 5: Thread the column into every `DocumentRow` and the summaries**

In `apps/api/src/documents/document-service.ts`:
- `interface DocumentRow` (≈296): add `document_date_override: string | null;` after `uploaded_at: string;`.
- `documentRow()` SELECT (≈1727): the line `d.uploaded_at,` becomes `d.uploaded_at, d.document_date_override,` (same line — template-literal SQL is not reformatted).
- the evidence-bundle document SELECT (≈2784): likewise `d.uploaded_at, d.document_date_override,` — only because `EvidenceBundleDocumentRow extends DocumentRow`; `evidenceBundleDocument()` builds `SyntheticEvidenceBundleDocument` field by field and the bundle contracts (`synthetic-evidence-bundle/v1`, `synthetic-profile-export/v1`) do **not** gain `effectiveDate` — the same boundary Part 2 drew for the handle.
- `summary()` (≈1334): add
  ```ts
      effectiveDate: effectiveDocumentDate({
        override: row.document_date_override,
        documentDate: intelligence?.documentDate ?? null,
        uploadedAt: row.uploaded_at,
      }),
  ```
  after `uploadedAt: …,` with `import { effectiveDocumentDate } from "./document-date.js";`.
- `getProfileOverview`: add, before the `recentDocuments` query,
  ```ts
        const documentCount = (
          await client.query<{ document_count: number }>(
            `SELECT COUNT(*) AS document_count FROM documents
              WHERE family_id = $1 AND patient_profile_id = $2 AND deleted_at IS NULL`,
            [scope.familyId, scope.profileId],
          )
        ).rows[0];
  ```
  and in the response `documentCount: asCount(documentCount?.document_count ?? -1, "overview document count"),` after `profile:`.
- `profileOverviewDocument()` (≈1256): add `effectiveDate: document.effectiveDate,` to the returned object (the `summary()` call already computes it).

In `overview-documents-query.ts`: the select line `d.uploaded_at,` becomes `d.uploaded_at, d.document_date_override,` and the GROUP BY line `d.uploaded_at, duplicate.id, duplicate.patient_profile_id,` becomes `d.uploaded_at, d.document_date_override, duplicate.id, duplicate.patient_profile_id,`.

Run: `pnpm --filter @veylta/api typecheck` → clean (Task 1's errors are closed; if `DocumentDetail` assembly somewhere spreads `summary()` it inherits `effectiveDate` — check `getDocument` ≈3258 still typechecks).

- [ ] **Step 6: Integration assertions**

In `apps/api/test/profile-overview.integration.test.ts` (legacy, ≤ 406 lines — add assertions inside an existing test rather than a new block if room is short): where the overview of a profile with the uploaded synthetic report is read, assert `overview.contractVersion === "profile-overview/v3"`, `overview.documentCount === overview.recentDocuments.length` (for that fixture), and for the report `recentDocuments[0].effectiveDate` deep-equals `{ value: recentDocuments[0].uploadedAt.slice(0, 10), source: "upload" }` (the lab fixture carries no «Дата:» line, so its `documentDate` is null); in `apps/api/test/document-upload.integration.test.ts` (legacy, ≤ 787) assert on the upload response `document.contractVersion === "document/v8"` where it is already asserted, and `document.document.effectiveDate.source === "upload"`. If a file cannot take another line within its baseline, put the new assertions into a new file `apps/api/test/document-effective-date.integration.test.ts` using `startAssistantApp` + `confirmSyntheticReport` + `analyseSyntheticNote` (the note's `effectiveDate` is `{ value: "2026-08-12", source: "document" }` — the fixture's «Дата: 2026-08-12»).

Run: `pnpm --filter @veylta/api test && pnpm test:integration && pnpm lint`
Expected: green; `File lengths OK`.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/0039_document_date_override.up.sql db/migrations/0039_document_date_override.down.sql apps/api/src/database/pool.ts apps/api/src/documents apps/api/test
git commit -m "feat(api): the effective document date — migration 0039, one rule, every summary carries it; the overview counts its documents

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: API — `PUT …/documents/:documentId/date`

**Files:**
- Create: `apps/api/src/documents/document-date-service.ts`, `apps/api/src/documents/document-date-routes.ts`
- Create: `apps/api/test/document-date.integration.test.ts`
- Modify: `apps/api/src/server.ts` (after `registerDocumentRoutes(...)` ≈114), `apps/api/test/assistant-app.ts` (after `registerDocumentRoutes(...)` ≈98–105)

**Interfaces:**
- Consumes: `effectiveDocumentDate`, `isCalendarDate` (Task 3); `latestCorrectableDate`, `DocumentDateRequest/Response` (Task 1); `requireProfileWrite`, `canonicalProfileScope` (`family/profile-access.ts`); `DomainValidationError`, `ResourceNotFoundError`, `SessionActor` (`family/family-service.ts`).
- Produces: `setDocumentDate(database, input: { actor; scope: { familyId; profileId; documentId }; documentDate: string | null; correlationId: string; now?: Date }): Promise<DocumentDateResponse>`; `registerDocumentDateRoutes(app, family, database, options: { allowedMutationOrigins: readonly string[] })`.

- [ ] **Step 1: Write the failing integration test**

```ts
// apps/api/test/document-date.integration.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { startAssistantApp } from "./assistant-app.js";
import { register, webOrigin } from "./medical-profile-app.js";
import { confirmSyntheticReport } from "./confirmed-observations.js";

test("the person corrects a document's date: the rule applies, 422/404 hold, the audit row is payload-free", async () => {
  const { app, database, storageRoot, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Date owner");
    const other = await register(app, "Date other");
    const { documentId } = await confirmSyntheticReport(app, database, storageRoot, owner);
    const base = `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${documentId}`;
    const headers = { cookie: owner.cookie, origin: webOrigin };

    const before = await app.inject({ method: "GET", url: base, headers: { cookie: owner.cookie } });
    assert.equal(before.json().contractVersion, "document/v8");
    assert.equal(before.json().document.effectiveDate.source, "upload");

    const corrected = await app.inject({ method: "PUT", url: `${base}/date`, headers, payload: { documentDate: "2026-05-14" } });
    assert.equal(corrected.statusCode, 200, corrected.body);
    assert.deepEqual(corrected.json(), {
      contractVersion: "document/v8",
      documentId,
      effectiveDate: { value: "2026-05-14", source: "person" },
    });
    const after = await app.inject({ method: "GET", url: base, headers: { cookie: owner.cookie } });
    assert.deepEqual(after.json().document.effectiveDate, { value: "2026-05-14", source: "person" });

    const same = await app.inject({ method: "PUT", url: `${base}/date`, headers, payload: { documentDate: "2026-05-14" } });
    assert.equal(same.statusCode, 200, "the same date again is a no-op");

    for (const [documentDate, status] of [
      ["2026-02-30", 422],
      ["14.05.2026", 422],
      ["2999-01-01", 422],
    ] as const) {
      const response = await app.inject({ method: "PUT", url: `${base}/date`, headers, payload: { documentDate } });
      assert.equal(response.statusCode, status, `${documentDate}: ${response.body}`);
    }
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const edge = await app.inject({ method: "PUT", url: `${base}/date`, headers, payload: { documentDate: tomorrow } });
    assert.equal(edge.statusCode, 200, "tomorrow is the latest allowed day");

    const cleared = await app.inject({ method: "PUT", url: `${base}/date`, headers, payload: { documentDate: null } });
    assert.equal(cleared.statusCode, 200);
    assert.equal(cleared.json().effectiveDate.source, "upload");

    const stranger = await app.inject({
      method: "PUT",
      url: `${base}/date`,
      headers: { cookie: other.cookie, origin: webOrigin },
      payload: { documentDate: "2026-05-14" },
    });
    assert.equal(stranger.statusCode, 404);
    const unknown = await app.inject({
      method: "PUT",
      url: `${base.replace(documentId, "00000000-0000-4000-8000-000000000099")}/date`,
      headers,
      payload: { documentDate: "2026-05-14" },
    });
    assert.equal(unknown.statusCode, 404);
    const noOrigin = await app.inject({ method: "PUT", url: `${base}/date`, headers: { cookie: owner.cookie }, payload: { documentDate: "2026-05-14" } });
    assert.equal(noOrigin.statusCode, 403);

    const audit = await database.query<{ metadata: string }>(
      `SELECT metadata FROM audit_events WHERE family_id = $1 AND action = 'document.date.corrected'`,
      [owner.body.family.id],
    );
    assert.equal(audit.rows.length, 3, "set, tomorrow, cleared — the no-op and the refusals are not audited");
    for (const row of audit.rows) {
      assert.deepEqual(JSON.parse(row.metadata), { contractVersion: "document/v8" });
    }
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @veylta/api exec tsx --test --test-concurrency=1 test/document-date.integration.test.ts`
Expected: FAIL (404 from Fastify — no route).

- [ ] **Step 3: Service and route**

```ts
// apps/api/src/documents/document-date-service.ts
import { randomUUID } from "node:crypto";
import {
  DOCUMENT_CONTRACT_VERSION,
  type DocumentDateResponse,
  latestCorrectableDate,
} from "@veylta/contracts";
import type { Database } from "../database/pool.js";
import {
  DomainValidationError,
  ResourceNotFoundError,
  type SessionActor,
} from "../family/family-service.js";
import { canonicalProfileScope, requireProfileWrite } from "../family/profile-access.js";
import { effectiveDocumentDate, isCalendarDate } from "./document-date.js";

interface DocumentDateRow {
  document_date_override: string | null;
  uploaded_at: string;
  intelligence_document_date: string | null;
}

/**
 * The person's correction of a document's date. Null drops it; a malformed day or one after
 * tomorrow (UTC) is a 422; a document the session may not write, or none, is a 404. The same
 * value again changes nothing and writes no audit row; the audit row never carries the date.
 */
export async function setDocumentDate(
  database: Database,
  input: {
    actor: SessionActor;
    scope: { familyId: string; profileId: string; documentId: string };
    documentDate: string | null;
    correlationId: string;
    now?: Date;
  },
): Promise<DocumentDateResponse> {
  const scope = canonicalProfileScope(input.scope);
  const documentId = input.scope.documentId.toLowerCase();
  const now = input.now ?? new Date();
  if (
    input.documentDate !== null &&
    (!isCalendarDate(input.documentDate) || input.documentDate > latestCorrectableDate(now))
  ) {
    throw new DomainValidationError();
  }
  return database.transaction(async (client) => {
    await requireProfileWrite(client, input.actor, scope);
    const current = (
      await client.query<DocumentDateRow>(
        `SELECT d.document_date_override,
                d.uploaded_at,
                intelligence.document_date AS intelligence_document_date
           FROM documents d
           JOIN document_versions v
             ON v.family_id = d.family_id AND v.document_id = d.id AND v.version_number = 1
           LEFT JOIN document_intelligence_results intelligence
             ON intelligence.id = (
               SELECT latest.id FROM document_intelligence_results latest
                WHERE latest.family_id = d.family_id AND latest.document_version_id = v.id
                ORDER BY latest.created_at DESC, latest.id DESC
                LIMIT 1
             )
          WHERE d.family_id = $1 AND d.patient_profile_id = $2 AND d.id = $3 AND d.deleted_at IS NULL`,
        [scope.familyId, scope.profileId, documentId],
      )
    ).rows[0];
    if (current === undefined) throw new ResourceNotFoundError();
    const effective = (override: string | null) =>
      effectiveDocumentDate({
        override,
        documentDate: current.intelligence_document_date,
        uploadedAt: current.uploaded_at,
      });
    const response = (override: string | null): DocumentDateResponse => ({
      contractVersion: DOCUMENT_CONTRACT_VERSION,
      documentId,
      effectiveDate: effective(override),
    });
    if (current.document_date_override === input.documentDate) return response(input.documentDate);
    await client.query(
      `UPDATE documents SET document_date_override = $1
        WHERE family_id = $2 AND patient_profile_id = $3 AND id = $4`,
      [input.documentDate, scope.familyId, scope.profileId, documentId],
    );
    await client.query(
      `INSERT INTO audit_events
         (id, family_id, actor_user_id, action, resource_type, resource_id, result,
          correlation_id, metadata, created_at)
       VALUES ($1, $2, $3, 'document.date.corrected', 'Document', $4, 'success', $5, $6, $7)`,
      [
        randomUUID(),
        scope.familyId,
        input.actor.userId,
        documentId,
        input.correlationId,
        { contractVersion: DOCUMENT_CONTRACT_VERSION },
        now,
      ],
    );
    return response(input.documentDate);
  });
}
```

(`family/profile-handle-service.ts` is the twin of this shape — same audit insert, same error classes; the pool serialises the metadata object and the `Date`.)

```ts
// apps/api/src/documents/document-date-routes.ts
import type { DocumentDateRequest } from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import type { Database } from "../database/pool.js";
import type { FamilyService } from "../family/family-service.js";
import {
  canonicalUuidSchema,
  privateResponse,
  requireActor,
  requireTrustedOrigin,
  sendDomainError,
} from "../http/route-helpers.js";
import { setDocumentDate } from "./document-date-service.js";

interface DocumentParams {
  familyId: string;
  profileId: string;
  documentId: string;
}

/** `PUT /v1/families/:familyId/profiles/:profileId/documents/:documentId/date` — the person's correction of the date. */
export function registerDocumentDateRoutes(
  app: FastifyInstance,
  family: FamilyService,
  database: Database,
  options: { allowedMutationOrigins: readonly string[] },
): void {
  const origins = new Set(options.allowedMutationOrigins);
  app.put<{ Params: DocumentParams; Body: DocumentDateRequest }>(
    "/v1/families/:familyId/profiles/:profileId/documents/:documentId/date",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["familyId", "profileId", "documentId"],
          properties: {
            familyId: canonicalUuidSchema,
            profileId: canonicalUuidSchema,
            documentId: canonicalUuidSchema,
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["documentDate"],
          // Shape only; the calendar and the "not after tomorrow" bound are the service's 422.
          properties: { documentDate: { type: ["string", "null"], minLength: 10, maxLength: 10 } },
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
          await setDocumentDate(database, {
            actor,
            scope: request.params,
            documentDate: request.body.documentDate,
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

(The body schema rejects `"14.05.2026"` only by length — it is 10 characters, so it reaches the service and gets the service's 422, which is what the test asserts; a schema 400 for other shapes is fine.)

- [ ] **Step 4: Register**

`apps/api/src/server.ts`: after `registerDocumentRoutes(app, familyService, documentService, {...});` add
```ts
registerDocumentDateRoutes(app, familyService, database, {
  allowedMutationOrigins: config.webOrigins,
});
```
with `import { registerDocumentDateRoutes } from "./documents/document-date-routes.js";` (check the names `database` and `config.webOrigins` against how `registerProfileHandleRoutes` is called a few lines above — mirror exactly).

`apps/api/test/assistant-app.ts`: after the `registerDocumentRoutes(...)` call add `registerDocumentDateRoutes(app, family, database, { allowedMutationOrigins: [webOrigin] });` with the import.

- [ ] **Step 5: Run**

Run: `pnpm exec biome check --write apps/api && pnpm --filter @veylta/api typecheck && pnpm --filter @veylta/api exec tsx --test --test-concurrency=1 test/document-date.integration.test.ts && pnpm lint`
Expected: PASS; `File lengths OK`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/documents/document-date-service.ts apps/api/src/documents/document-date-routes.ts apps/api/src/server.ts apps/api/test/assistant-app.ts apps/api/test/document-date.integration.test.ts
git commit -m "feat(api): PUT …/documents/:id/date — the person corrects a document's date

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: API — `GET …/documents/timeline` (whole-day pages)

**Files:**
- Create: `apps/api/src/documents/document-timeline-service.ts`, `apps/api/src/documents/document-timeline-query.ts`, `apps/api/src/documents/document-timeline-routes.ts`
- Create: `apps/api/test/document-timeline.integration.test.ts`
- Modify: `apps/api/src/server.ts`, `apps/api/test/assistant-app.ts` (register the route next to Task 4's)

**Interfaces:**
- Consumes: `effectiveDateSql` (Task 3), `pointStatus`, `isOutsideRange`, `numberOf`, `DocumentTimelineResponse`, `DOCUMENT_TIMELINE_CONTRACT_VERSION`, `MAX_DOCUMENT_TIMELINE_DAYS`, `DOCUMENT_CATEGORIES` (contracts); `profileAccess`, `canonicalProfileScope` (`family/profile-access.ts`); `DomainValidationError`.
- Produces: `getDocumentTimeline(database, input: { actor; scope; before?: string; limit?: string; correlationId }): Promise<DocumentTimelineResponse>`; `registerDocumentTimelineRoutes(app, family, database)`.

- [ ] **Step 1: Write the failing integration test**

```ts
// apps/api/test/document-timeline.integration.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { startAssistantApp } from "./assistant-app.js";
import { register, webOrigin } from "./medical-profile-app.js";
import { confirmSyntheticReport } from "./confirmed-observations.js";
import { analyseSyntheticNote } from "./synthetic-note.js";

test("the timeline shows reviewed documents by effective date in whole-day pages with their counts; the queue stays out", async () => {
  const { app, database, storageRoot, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Timeline owner");
    const other = await register(app, "Timeline other");
    const base = `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}`;
    const get = (query = "") =>
      app.inject({ method: "GET", url: `${base}/documents/timeline${query}`, headers: { cookie: owner.cookie } });

    const empty = await get();
    assert.equal(empty.statusCode, 200, empty.body);
    assert.deepEqual(empty.json(), { contractVersion: "document-timeline/v1", entries: [], nextBefore: null });

    // A reviewed report: confirm analyte a as printed, reject b — one confirmed observation.
    const report = await confirmSyntheticReport(app, database, storageRoot, owner, (factKey) =>
      factKey === "synthetic-analyte-a" ? "confirm" : "reject",
    );
    // The discharge note: zero facts, so its run completes at once; its own date is 2026-08-12.
    const note = await analyseSyntheticNote(app, database, storageRoot, owner);
    // One more report that stays in the queue: upload it and do not review (a second confirmSyntheticReport would review it — upload directly instead).
    // Use the overview to find the queue, not this endpoint.

    const all = await get();
    const entries = all.json().entries as Array<{ id: string; effectiveDate: { value: string; source: string }; confirmedCount: number; outsideRangeCount: number; recordCount: number; title: string | null; category: string | null }>;
    assert.deepEqual(
      entries.map((entry) => entry.id),
      [report.documentId, note.documentId],
      "the report (uploaded today) comes before the note (2026-08-12)",
    );
    const [reportEntry, noteEntry] = entries;
    assert.equal(reportEntry?.effectiveDate.source, "upload");
    assert.equal(reportEntry?.confirmedCount, 1);
    assert.equal(reportEntry?.recordCount, 0);
    assert.deepEqual(noteEntry?.effectiveDate, { value: "2026-08-12", source: "document" });
    assert.equal(noteEntry?.confirmedCount, 0);
    assert.equal(all.json().nextBefore, null);

    // Confirm two of the note's records; the count follows. (ClinicianRecordsResponse: `items[].resultKey`,
    // `intelligenceResultId`; ClinicianRecordDecisionRequest: `{ intelligenceResultId, decision: "confirm" }`.)
    const records = await app.inject({ method: "GET", url: `${base}/documents/${note.documentId}/clinician-records`, headers: { cookie: owner.cookie } });
    assert.equal(records.statusCode, 200, records.body);
    const analysis = records.json() as { intelligenceResultId: string; items: Array<{ resultKey: string }> };
    for (const { resultKey } of analysis.items.slice(0, 2)) {
      const decided = await app.inject({
        method: "PUT",
        url: `${base}/documents/${note.documentId}/clinician-records/${resultKey}`,
        headers: { cookie: owner.cookie, origin: webOrigin },
        payload: { intelligenceResultId: analysis.intelligenceResultId, decision: "confirm" },
      });
      assert.equal(decided.statusCode, 201, decided.body);
    }
    const withRecords = await get();
    assert.equal((withRecords.json().entries as Array<{ recordCount: number }>)[1]?.recordCount, 2);

    // Move the report to May: it sorts after the note and carries the person's source.
    const moved = await app.inject({
      method: "PUT",
      url: `${base}/documents/${report.documentId}/date`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { documentDate: "2026-05-14" },
    });
    assert.equal(moved.statusCode, 200, moved.body);
    const reordered = await get();
    assert.deepEqual(
      (reordered.json().entries as Array<{ id: string }>).map((entry) => entry.id),
      [note.documentId, report.documentId],
    );

    // Whole-day pages: one day per page → two pages, the older reached through nextBefore.
    const first = await get("?limit=1");
    assert.equal((first.json().entries as unknown[]).length, 1);
    assert.equal(first.json().nextBefore, "2026-08-12");
    const second = await get(`?limit=1&before=${first.json().nextBefore}`);
    assert.deepEqual((second.json().entries as Array<{ id: string }>).map((entry) => entry.id), [report.documentId]);
    assert.equal(second.json().nextBefore, null);

    for (const query of ["?limit=0", "?limit=51", "?limit=abc", "?before=2026-13-01", "?before=yesterday"]) {
      const refused = await get(query);
      assert.ok(refused.statusCode === 400 || refused.statusCode === 422, `${query}: ${refused.statusCode}`);
    }
    const stranger = await app.inject({ method: "GET", url: `${base}/documents/timeline`, headers: { cookie: other.cookie } });
    assert.equal(stranger.statusCode, 404);
  } finally {
    await close();
  }
});
```

Also assert the report's `outsideRangeCount`: read the fixture's printed range for `synthetic-analyte-a` in `scripts/fake-codex-exec.mjs` (the `FACT|` line and its «low–high unit» reference) and assert `0` if its value sits inside the printed bounds, else `1`, naming the value and the bounds in the assertion message.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @veylta/api exec tsx --test --test-concurrency=1 test/document-timeline.integration.test.ts`
Expected: FAIL (no route).

- [ ] **Step 3: The query module**

```ts
// apps/api/src/documents/document-timeline-query.ts
import { effectiveDateSql } from "./document-date.js";

export interface TimelineRow {
  id: string;
  original_filename: string;
  uploaded_at: string;
  content_type: string;
  document_date_override: string | null;
  intelligence_document_date: string | null;
  category: string | null;
  title: string | null;
  short_summary: string | null;
  effective_date: string;
}

/**
 * Reviewed documents only — the latest job succeeded, the latest run completed and no fact of
 * that run waits for a decision — strictly before `$3`, restricted to the `$4` most recent days
 * that carry one. `$1` family id, `$2` profile id. Newest day first, newest upload first within a day.
 */
export const timelineEntriesSql = `WITH timeline AS (
  SELECT d.id,
         d.original_filename,
         d.uploaded_at,
         COALESCE(blob_type.content_type, b.content_type) AS content_type,
         d.document_date_override,
         intelligence.document_date AS intelligence_document_date,
         intelligence.category,
         intelligence.title,
         intelligence.short_summary,
         ${effectiveDateSql("d", "intelligence")} AS effective_date
    FROM documents d
    JOIN document_versions v
      ON v.family_id = d.family_id AND v.document_id = d.id AND v.version_number = 1
    JOIN document_blobs b
      ON b.family_id = v.family_id AND b.id = v.blob_id
    LEFT JOIN document_blob_content_types blob_type
      ON blob_type.family_id = b.family_id AND blob_type.blob_id = b.id
    JOIN processing_jobs j
      ON j.id = (
        SELECT latest_job.id
          FROM processing_jobs latest_job
         WHERE latest_job.family_id = d.family_id
           AND latest_job.document_version_id = v.id
           AND latest_job.kind = 'document_extraction'
         ORDER BY latest_job.created_at DESC, latest_job.id DESC
         LIMIT 1
      )
    JOIN extraction_runs r
      ON r.id = (
        SELECT latest_run.id
          FROM extraction_runs latest_run
         WHERE latest_run.family_id = d.family_id
           AND latest_run.document_version_id = v.id
         ORDER BY latest_run.created_at DESC, latest_run.id DESC
         LIMIT 1
      )
    LEFT JOIN document_intelligence_results intelligence
      ON intelligence.id = (
        SELECT latest_intelligence.id
          FROM document_intelligence_results latest_intelligence
         WHERE latest_intelligence.family_id = d.family_id
           AND latest_intelligence.document_version_id = v.id
         ORDER BY latest_intelligence.created_at DESC, latest_intelligence.id DESC
         LIMIT 1
      )
   WHERE d.family_id = $1
     AND d.patient_profile_id = $2
     AND d.deleted_at IS NULL
     AND j.state = 'succeeded'
     AND r.status = 'completed'
     AND NOT EXISTS (
       SELECT 1
         FROM extracted_facts f
         LEFT JOIN review_decisions rd
           ON rd.family_id = f.family_id AND rd.extracted_fact_id = f.id
        WHERE f.family_id = r.family_id AND f.extraction_run_id = r.id AND rd.id IS NULL
     )
     AND ${effectiveDateSql("d", "intelligence")} < $3
),
days AS (
  SELECT DISTINCT effective_date FROM timeline ORDER BY effective_date DESC LIMIT $4
)
SELECT timeline.*
  FROM timeline
 WHERE timeline.effective_date >= (SELECT MIN(effective_date) FROM days)
 ORDER BY timeline.effective_date DESC, timeline.uploaded_at DESC, timeline.id DESC`;

/** Confirmed observations of the given documents with their printed range — `$1` family, `$2` profile; ids follow. */
export function observationRowsSql(documentCount: number): string {
  const placeholders = Array.from({ length: documentCount }, (_, index) => `$${index + 3}`).join(", ");
  return `SELECT o.document_id,
                 o.source_value,
                 rr.source_low,
                 rr.source_high,
                 rr.laboratory_out_of_range
            FROM observations o
            LEFT JOIN observation_reference_ranges rr
              ON rr.family_id = o.family_id AND rr.observation_id = o.id
           WHERE o.family_id = $1 AND o.patient_profile_id = $2 AND o.status = 'confirmed'
             AND o.document_id IN (${placeholders})`;
}

/** Confirmed clinician records per document — same parameters. */
export function recordCountsSql(documentCount: number): string {
  const placeholders = Array.from({ length: documentCount }, (_, index) => `$${index + 3}`).join(", ");
  return `SELECT document_id, COUNT(*) AS record_count
            FROM clinician_records
           WHERE family_id = $1 AND patient_profile_id = $2 AND decision = 'confirmed'
             AND document_id IN (${placeholders})
           GROUP BY document_id`;
}
```

- [ ] **Step 4: The service**

```ts
// apps/api/src/documents/document-timeline-service.ts
import { randomUUID } from "node:crypto";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_TIMELINE_CONTRACT_VERSION,
  type DocumentCategory,
  type DocumentTimelineEntry,
  type DocumentTimelineResponse,
  isOutsideRange,
  MAX_DOCUMENT_TIMELINE_DAYS,
  numberOf,
  pointStatus,
  type SyntheticDocumentContentType,
} from "@veylta/contracts";
import type { Database, DatabaseClient } from "../database/pool.js";
import { DomainValidationError, type SessionActor } from "../family/family-service.js";
import { canonicalProfileScope, type ProfileScope, profileAccess } from "../family/profile-access.js";
import { effectiveDocumentDate, isCalendarDate } from "./document-date.js";
import {
  observationRowsSql,
  recordCountsSql,
  type TimelineRow,
  timelineEntriesSql,
} from "./document-timeline-query.js";

interface ObservationRow {
  document_id: string;
  source_value: string;
  source_low: string | null;
  source_high: string | null;
  laboratory_out_of_range: number | null;
}

const NO_BOUND = "9999-12-31";

function pageDays(limit: string | undefined): number {
  if (limit === undefined) return MAX_DOCUMENT_TIMELINE_DAYS;
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DOCUMENT_TIMELINE_DAYS) {
    throw new DomainValidationError();
  }
  return parsed;
}

function beforeDay(before: string | undefined): string {
  if (before === undefined) return NO_BOUND;
  if (!isCalendarDate(before)) throw new DomainValidationError();
  return before;
}

function category(value: string | null): DocumentCategory | null {
  return value !== null && (DOCUMENT_CATEGORIES as readonly string[]).includes(value)
    ? (value as DocumentCategory)
    : null;
}

async function countsByDocument(
  client: Pick<DatabaseClient, "query">,
  scope: ProfileScope,
  ids: readonly string[],
): Promise<Map<string, { confirmed: number; outside: number; records: number }>> {
  const counts = new Map(ids.map((id) => [id, { confirmed: 0, outside: 0, records: 0 }]));
  if (ids.length === 0) return counts;
  const params = [scope.familyId, scope.profileId, ...ids];
  const observations = await client.query<ObservationRow>(observationRowsSql(ids.length), params);
  for (const row of observations.rows) {
    const entry = counts.get(row.document_id);
    if (entry === undefined) continue;
    entry.confirmed += 1;
    const status = pointStatus(numberOf(row.source_value), {
      sourceLow: row.source_low,
      sourceHigh: row.source_high,
      laboratoryOutOfRange:
        row.laboratory_out_of_range === null ? null : row.laboratory_out_of_range === 1,
    });
    if (isOutsideRange(status)) entry.outside += 1;
  }
  const records = await client.query<{ document_id: string; record_count: number }>(
    recordCountsSql(ids.length),
    params,
  );
  for (const row of records.rows) {
    const entry = counts.get(row.document_id);
    if (entry !== undefined) entry.records = Number(row.record_count);
  }
  return counts;
}

/**
 * Reviewed documents by effective date, a page being the `limit` most recent days before
 * `before` that carry one. Read-only; a session without read access gets a 404.
 */
export async function getDocumentTimeline(
  database: Database,
  input: {
    actor: SessionActor;
    scope: ProfileScope;
    before?: string | undefined;
    limit?: string | undefined;
    correlationId: string;
  },
): Promise<DocumentTimelineResponse> {
  const scope = canonicalProfileScope(input.scope);
  const days = pageDays(input.limit);
  const before = beforeDay(input.before);
  return database.transaction(async (client) => {
    await profileAccess(client, input.actor, scope);
    // One extra day tells whether an older page exists; its entries are not returned.
    const rows = (
      await client.query<TimelineRow>(timelineEntriesSql, [scope.familyId, scope.profileId, before, days + 1])
    ).rows;
    const distinctDays = [...new Set(rows.map((row) => row.effective_date))];
    const hasOlder = distinctDays.length > days;
    const oldestKept = hasOlder ? distinctDays[days - 1] : undefined;
    const kept = hasOlder ? rows.filter((row) => row.effective_date >= (oldestKept ?? "")) : rows;
    const counts = await countsByDocument(client, scope, kept.map((row) => row.id));
    const entries: DocumentTimelineEntry[] = kept.map((row) => {
      const count = counts.get(row.id) ?? { confirmed: 0, outside: 0, records: 0 };
      return {
        id: row.id,
        originalFilename: row.original_filename,
        contentType: row.content_type as SyntheticDocumentContentType,
        uploadedAt: new Date(row.uploaded_at).toISOString(),
        effectiveDate: effectiveDocumentDate({
          override: row.document_date_override,
          documentDate: row.intelligence_document_date,
          uploadedAt: row.uploaded_at,
        }),
        category: category(row.category),
        title: row.title,
        shortSummary: row.short_summary,
        confirmedCount: count.confirmed,
        outsideRangeCount: count.outside,
        recordCount: count.records,
      };
    });
    await client.query(
      `INSERT INTO audit_events
         (id, family_id, actor_user_id, action, resource_type, resource_id, result,
          correlation_id, metadata, created_at)
       VALUES ($1, $2, $3, 'profile.timeline.opened', 'PatientProfile', $4, 'success', $5, $6, $7)`,
      [
        randomUUID(),
        scope.familyId,
        input.actor.userId,
        scope.profileId,
        input.correlationId,
        { contractVersion: DOCUMENT_TIMELINE_CONTRACT_VERSION },
        new Date(),
      ],
    );
    return {
      contractVersion: DOCUMENT_TIMELINE_CONTRACT_VERSION,
      entries,
      nextBefore: hasOlder ? (oldestKept ?? null) : null,
    };
  });
}
```

(`effective_date` from SQL and `effectiveDocumentDate(...)` in TS must agree — the TS value is the one returned; the SQL one orders and pages. A unit-style check is the integration test's ordering assertions.)

- [ ] **Step 5: The route**

```ts
// apps/api/src/documents/document-timeline-routes.ts
import type { FastifyInstance } from "fastify";
import type { Database } from "../database/pool.js";
import type { FamilyService } from "../family/family-service.js";
import {
  canonicalUuidSchema,
  privateResponse,
  requireActor,
  sendDomainError,
} from "../http/route-helpers.js";
import { getDocumentTimeline } from "./document-timeline-service.js";

interface ProfileParams {
  familyId: string;
  profileId: string;
}

interface TimelineQuery {
  before?: string;
  limit?: string;
}

/** `GET /v1/families/:familyId/profiles/:profileId/documents/timeline?before=&limit=` — whole-day pages of reviewed documents. */
export function registerDocumentTimelineRoutes(
  app: FastifyInstance,
  family: FamilyService,
  database: Database,
): void {
  app.get<{ Params: ProfileParams; Querystring: TimelineQuery }>(
    "/v1/families/:familyId/profiles/:profileId/documents/timeline",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["familyId", "profileId"],
          properties: { familyId: canonicalUuidSchema, profileId: canonicalUuidSchema },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            before: { type: "string", minLength: 10, maxLength: 10 },
            limit: { type: "string", pattern: "^(?:[1-9]|[1-4][0-9]|50)$" },
          },
        },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      const actor = await requireActor(family, request, reply);
      if (actor === null) return;
      try {
        reply.send(
          await getDocumentTimeline(database, {
            actor,
            scope: request.params,
            ...(request.query.before === undefined ? {} : { before: request.query.before }),
            ...(request.query.limit === undefined ? {} : { limit: request.query.limit }),
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

Route precedence: `documents/routes.ts` registers `GET …/documents/:documentId` inside a Fastify plugin scope; a literal segment `timeline` wins over the `:documentId` parameter in Fastify's router, and `canonicalUuidSchema` would reject `timeline` anyway. If the integration test shows `GET …/documents/timeline` answered by the `:documentId` route (400 on the param), register this route *before* `registerDocumentRoutes` in `server.ts` and `assistant-app.ts` and say so in the report.

Register in `apps/api/src/server.ts` (`registerDocumentTimelineRoutes(app, familyService, database);`) and `apps/api/test/assistant-app.ts` (`registerDocumentTimelineRoutes(app, family, database);`).

- [ ] **Step 6: Run**

Run: `pnpm exec biome check --write apps/api && pnpm --filter @veylta/api typecheck && pnpm --filter @veylta/api exec tsx --test --test-concurrency=1 test/document-timeline.integration.test.ts test/document-date.integration.test.ts && pnpm test:integration && pnpm lint`
Expected: PASS; `File lengths OK` (each new file ≤ 250; split `document-timeline-service.ts` into `document-timeline-counts.ts` if it crosses).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/documents/document-timeline-service.ts apps/api/src/documents/document-timeline-query.ts apps/api/src/documents/document-timeline-routes.ts apps/api/src/server.ts apps/api/test/assistant-app.ts apps/api/test/document-timeline.integration.test.ts
git commit -m "feat(api): GET …/documents/timeline — reviewed documents by effective date in whole-day pages, with their counts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Web — pure modules for the queue, the timeline and the one-line hero

**Files:**
- Create: `apps/web/app/document-queue.ts`, `apps/web/app/document-queue.test.ts`
- Create: `apps/web/app/document-timeline.ts`, `apps/web/app/document-timeline.test.ts`
- Modify: `apps/web/app/documents-archive.ts` (`DocumentsArchiveHero`, `buildDocumentsArchiveHero`; gains `heroCountsCopy` and, moved from `veylta-app.tsx`, `canBulkConfirmFact` 6416–6427, `buildDocumentSearchPath` 201–208, `isDocumentSummary` 210–220, `normalizeDocumentSearchResponse` 222–230), `apps/web/app/documents-archive.test.ts`, `apps/web/app/document-experience.test.ts` (import the three moved names from `./documents-archive`), `apps/web/app/components/veylta-app.tsx` (delete the moved functions; `profileOverviewProcessingCopy` 3173–3198 and `documentCategoryLabels` 3200–3209 are copied into `document-queue.ts` / `document-timeline.ts` now and deleted from `veylta-app.tsx` in Task 7 with their last users)

**Interfaces:**
- Consumes: `isInDocumentQueue`, `DocumentTimelineEntry`, `DocumentEffectiveDate`, `DocumentSummary`, `ProfileOverviewResponse`, `ProfileOverviewDocument`, `ProfileOverviewReviewDocument`, `DocumentProcessingStatus`, `DocumentCategory` (contracts); `archiveRows`, `isRestartable`, `bulkConfirmableCount`, `awaitingReviewVerb`, `archiveValueCountCopy` (`documents-archive.ts`); `formatSampleMoment` (`format-moment.ts`); `pluralForm` (`russian-plural.ts`).
- Produces: `QueueRow`, `queueRows(overview)`, `QueueAction`, `queueAction(row)`, `queueStateCopy(status)`, `queueCounts(overview)`; `TimelineNode`, `timelineNodes(entries)`, `searchNodes(documents)`, `TimelineGroup`, `timelineGroups(nodes)`, `monthLabel(key)`, `effectiveDateCopy(date)`, `nodeCounts(entry)`, `mergeTimelinePages(loaded, next)`, `documentCategoryLabels`; `DocumentsArchiveHero.documentCount/queueCount`, `heroCountsCopy(summary)`, `canBulkConfirmFact`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/document-queue.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import type { ProfileOverviewResponse } from "@veylta/contracts";
import { queueAction, queueCounts, queueRows, queueStateCopy } from "./document-queue";

const at = "2026-08-10T08:00:00.000Z";
const document = (
  id: string,
  processing: ProfileOverviewResponse["recentDocuments"][number]["processing"],
): ProfileOverviewResponse["recentDocuments"][number] => ({
  id,
  originalFilename: `${id}.pdf`,
  contentType: "application/pdf",
  uploadedAt: at,
  effectiveDate: { value: "2026-08-10", source: "upload" },
  intelligence: null,
  processing,
});

const overview = {
  contractVersion: "profile-overview/v3",
  profile: {
    id: "p",
    familyId: "f",
    displayName: "Анна",
    kind: "adult",
    access: "owner",
    handle: "anna",
    createdAt: at,
  },
  documentCount: 7,
  recentDocuments: [
    document("done", { state: "completed", updatedAt: at, factCount: 2 }),
    document("review", { state: "awaiting_review", updatedAt: at, factCount: 2, needsReviewCount: 1 }),
    document("running", { state: "text_extraction", updatedAt: at }),
    document("failed", { state: "failed", updatedAt: at, category: "extraction_failed", retryAllowed: true }),
    document("fresh", { state: "not_started" }),
  ],
  reviewQueue: {
    documentCount: 1,
    pendingFactCount: 2,
    needsAttentionFactCount: 1,
    documents: [
      {
        id: "review",
        originalFilename: "review.pdf",
        contentType: "application/pdf",
        uploadedAt: at,
        pendingFactCount: 2,
        needsAttentionFactCount: 1,
      },
    ],
  },
  recentObservations: [],
} as unknown as ProfileOverviewResponse;

test("the queue holds what is not done: the one awaiting review first, then the rest in upload order", () => {
  assert.deepEqual(
    queueRows(overview).map((row) => row.document.id),
    ["review", "running", "failed", "fresh"],
  );
  assert.deepEqual(queueCounts(overview), { total: 7, inQueue: 4, awaitingReview: 1 });
});

test("each row knows its one action and its state in words", () => {
  const rows = queueRows(overview);
  assert.deepEqual(queueAction(rows[0]!), { kind: "review", count: 2 });
  assert.deepEqual(queueAction(rows[1]!), { kind: "none" });
  assert.deepEqual(queueAction(rows[2]!), { kind: "retry" });
  assert.deepEqual(queueAction(rows[3]!), { kind: "none" });
  assert.equal(queueStateCopy(rows[1]!.document.processing), "Извлекаем текст");
  assert.equal(queueStateCopy(rows[2]!.document.processing), "Обработка не завершилась");
  assert.equal(queueStateCopy(rows[0]!.document.processing), "2 значения ждут явной проверки");
});
```

```ts
// apps/web/app/document-timeline.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentTimelineEntry } from "@veylta/contracts";
import {
  effectiveDateCopy,
  mergeTimelinePages,
  monthLabel,
  nodeCounts,
  timelineGroups,
  timelineNodes,
} from "./document-timeline";

const entry = (id: string, value: string, source: "person" | "document" | "upload", counts = [0, 0, 0]): DocumentTimelineEntry => ({
  id,
  originalFilename: `${id}.pdf`,
  contentType: "application/pdf",
  uploadedAt: "2026-08-19T10:00:00.000Z",
  effectiveDate: { value, source },
  category: "laboratory",
  title: null,
  shortSummary: null,
  confirmedCount: counts[0] ?? 0,
  outsideRangeCount: counts[1] ?? 0,
  recordCount: counts[2] ?? 0,
});

test("nodes group by month, newest first, with a year marker where the year changes", () => {
  const groups = timelineGroups(
    timelineNodes([
      entry("a", "2026-08-19", "upload"),
      entry("b", "2026-08-02", "document"),
      entry("c", "2026-05-14", "person"),
      entry("d", "2025-12-31", "document"),
    ]),
  );
  assert.deepEqual(
    groups.map((group) => [group.key, group.label, group.yearMarker, group.nodes.map((node) => node.id)]),
    [
      ["2026-08", "Август 2026", "2026", ["a", "b"]],
      ["2026-05", "Май 2026", null, ["c"]],
      ["2025-12", "Декабрь 2025", "2025", ["d"]],
    ],
  );
  assert.equal(monthLabel("2026-01"), "Январь 2026");
});

test("the date reads as a day; the source shows only when it is not the document's own", () => {
  assert.deepEqual(effectiveDateCopy({ value: "2026-08-12", source: "document" }), {
    date: "12 августа 2026 г.",
    marker: null,
  });
  assert.deepEqual(effectiveDateCopy({ value: "2026-08-19", source: "upload" }), {
    date: "19 августа 2026 г.",
    marker: "по дате загрузки",
  });
  assert.deepEqual(effectiveDateCopy({ value: "2026-05-14", source: "person" }), {
    date: "14 мая 2026 г.",
    marker: "дата исправлена",
  });
});

test("counts are chips only when they say something", () => {
  assert.deepEqual(nodeCounts(entry("a", "2026-08-19", "upload", [3, 1, 2])), [
    "подтверждено 3",
    "вне референса: 1",
    "записи врача: 2",
  ]);
  assert.deepEqual(nodeCounts(entry("b", "2026-08-19", "upload", [1, 0, 0])), ["подтверждено 1"]);
  assert.deepEqual(nodeCounts(entry("c", "2026-08-19", "upload")), []);
});

test("pages merge without repeating a document", () => {
  const first = [entry("a", "2026-08-19", "upload"), entry("b", "2026-08-02", "document")];
  const next = [entry("b", "2026-08-02", "document"), entry("c", "2026-05-14", "person")];
  assert.deepEqual(mergeTimelinePages(first, next).map((item) => item.id), ["a", "b", "c"]);
});
```

Add to `apps/web/app/documents-archive.test.ts` one test:

```ts
test("the hero line counts the record, the queue and the review", () => {
  assert.equal(
    heroCountsCopy({ documentCount: 12, queueCount: 3, pendingDocumentCount: 2 } as never),
    "12 всего · 3 в очереди · 2 ждут проверки",
  );
  assert.equal(
    heroCountsCopy({ documentCount: 1, queueCount: 0, pendingDocumentCount: 1 } as never),
    "1 всего · 0 в очереди · 1 ждёт проверки",
  );
});
```

(`heroCountsCopy` reads only those three fields of `DocumentsArchiveHero`; the `as never` keeps the fixture short — or build a full `DocumentsArchiveHero` literal if the file's existing tests have a helper.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @veylta/web exec tsx --test app/document-queue.test.ts app/document-timeline.test.ts app/documents-archive.test.ts`
Expected: FAIL (modules / functions missing).

- [ ] **Step 3: Write the modules**

```ts
// apps/web/app/document-queue.ts
import {
  type DocumentProcessingStatus,
  isInDocumentQueue,
  type ProfileOverviewDocument,
  type ProfileOverviewResponse,
  type ProfileOverviewReviewDocument,
} from "@veylta/contracts";
import { archiveRows, archiveValueCountCopy, isRestartable } from "./documents-archive";

/** One document that still needs the machine or the person. */
export interface QueueRow {
  readonly document: ProfileOverviewDocument;
  readonly review: ProfileOverviewReviewDocument | null;
}

export type QueueAction = { kind: "review"; count: number } | { kind: "retry" } | { kind: "none" };

/** The queue: awaiting review first, then the rest in upload order — `archiveRows` keeps that order. */
export function queueRows(overview: ProfileOverviewResponse): readonly QueueRow[] {
  return archiveRows(overview)
    .filter((row) =>
      isInDocumentQueue(row.document.processing, row.queue?.pendingFactCount ?? 0),
    )
    .map((row) => ({ document: row.document, review: row.queue }));
}

/** «всего · в очереди · ждут проверки» for the hero line. */
export function queueCounts(overview: ProfileOverviewResponse): {
  readonly total: number;
  readonly inQueue: number;
  readonly awaitingReview: number;
} {
  return {
    total: overview.documentCount,
    inQueue: queueRows(overview).length,
    awaitingReview: overview.reviewQueue.documentCount,
  };
}

/** What the row offers: check the pending values, retry a failure, or nothing while the machine works. */
export function queueAction(row: QueueRow): QueueAction {
  const pending = row.review?.pendingFactCount ?? 0;
  if (row.document.processing.state === "awaiting_review" && pending > 0) {
    return { kind: "review", count: pending };
  }
  if (row.document.processing.state === "failed" && isRestartable(row.document)) return { kind: "retry" };
  return { kind: "none" };
}

/** The state in the person's words — moved from `veylta-app.tsx`'s `profileOverviewProcessingCopy`. */
export function queueStateCopy(status: DocumentProcessingStatus): string {
  switch (status.state) {
    case "not_started":
      return "Обработка ещё не началась";
    case "queued":
      return "В очереди обработки";
    case "security_check":
      return "Проверяем исходник";
    case "text_extraction":
      return "Извлекаем текст";
    case "document_classification":
      return "Codex определяет раздел";
    case "structured_extraction":
      return "Готовим черновые значения";
    case "validation":
      return "Проверяем черновой результат";
    case "awaiting_review":
      return `${archiveValueCountCopy(status.factCount)} ждут явной проверки`;
    case "completed":
      return `${archiveValueCountCopy(status.factCount)} подтверждены пользователем`;
    case "failed":
      return "Обработка не завершилась";
  }
}
```

(Copy the ten strings from `veylta-app.tsx:3173–3198` exactly; the test pins three of them.)

```ts
// apps/web/app/document-timeline.ts
import type {
  DocumentCategory,
  DocumentEffectiveDate,
  DocumentSummary,
  DocumentTimelineEntry,
  SyntheticDocumentContentType,
} from "@veylta/contracts";
import { formatSampleMoment } from "./format-moment";

/** One node of the timeline — a reviewed document, or a search hit shown the same way. */
export interface TimelineNode {
  readonly id: string;
  readonly title: string;
  readonly filename: string;
  readonly contentType: SyntheticDocumentContentType;
  readonly category: DocumentCategory | null;
  readonly shortSummary: string | null;
  readonly effectiveDate: DocumentEffectiveDate;
  readonly counts: readonly string[];
}

export interface TimelineGroup {
  /** `YYYY-MM` */
  readonly key: string;
  /** «Август 2026» */
  readonly label: string;
  /** The year, on the first group and wherever the year changes; else null. */
  readonly yearMarker: string | null;
  readonly nodes: readonly TimelineNode[];
}

/** Moved from `veylta-app.tsx` `documentCategoryLabels`. */
export const documentCategoryLabels: Record<DocumentCategory, string> = {
  laboratory: "Анализы",
  imaging: "Снимки и исследования",
  prescription: "Назначения",
  discharge_summary: "Выписки",
  consultation: "Консультации",
  vaccination: "Вакцинация",
  insurance: "Страховые документы",
  other: "Другое",
};

const monthNames = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" });

/** «2026-08» → «Август 2026». */
export function monthLabel(key: string): string {
  const month = monthNames.format(new Date(`${key}-01T00:00:00.000Z`));
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${key.slice(0, 4)}`;
}

/** Chips only when they say something: confirmed values, those outside the range, the clinician's records. */
export function nodeCounts(entry: DocumentTimelineEntry): readonly string[] {
  const chips: string[] = [];
  if (entry.confirmedCount > 0) chips.push(`подтверждено ${entry.confirmedCount}`);
  if (entry.outsideRangeCount > 0) chips.push(`вне референса: ${entry.outsideRangeCount}`);
  if (entry.recordCount > 0) chips.push(`записи врача: ${entry.recordCount}`);
  return chips;
}

export function timelineNodes(entries: readonly DocumentTimelineEntry[]): readonly TimelineNode[] {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title ?? entry.originalFilename,
    filename: entry.originalFilename,
    contentType: entry.contentType,
    category: entry.category,
    shortSummary: entry.shortSummary,
    effectiveDate: entry.effectiveDate,
    counts: nodeCounts(entry),
  }));
}

/** Search hits are summaries without counts; they render as nodes too. */
export function searchNodes(documents: readonly DocumentSummary[]): readonly TimelineNode[] {
  return documents.map((document) => ({
    id: document.id,
    title: document.intelligence?.title ?? document.originalFilename,
    filename: document.originalFilename,
    contentType: document.contentType,
    category: document.intelligence?.category ?? null,
    shortSummary: document.intelligence?.shortSummary ?? null,
    effectiveDate: document.effectiveDate,
    counts: [],
  }));
}

/** Nodes are newest first already; group by month and mark the first month of each year. */
export function timelineGroups(nodes: readonly TimelineNode[]): readonly TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  let previousYear: string | null = null;
  for (const node of nodes) {
    const key = node.effectiveDate.value.slice(0, 7);
    const year = key.slice(0, 4);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) {
      groups[groups.length - 1] = { ...last, nodes: [...last.nodes, node] };
      continue;
    }
    groups.push({
      key,
      label: monthLabel(key),
      yearMarker: year === previousYear ? null : year,
      nodes: [node],
    });
    previousYear = year;
  }
  return groups;
}

const sourceMarker: Record<DocumentEffectiveDate["source"], string | null> = {
  document: null,
  upload: "по дате загрузки",
  person: "дата исправлена",
};

/** The day in words and, when the date is not the document's own, where it came from. */
export function effectiveDateCopy(date: DocumentEffectiveDate): {
  readonly date: string;
  readonly marker: string | null;
} {
  return { date: formatSampleMoment(date.value), marker: sourceMarker[date.source] };
}

/** A further page appended without repeating a document already shown. */
export function mergeTimelinePages(
  loaded: readonly DocumentTimelineEntry[],
  next: readonly DocumentTimelineEntry[],
): readonly DocumentTimelineEntry[] {
  const seen = new Set(loaded.map((entry) => entry.id));
  return [...loaded, ...next.filter((entry) => !seen.has(entry.id))];
}
```

(`formatSampleMoment("2026-08-12")` → «12 августа 2026 г.» — `format-moment.ts:` the bare-date branch with `timeZone: "UTC"`; the test pins it.)

`apps/web/app/documents-archive.ts`: `DocumentsArchiveHero` gains `readonly documentCount: number; readonly queueCount: number;`; `buildDocumentsArchiveHero(overview)` fills `documentCount: overview.documentCount` and `queueCount` by the same rule as `queueRows` — to avoid a cycle (`document-queue.ts` imports `archiveRows` from here), compute it inline: `overview.recentDocuments.filter((d) => isInDocumentQueue(d.processing, pendingOf(d.id))).length` where `pendingOf` reads `overview.reviewQueue.documents` — or have `buildDocumentsArchiveHero` accept `queueCount` as a second argument from the caller, which is simpler and keeps one rule: `buildDocumentsArchiveHero(overview, queueCount: number)`. Choose the argument. Add:

```ts
/** «12 всего · 3 в очереди · 2 ждут проверки» — the hero's one line. */
export function heroCountsCopy(summary: DocumentsArchiveHero): string {
  return [
    `${summary.documentCount} всего`,
    `${summary.queueCount} в очереди`,
    `${summary.pendingDocumentCount} ${awaitingReviewVerb(summary.pendingDocumentCount)}`,
  ].join(" · ");
}

const reviewBlockingIssues: ReadonlySet<string> = new Set(REVIEW_BLOCKING_VALIDATION_ISSUES);

/** Mirrors the API's review-status rule: only a doubtful reading needs a hand on it. (From `veylta-app.tsx`.) */
export function canBulkConfirmFact(fact: {
  readonly reviewStatus: ExtractedFactReviewStatus;
  readonly validationIssues: readonly string[];
}): boolean {
  return (
    fact.reviewStatus === "extracted" &&
    !fact.validationIssues.some((issue) => reviewBlockingIssues.has(issue))
  );
}

/** The search endpoint: `GET …/documents?q=` — the only list the API offers. (From `veylta-app.tsx`.) */
export function buildDocumentSearchPath(familyId: string, profileId: string, query: string): string {
  const params = new URLSearchParams({ q: query.trim() });
  return `${profileApiPath(familyId, profileId)}/documents?${params.toString()}`;
}

function isDocumentSummary(value: unknown): value is DocumentSummary {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DocumentSummary>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.originalFilename === "string" &&
    typeof candidate.uploadedAt === "string" &&
    typeof candidate.processing === "object" &&
    candidate.processing !== null
  );
}

/** A search answer read defensively: `{ documents }`, `{ items }` or a bare array. (From `veylta-app.tsx`.) */
export function normalizeDocumentSearchResponse(response: unknown): readonly DocumentSummary[] {
  const candidates = Array.isArray(response)
    ? response
    : typeof response === "object" && response !== null
      ? ((response as { documents?: unknown; items?: unknown }).documents ??
        (response as { items?: unknown }).items)
      : null;
  return Array.isArray(candidates) ? candidates.filter(isDocumentSummary) : [];
}
```

Imports for these: `ExtractedFactReviewStatus`, `REVIEW_BLOCKING_VALIDATION_ISSUES`, `DocumentSummary` from `@veylta/contracts`; `profileApiPath` from `./paths`. They are moves: delete `canBulkConfirmFact` + `reviewBlockingIssues` (≈6416–6427), `isDocumentSummary` (≈210–220), `normalizeDocumentSearchResponse` (≈222–230) and `buildDocumentSearchPath` (≈201–208) from `veylta-app.tsx`, import what it still uses from `../documents-archive`, and point `document-experience.test.ts` at `./documents-archive` for `buildDocumentSearchPath`, `canBulkConfirmFact`, `normalizeDocumentSearchResponse` (the other four names it imports stay in `./components/veylta-app`). If `documents-archive.ts` would pass 250 lines, put the three search helpers into `apps/web/app/document-search.ts` instead and import from there.

- [ ] **Step 4: Run**

Run: `pnpm exec biome check --write apps/web/app && pnpm --filter @veylta/web typecheck && pnpm --filter @veylta/web test && pnpm lint`
Expected: all green (existing `documents-archive.test.ts` fixtures need `documentCount` in their overview literals and the new `buildDocumentsArchiveHero` argument); `File lengths OK`; `veylta-app.tsx` shrank by the moved function.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): pure rules for the documents queue, the timeline nodes and the one-line hero

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Web — the documents page: hero line, queue, timeline with date correction; `veylta-app.tsx` loses the markup

**Files:**
- Create: `apps/web/app/use-archive-actions.ts`, `apps/web/app/use-document-timeline.ts`
- Create: `apps/web/app/components/documents-workspace.tsx`, `apps/web/app/components/document-queue.tsx`, `apps/web/app/components/document-timeline.tsx`, `apps/web/app/components/document-date-editor.tsx`
- Modify: `apps/web/app/components/documents-hero.tsx` (one line: «Документы» + counts + actions), `apps/web/app/components/veylta-app.tsx` (`ProfileOverviewPanel` 3337–3754: the documents branch, `ArchiveRows` 3221–3335, `profileOverviewProcessingCopy` 3173–3198, `documentCategoryLabels` 3200–3209, `ArchiveActionState` 3211–3215 leave the file; the documents view renders `<DocumentsWorkspace …/>`), `apps/web/app/globals.css` (append the timeline/queue styles)

**Interfaces:**
- Consumes: Task 6 modules; `DocumentTimelineResponse`, `DocumentDateResponse`, `DocumentDateRequest`, `latestCorrectableDate`, `MAX_DOCUMENT_TIMELINE_DAYS` (contracts); `apiRequest`, `ApiError`, `apiPrefix` (`api-client.ts`); `documentApiPath`, `profileApiPath`, `documentPath` (`paths.ts`); `useProfileHandle` (`profile-route.tsx`); `PageHero` (`page-hero.tsx`); `DocumentsHero` props.
- Produces: `useArchiveActions({ familyId, profileId, reload }): { action: ArchiveActionState; confirmDocuments(documents); restartDocuments(documents) }`; `useDocumentTimeline({ familyId, profileId, revision }): { state; loadMore(); reload(); correctDate(documentId, value): Promise<void> }`; `<DocumentsWorkspace familyId profileId canWrite overview onReload onUpload />`; `<DocumentQueue rows canWrite action onConfirm onRestart />`; `<DocumentTimeline nodes grouped canWrite busy onCorrectDate />`; `<DocumentDateEditor value max pending onSave onClear onCancel />`.

- [ ] **Step 1: The two hooks (logic moved out of `ProfileOverviewPanel`)**

```ts
// apps/web/app/use-archive-actions.ts
"use client";

import type {
  DocumentFactsResponse,
  DocumentProcessingRestartResponse,
  FactReviewResponse,
  ProfileOverviewDocument,
  ProfileOverviewReviewDocument,
} from "@veylta/contracts";
import { useState } from "react";
import { apiRequest } from "./api-client";
import { bulkConfirmableCount, canBulkConfirmFact, isRestartable } from "./documents-archive";
import { documentApiPath } from "./paths";

export type ArchiveActionState =
  | { kind: "idle" }
  | { kind: "confirming"; completed: number; total: number; documentId: string | null }
  | { kind: "restarting"; documentId: string | null }
  | { kind: "error"; copy: string };

/**
 * Bulk confirm and restart as they were in the overview panel: every decision is its own
 * idempotent command, a failure part-way says how far it got, and the overview is reloaded after.
 */
export function useArchiveActions(input: {
  familyId: string;
  profileId: string;
  reload: () => Promise<void>;
}) {
  const [action, setAction] = useState<ArchiveActionState>({ kind: "idle" });

  async function confirmDocuments(documents: readonly ProfileOverviewReviewDocument[]): Promise<void> {
    const queue = documents.filter((document) => bulkConfirmableCount(document) > 0);
    if (queue.length === 0) return;
    const single = queue.length === 1 ? (queue[0]?.id ?? null) : null;
    setAction({ kind: "confirming", completed: 0, total: 0, documentId: single });
    let completed = 0;
    let total = 0;
    try {
      for (const document of queue) {
        const facts = `${documentApiPath(input.familyId, input.profileId, document.id)}/facts`;
        const response = await apiRequest<DocumentFactsResponse>(facts);
        const confirmable = response.items.filter(canBulkConfirmFact);
        total += confirmable.length;
        setAction({ kind: "confirming", completed, total, documentId: single });
        for (const fact of confirmable) {
          await apiRequest<FactReviewResponse>(`${facts}/${encodeURIComponent(fact.id)}/review`, {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify({ factVersion: fact.factVersion, decision: "confirm" }),
          });
          completed += 1;
          setAction({ kind: "confirming", completed, total, documentId: single });
        }
      }
      setAction({ kind: "idle" });
    } catch {
      setAction({
        kind: "error",
        copy:
          completed === 0
            ? "Не удалось начать подтверждение. Ни одно значение не изменено."
            : `Подтверждено ${completed} из ${total}. Остальные значения не изменены; повторите действие.`,
      });
    }
    await input.reload();
  }

  async function restartDocuments(documents: readonly ProfileOverviewDocument[]): Promise<void> {
    const targets = documents.filter(isRestartable);
    if (targets.length === 0) return;
    const single = targets.length === 1 ? (targets[0]?.id ?? null) : null;
    setAction({ kind: "restarting", documentId: single });
    try {
      for (const document of targets) {
        await apiRequest<DocumentProcessingRestartResponse>(
          `${documentApiPath(input.familyId, input.profileId, document.id)}/processing/restart`,
          { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } },
        );
      }
      setAction({ kind: "idle" });
    } catch {
      setAction({
        kind: "error",
        copy: "Не удалось перезапустить разбор. Исходники не изменены; повторите действие.",
      });
    }
    await input.reload();
  }

  return { action, confirmDocuments, restartDocuments };
}
```

(These bodies are `veylta-app.tsx:3362–3429` with the path helpers replaced by `documentApiPath`; keep the copy strings byte for byte — the e2e pins them.)

```ts
// apps/web/app/use-document-timeline.ts
"use client";

import {
  type DocumentDateRequest,
  type DocumentDateResponse,
  type DocumentTimelineEntry,
  type DocumentTimelineResponse,
} from "@veylta/contracts";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api-client";
import { mergeTimelinePages } from "./document-timeline";
import { documentApiPath, profileApiPath } from "./paths";

/** Days per page the web asks for — a month of the record at a time. */
export const TIMELINE_PAGE_DAYS = 30;

export type DocumentTimelineState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; entries: readonly DocumentTimelineEntry[]; nextBefore: string | null; loadingMore: boolean };

function timelinePath(familyId: string, profileId: string, before: string | null): string {
  const base = `${profileApiPath(familyId, profileId)}/documents/timeline?limit=${TIMELINE_PAGE_DAYS}`;
  return before === null ? base : `${base}&before=${encodeURIComponent(before)}`;
}

/** The timeline: first page on mount and whenever `revision` changes (a document left the queue), more on demand. */
export function useDocumentTimeline(input: { familyId: string; profileId: string; revision: number }) {
  const [state, setState] = useState<DocumentTimelineState>({ kind: "loading" });
  const { familyId, profileId, revision } = input;

  const reload = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const page = await apiRequest<DocumentTimelineResponse>(
        timelinePath(familyId, profileId, null),
        signal === undefined ? undefined : { signal },
      );
      if (!signal?.aborted) {
        setState({ kind: "ready", entries: page.entries, nextBefore: page.nextBefore, loadingMore: false });
      }
    } catch {
      if (!signal?.aborted) setState({ kind: "error" });
    }
  }, [familyId, profileId]);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload, revision]);

  async function loadMore(): Promise<void> {
    if (state.kind !== "ready" || state.nextBefore === null || state.loadingMore) return;
    setState({ ...state, loadingMore: true });
    try {
      const page = await apiRequest<DocumentTimelineResponse>(
        timelinePath(familyId, profileId, state.nextBefore),
      );
      setState({
        kind: "ready",
        entries: mergeTimelinePages(state.entries, page.entries),
        nextBefore: page.nextBefore,
        loadingMore: false,
      });
    } catch {
      setState({ ...state, loadingMore: false });
    }
  }

  /** `PUT …/date`; the caller reloads so the node moves — throws on failure for the editor to show. */
  async function correctDate(documentId: string, documentDate: string | null): Promise<void> {
    const body: DocumentDateRequest = { documentDate };
    await apiRequest<DocumentDateResponse>(`${documentApiPath(familyId, profileId, documentId)}/date`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    await reload();
  }

  return { state, reload, loadMore, correctDate };
}
```

- [ ] **Step 2: The components**

```tsx
// apps/web/app/components/document-queue.tsx
"use client";

import Link from "next/link";
import { type QueueRow, queueAction, queueStateCopy } from "../document-queue";
import { documentPath } from "../paths";
import { useProfileHandle } from "../profile-route";
import { pluralForm } from "../russian-plural";
import type { ArchiveActionState } from "../use-archive-actions";

/**
 * «Очередь»: compact rows for what still needs the machine or the person. One action per row —
 * «Проверить N значений» is the way into the review (a link), «Повторить» retries a failure;
 * a running analysis shows its stage and a spinner. Bulk confirm stays in the hero.
 */
export function DocumentQueue({
  rows,
  canWrite,
  action,
  onRestart,
}: {
  readonly rows: readonly QueueRow[];
  readonly canWrite: boolean;
  readonly action: ArchiveActionState;
  readonly onRestart: (row: QueueRow) => void;
}) {
  const handle = useProfileHandle();
  return (
    <section className="document-queue" aria-labelledby="document-queue-title">
      <header className="document-queue__heading">
        <h3 id="document-queue-title">Очередь</h3>
        <p>Сначала — то, что ждёт решения; ниже — что ещё разбирается или не прошло.</p>
      </header>
      {rows.length === 0 ? (
        <p className="document-queue__empty" role="status">
          Очередь пуста
        </p>
      ) : (
        <ol className="document-queue__rows">
          {rows.map((row) => {
            const next = queueAction(row);
            const busy =
              action.kind === "restarting" &&
              (action.documentId === null || action.documentId === row.document.id);
            return (
              <li key={row.document.id} className={`document-queue__row document-queue__row--${row.document.processing.state}`}>
                <div className="document-queue__identity">
                  <Link className="document-queue__name" href={documentPath(handle, row.document.id)}>
                    {row.document.intelligence?.title ?? row.document.originalFilename}
                  </Link>
                  <span className="document-queue__state">{queueStateCopy(row.document.processing)}</span>
                </div>
                {next.kind === "review" ? (
                  <Link className="button button--secondary" href={documentPath(handle, row.document.id)}>
                    {`Проверить ${next.count} ${pluralForm(next.count, ["значение", "значения", "значений"])}`}
                  </Link>
                ) : null}
                {canWrite && next.kind === "retry" ? (
                  <button className="button button--secondary" type="button" disabled={busy} onClick={() => onRestart(row)}>
                    Повторить
                  </button>
                ) : null}
                {next.kind === "none" && isRunning(row.document.processing.state) ? (
                  <span className="document-queue__progress" aria-hidden="true" />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

const runningStates = new Set(["queued", "security_check", "text_extraction", "document_classification", "structured_extraction", "validation"]);
const isRunning = (state: string): boolean => runningStates.has(state);
```

(The old `ArchiveRows` offered an inline «Подтвердить N» for clean values; the queue does not — the hero's «Подтвердить без замечаний N» covers bulk and the review page covers the rest. Keep `confirmDocuments` in the hook for the hero only.)

```tsx
// apps/web/app/components/document-date-editor.tsx
"use client";

import { type FormEvent, useId, useState } from "react";

/** The date field behind «Исправить дату»: a calendar day up to tomorrow, «Сбросить» returns the document's own date. */
export function DocumentDateEditor({
  value,
  max,
  canClear,
  pending,
  error,
  onSave,
  onClear,
  onCancel,
}: {
  readonly value: string;
  readonly max: string;
  readonly canClear: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onSave: (value: string) => void;
  readonly onClear: () => void;
  readonly onCancel: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const invalid = draft.length !== 10 || draft > max;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invalid) onSave(draft);
  }
  return (
    <form className="document-date-editor" aria-label="Исправление даты документа" onSubmit={submit}>
      <label className="field" htmlFor={`${id}-date`}>
        <span>Дата документа</span>
        <input id={`${id}-date`} type="date" value={draft} max={max} disabled={pending} required onChange={(event) => setDraft(event.target.value)} />
      </label>
      <div className="document-date-editor__actions">
        <button className="button button--secondary" type="submit" disabled={pending || invalid}>
          {pending ? "Сохраняем…" : "Сохранить дату"}
        </button>
        {canClear ? (
          <button className="text-link text-link--button" type="button" disabled={pending} onClick={onClear}>
            Сбросить
          </button>
        ) : null}
        <button className="text-link text-link--button" type="button" disabled={pending} onClick={onCancel}>
          Отмена
        </button>
      </div>
      {error !== null ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
```

```tsx
// apps/web/app/components/document-timeline.tsx
"use client";

import { latestCorrectableDate } from "@veylta/contracts";
import Link from "next/link";
import { useState } from "react";
import { ApiError } from "../api-client";
import {
  documentCategoryLabels,
  effectiveDateCopy,
  type TimelineGroup,
  type TimelineNode,
  timelineGroups,
} from "../document-timeline";
import { documentPath } from "../paths";
import { useProfileHandle } from "../profile-route";
import { DocumentDateEditor } from "./document-date-editor";

/**
 * «Лента»: a vertical timeline, newest first, grouped by month with a year marker. A node shows
 * the date (and its source when it is not the document's own), category and title, filename,
 * counts, and the way into the document. The pencil opens the date field.
 */
export function DocumentTimeline({
  nodes,
  grouped,
  canWrite,
  nextBefore,
  loadingMore,
  onLoadMore,
  onCorrectDate,
}: {
  readonly nodes: readonly TimelineNode[];
  /** Search results come flat; the record comes grouped by month. */
  readonly grouped: boolean;
  readonly canWrite: boolean;
  readonly nextBefore: string | null;
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
  readonly onCorrectDate: (documentId: string, value: string | null) => Promise<void>;
}) {
  const groups: readonly TimelineGroup[] = grouped
    ? timelineGroups(nodes)
    : [{ key: "search", label: "", yearMarker: null, nodes }];
  return (
    <section className="document-timeline" aria-labelledby="document-timeline-title">
      <h3 id="document-timeline-title" className="visually-hidden">
        Лента документов
      </h3>
      {nodes.length === 0 ? (
        <p className="document-timeline__empty" role="status">
          В ленте пока ничего нет: документ появляется здесь, когда проверка завершена.
        </p>
      ) : (
        <ol className="document-timeline__months">
          {groups.map((group) => (
            <li key={group.key} className="document-timeline__month">
              {group.yearMarker !== null ? <p className="document-timeline__year">{group.yearMarker}</p> : null}
              {group.label !== "" ? <h4 className="document-timeline__month-title">{group.label}</h4> : null}
              <ol className="document-timeline__nodes">
                {group.nodes.map((node) => (
                  <TimelineNodeView key={node.id} node={node} canWrite={canWrite} onCorrectDate={onCorrectDate} />
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}
      {nextBefore !== null ? (
        <button className="button button--secondary document-timeline__more" type="button" disabled={loadingMore} onClick={onLoadMore}>
          {loadingMore ? "Загружаем…" : "Показать раньше"}
        </button>
      ) : null}
    </section>
  );
}

function TimelineNodeView({
  node,
  canWrite,
  onCorrectDate,
}: {
  readonly node: TimelineNode;
  readonly canWrite: boolean;
  readonly onCorrectDate: (documentId: string, value: string | null) => Promise<void>;
}) {
  const handle = useProfileHandle();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const date = effectiveDateCopy(node.effectiveDate);
  async function save(value: string | null) {
    setPending(true);
    setError(null);
    try {
      await onCorrectDate(node.id, value);
      setEditing(false);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError && requestError.status === 422
          ? "Дата не подходит: нужен календарный день не позже завтрашнего."
          : "Не удалось сохранить дату. Проверьте соединение и повторите.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <li className="document-timeline__node" data-testid={`timeline-node-${node.id}`}>
      <div className="document-timeline__date">
        <time dateTime={node.effectiveDate.value}>{date.date}</time>
        {date.marker !== null ? <span className="document-timeline__marker">{date.marker}</span> : null}
        {canWrite && !editing ? (
          <button className="text-link text-link--button" type="button" onClick={() => setEditing(true)}>
            Исправить дату
          </button>
        ) : null}
      </div>
      {editing ? (
        <DocumentDateEditor
          value={node.effectiveDate.value}
          max={latestCorrectableDate(new Date())}
          canClear={node.effectiveDate.source === "person"}
          pending={pending}
          error={error}
          onSave={(value) => void save(value)}
          onClear={() => void save(null)}
          onCancel={() => setEditing(false)}
        />
      ) : null}
      <div className="document-timeline__body">
        <p className="document-timeline__kicker">
          {node.category === null ? "Документ" : documentCategoryLabels[node.category]}
        </p>
        <Link className="document-timeline__title" href={documentPath(handle, node.id)}>
          {node.title}
        </Link>
        {node.shortSummary !== null ? <p className="document-timeline__summary">{node.shortSummary}</p> : null}
        <p className="document-timeline__filename">{node.filename}</p>
        {node.counts.length > 0 ? (
          <ul className="document-timeline__counts">
            {node.counts.map((count) => (
              <li key={count}>{count}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
```

```tsx
// apps/web/app/components/documents-workspace.tsx
"use client";

import type { DocumentSummary, ProfileOverviewResponse } from "@veylta/contracts";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { apiPrefix, apiRequest } from "../api-client";
import { queueCounts, queueRows } from "../document-queue";
import { searchNodes, timelineNodes } from "../document-timeline";
import {
  buildDocumentSearchPath,
  buildDocumentsArchiveHero,
  normalizeDocumentSearchResponse,
  restartTargets,
} from "../documents-archive";
import { profileApiPath } from "../paths";
import { useArchiveActions } from "../use-archive-actions";
import { useDocumentTimeline } from "../use-document-timeline";
import { DocumentQueue } from "./document-queue";
import { DocumentTimeline } from "./document-timeline";
import { DocumentsHero } from "./documents-hero";

type SearchState =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "ready"; query: string; documents: readonly DocumentSummary[] }
  | { kind: "error"; query: string };

/** The documents page: the one-line hero, the exports, the queue, then the timeline; search shows hits as nodes. */
export function DocumentsWorkspace({
  familyId,
  profileId,
  canWrite,
  overview,
  onReload,
  onUpload,
}: {
  readonly familyId: string;
  readonly profileId: string;
  readonly canWrite: boolean;
  readonly overview: ProfileOverviewResponse;
  readonly onReload: () => Promise<void>;
  readonly onUpload: () => void;
}) {
  const rows = queueRows(overview);
  const counts = queueCounts(overview);
  const archive = useArchiveActions({ familyId, profileId, reload: onReload });
  // A document leaving the queue must show up below: the queue's size is the timeline's revision.
  const timeline = useDocumentTimeline({ familyId, profileId, revision: counts.inQueue });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({ kind: "idle" });
  const [searchRevision, setSearchRevision] = useState(0);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchState({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setSearchState({ kind: "loading", query });
    const timeout = window.setTimeout(
      () => {
        void apiRequest<unknown>(buildDocumentSearchPath(familyId, profileId, query), {
          signal: controller.signal,
        })
          .then((response) => {
            if (!controller.signal.aborted) {
              setSearchState({ kind: "ready", query, documents: normalizeDocumentSearchResponse(response) });
            }
          })
          .catch(() => {
            if (!controller.signal.aborted) setSearchState({ kind: "error", query });
          });
      },
      searchRevision === 0 ? 260 : 0,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [familyId, profileId, searchQuery, searchRevision]);

  return (
    <>
      <DocumentsHero
        canWrite={canWrite}
        summary={buildDocumentsArchiveHero(overview, counts.inQueue)}
        bulkConfirmPending={archive.action.kind === "confirming"}
        bulkConfirmProgress={
          archive.action.kind === "confirming" && archive.action.documentId === null
            ? `Подтверждаем ${archive.action.completed} из ${archive.action.total}…`
            : null
        }
        bulkConfirmError={archive.action.kind === "error" ? archive.action.copy : null}
        restartAllPending={archive.action.kind === "restarting"}
        searchQuery={searchQuery}
        onSearchChange={(query) => {
          setSearchRevision(0);
          setSearchQuery(query);
        }}
        onUpload={onUpload}
        onConfirmAll={() => void archive.confirmDocuments(overview.reviewQueue.documents)}
        onRestartFailed={() => void archive.restartDocuments(restartTargets(overview))}
      />
      {canWrite ? (
        <details className="profile-overview__exports">
          <summary>Экспорт источников</summary>
          <div>
            <p className="profile-overview__export">
              <a className="text-link" href={`${apiPrefix}${profileApiPath(familyId, profileId)}/evidence-bundle`} download>
                Скачать локальный пакет источников
              </a>
              <span>До 5 синтетических исходников; это не резервная копия.</span>
            </p>
            <p className="profile-overview__export">
              <a className="text-link" href={`${apiPrefix}${profileApiPath(familyId, profileId)}/portable-export`} download>
                Скачать полный synthetic-экспорт профиля
              </a>
              <span>Все источники и подтверждённые записи в пределах локального лимита.</span>
            </p>
          </div>
        </details>
      ) : null}
      {searchState.kind === "idle" ? (
        <>
          <DocumentQueue
            rows={rows}
            canWrite={canWrite}
            action={archive.action}
            onRestart={(row) => void archive.restartDocuments([row.document])}
          />
          {timeline.state.kind === "loading" ? (
            <p className="document-timeline__loading" aria-live="polite">
              Собираем ленту…
            </p>
          ) : null}
          {timeline.state.kind === "error" ? (
            <div className="profile-overview__empty" role="status">
              <p>Не удалось загрузить ленту. Очередь выше актуальна.</p>
              <button className="button button--secondary" type="button" onClick={() => void timeline.reload()}>
                Повторить
              </button>
            </div>
          ) : null}
          {timeline.state.kind === "ready" ? (
            <DocumentTimeline
              nodes={timelineNodes(timeline.state.entries)}
              grouped
              canWrite={canWrite}
              nextBefore={timeline.state.nextBefore}
              loadingMore={timeline.state.loadingMore}
              onLoadMore={() => void timeline.loadMore()}
              onCorrectDate={timeline.correctDate}
            />
          ) : null}
        </>
      ) : null}
      {searchState.kind === "loading" ? (
        <div className="document-search-state" role="status">
          <span className="document-search-state__spinner" aria-hidden="true" />
          <div>
            <strong>Ищем по саммари и результатам</strong>
            <p>Запрос «{searchState.query}» проверяется в локальном архиве.</p>
          </div>
        </div>
      ) : null}
      {searchState.kind === "error" ? (
        <div className="document-search-state document-search-state--error" role="alert">
          <div>
            <strong>Поиск временно недоступен</strong>
            <p>Архив не изменён. Можно повторить тот же запрос.</p>
          </div>
          <button className="button button--secondary" type="button" onClick={() => setSearchRevision((current) => current + 1)}>
            Повторить
          </button>
        </div>
      ) : null}
      {searchState.kind === "ready" && searchState.documents.length === 0 ? (
        <div className="profile-overview__empty document-search-empty" role="status">
          <Search size={20} aria-hidden="true" />
          <p>По запросу «{searchState.query}» ничего не найдено.</p>
          <button className="text-link text-link--button" type="button" onClick={() => setSearchQuery("")}>
            Показать весь архив
          </button>
        </div>
      ) : null}
      {searchState.kind === "ready" && searchState.documents.length > 0 ? (
        <DocumentTimeline
          nodes={searchNodes(searchState.documents)}
          grouped={false}
          canWrite={false}
          nextBefore={null}
          loadingMore={false}
          onLoadMore={() => undefined}
          onCorrectDate={async () => undefined}
        />
      ) : null}
    </>
  );
}
```

(The export `details` block and the three search states are `veylta-app.tsx:3608–3636` and `3674–3710` moved with their copy; the evidence-bundle and portable-export paths were `evidenceBundlePath`/`portableProfileExportPath` there — `…/evidence-bundle` and `…/portable-export` under the profile API path, check `veylta-app.tsx:252–256` and keep the exact suffixes. The old toolbar's «N в архиве · M ждут проверки» stats line is replaced by the hero's counts line.)

`documents-hero.tsx`: `title="Документы"`, the meta line = `heroCountsCopy(summary)` when `summary !== null` (the `PageHero` `meta` slot), actions unchanged («Загрузить документы», «Подтвердить без замечаний N», «Перезапустить разбор N»), `testId="documents-hero"` kept. The search input stays in the hero's `search` slot.

`veylta-app.tsx` `ProfileOverviewPanel`: the `view === "documents"` branch becomes
```tsx
<DocumentsWorkspace familyId={familyId} profileId={profileId} canWrite={canWriteProfile} overview={state.overview} onReload={refreshOverview} onUpload={onUpload} />
```
and the loading branch keeps its `DocumentsHero` skeleton (`summary={null}`); delete `ArchiveRows`, `profileOverviewProcessingCopy`, `documentCategoryLabels`, `ArchiveActionState`, `confirmDocuments`, `restartDocuments`, the search state and effect, and the now-unused imports (`Search`, `FileUp` if unused, `archiveRows`, `awaitingReviewVerb`, …) — Biome's `noUnusedImports` tells you. The 1 s polling effect (3464–3482) stays in `ProfileOverviewPanel`: it keeps the queue live.

CSS (append to `globals.css`, tokens only — reuse the variables `.archive-list` uses): `.document-queue__rows` (list reset, 8px gap), `.document-queue__row` (grid `1fr auto`, 12px padding, 10px radius, the surface border), `.document-queue__state` (muted), `.document-queue__progress` (the small spinner the search state uses), `.document-timeline__months` (list reset), `.document-timeline__month` (relative, `border-left: 1px solid var(--border)` as the line — one hairline is the timeline's spine, not a side-stripe accent), `.document-timeline__year` (sticky top label), `.document-timeline__node` (relative, padding-left 24px, a 10px dot `::before` on the line), `.document-timeline__date` (flex, gap 8px, the marker muted), `.document-timeline__counts` (inline chips like `.archive-list` chips), `.document-date-editor` (grid, gap 8px, max-width 320px). Mobile ≤ 640px: the row stacks.

- [ ] **Step 3: Verify**

Run: `pnpm exec biome check --write apps/web/app && pnpm --filter @veylta/web typecheck && pnpm --filter @veylta/web test && pnpm lint && pnpm --filter @veylta/web build`
Expected: green; `File lengths OK`; `veylta-app.tsx` well under 7363 (report the number — expect ≈ −450); each new component ≤ 250 lines (split `document-timeline.tsx` into `document-timeline.tsx` + `document-timeline-node.tsx` if it crosses).

Then a visual pass on the synthetic stand: `pnpm build && pnpm test:e2e e2e/document-upload.spec.ts` will fail on the old archive assertions (Task 8 rewrites them) — that is expected; what must hold here is that the page renders (no runtime error in the browser console for the documents tab). Take one screenshot of `/<handle>/docs` with a queued and a reviewed document through a scratch Playwright spec (do not commit it) and attach it to the report.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): the documents page — a queue of what is not done and a timeline of reviewed documents by a correctable date

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: e2e — the queue, the timeline, the corrected date; the archive specs follow the new page

**Files:**
- Create: `e2e/document-timeline.spec.ts`
- Modify: `e2e/document-upload.spec.ts` (the «Архив документов» assertions ≈ the first test's step 4), `e2e/readme-screenshots.spec.ts` (only if it asserts the archive), any spec `grep -l "Архив документов\|archive-list\|Открыть проверку\|Открыть источник" e2e/*.spec.ts` names

- [ ] **Step 1: The scenario**

```ts
// e2e/document-timeline.spec.ts
import { expect, test } from "@playwright/test";
import { confirmResult, correctResult, openReview } from "./support/review";

// Upload → the document sits in the queue → both values decided → it appears in the timeline under
// its effective date («по дате загрузки» for the lab fixture, which carries no date of its own) →
// the person corrects the date → the node moves to May.

test("a document waits in the queue, joins the timeline once reviewed, and moves when its date is corrected", async ({ page }) => {
  await openReview(page);
  const documentUrl = page.url();
  const profileUrl = documentUrl.replace(/\/docs\/[0-9a-f-]{36}$/, "");

  await page.goto(`${profileUrl}/docs`);
  const queue = page.getByRole("region", { name: "Очередь" });
  await expect(queue.getByRole("link", { name: /review-.*\.pdf|Результаты исследования/ })).toBeVisible();
  await expect(queue.getByRole("link", { name: "Проверить 2 значения" })).toBeVisible();
  await expect(page.getByTestId("documents-hero")).toContainText("1 всего · 1 в очереди · 1 ждёт проверки");
  await expect(page.locator(".document-timeline__empty")).toBeVisible();

  await page.goto(documentUrl);
  await confirmResult(page, "synthetic-analyte-a");
  await correctResult(page, "synthetic-analyte-b", { name: "ТТГ", value: "6.8", unit: "мМЕ/л" });

  await page.goto(`${profileUrl}/docs`);
  await expect(page.locator(".document-queue__empty")).toHaveText("Очередь пуста");
  await expect(page.getByTestId("documents-hero")).toContainText("1 всего · 0 в очереди · 0 ждут проверки");
  const node = page.locator(".document-timeline__node");
  await expect(node).toHaveCount(1);
  await expect(node).toContainText("по дате загрузки");
  await expect(node).toContainText("подтверждено 2");
  const today = new Date();
  const thisMonth = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" }).format(today);
  await expect(page.locator(".document-timeline__month-title").first()).toContainText(
    new RegExp(`^${thisMonth.charAt(0).toUpperCase()}${thisMonth.slice(1)} ${today.getUTCFullYear()}$`),
  );

  await node.getByRole("button", { name: "Исправить дату" }).click();
  const editor = page.getByRole("form", { name: "Исправление даты документа" });
  await editor.getByLabel("Дата документа").fill("2026-05-14");
  await editor.getByRole("button", { name: "Сохранить дату" }).click();
  await expect(page.locator(".document-timeline__month-title").first()).toHaveText("Май 2026");
  await expect(node).toContainText("14 мая 2026 г.");
  await expect(node).toContainText("дата исправлена");

  await page.reload();
  await expect(page.locator(".document-timeline__month-title").first()).toHaveText("Май 2026");

  // Clearing returns the upload day.
  await page.locator(".document-timeline__node").getByRole("button", { name: "Исправить дату" }).click();
  await page.getByRole("form", { name: "Исправление даты документа" }).getByRole("button", { name: "Сбросить" }).click();
  await expect(page.locator(".document-timeline__node")).toContainText("по дате загрузки");
});
```

(The month assertion uses UTC because the effective date of an upload is the UTC day; a run that crosses midnight UTC between upload and assertion is the only way it differs — acceptable on the stand. If `correctResult` on analyte b leaves the run awaiting review for any reason, decide b with `confirmResult` instead and say so in the report.)

- [ ] **Step 2: Sweep the archive assertions**

`e2e/document-upload.spec.ts` first test, step 4 («Документы» tab): the outer `<section id="document-archive" aria-label="Архив документов">` stays in `ProfileOverviewPanel`, so `getByRole("region", { name: "Архив документов" })` still resolves; inside it, replace «1 значение без замечаний» / «1 значение требует отдельной проверки» / «Открыть проверку» with the queue's row: the state copy «2 значения ждут явной проверки», the link «Проверить 2 значения», and the document's title link; the exports block assertions («Скачать локальный пакет источников», the two downloads) stay. Keep the file ≤ 298 lines (legacy baseline). Run `grep -n "Архив документов\|Открыть проверку\|Открыть источник\|archive-list\|без замечаний\|отдельной проверки" e2e/*.spec.ts` and fix every hit the same way (`readme-screenshots.spec.ts` runs only under `README_SCREENSHOTS=1`; keep it compiling and consistent).

- [ ] **Step 3: Run the whole suite**

Run: `pnpm build && pnpm test:e2e`
Expected: all specs pass (≈48, 2 README screenshot specs skipped by design). Read every failure's received text before changing an assertion; never loosen one to pass.

- [ ] **Step 4: Commit**

```bash
pnpm exec biome check --write e2e
git add e2e
git commit -m "test(e2e): the documents queue and timeline; the archive specs follow the new page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Docs and the full check

**Files:**
- Modify: `CLAUDE.md` (a «Documents: queue and timeline» paragraph in Architecture; the «Document workspace» paragraph stays), `docs/api.md` (the two endpoints and `document/v8` / `profile-overview/v3` fields next to the existing document endpoints), `docs/status.md` (item 29), `docs/superpowers/specs/2026-08-18-shell-routes-documents-history-design.md` (Part 3: «Status: delivered on <date>» + the two execution decisions: whole-day pages; `documentCount` on the overview)

- [ ] **Step 1: Docs**

`CLAUDE.md`, after the «Document workspace: two different "threads."» paragraph:

```md
**Documents: queue and timeline.** A document's *effective date* is one rule
(`documents/document-date.ts`: the person's correction → the document's own date → the upload
day in UTC, with `source: person | document | upload`), carried as `effectiveDate` by every
projection with `intelligence` (`document/v8`, `profile-overview/v3`, which also counts
`documentCount`); `PUT …/documents/:id/date` (`document-date-service.ts`, migration 0039
`documents.document_date_override`) corrects it — 422 for a malformed day or one after tomorrow,
audited payload-free as `document.date.corrected`. *Queue membership* is one rule in
`packages/contracts/src/document-timeline.ts` (`isInDocumentQueue`: processing not completed or a
fact undecided), shared by the web and by `GET …/documents/timeline` (`document-timeline-service.ts`,
`document-timeline/v1`), which returns only reviewed documents in whole-day pages
(`?before=&limit=` days, `nextBefore`) with `confirmedCount`, `outsideRangeCount` (the dossier's
rule, `packages/contracts/src/observation-status.ts`) and `recordCount`. Web: `app/document-queue.ts`
(rows, counts, actions), `app/document-timeline.ts` (nodes, month groups, date copy),
`components/documents-workspace.tsx` → `document-queue.tsx` + `document-timeline.tsx` +
`document-date-editor.tsx`; the overview's document queries share `overview-documents-query.ts`.
```

`docs/status.md` item 29: `29. see documents as a short queue of what is not done and a timeline of reviewed documents by their effective date, which the person may correct.` `docs/api.md`: the two endpoints in the existing style (read how `PUT …/profiles/:p/handle` was documented in Part 2 and mirror it). Spec: Part 3 status line.

- [ ] **Step 2: Full check**

Run: `pnpm license:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:e2e`
Expected: green. Then `pnpm db:migrate` on the local stand (applies 0039) and `curl -s localhost:4301/readyz` → `"status":"ok"` (the controller runs these two and the push).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/api.md docs/status.md docs/superpowers/specs/2026-08-18-shell-routes-documents-history-design.md
git commit -m "docs: the documents queue and timeline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

The controller pushes `main` and watches `gh run list` until the run is `success`.
