# Shell, routes, documents timeline, history — design

Status: approved in conversation on 2026-08-18 (owner's choices recorded inline); implementation
plan follows this document. Four independent parts, delivered in the order below, each its own
commit with green CI and an e2e scenario.

1. Header and settings — the gear replaces the status chip; settings split into «Пользователь»
   and «Приложение».
2. Handles and routes — `/<handle>/…` instead of `/families/:f/profiles/:p…`, `/login`.
3. Documents — a processing queue above a vertical timeline by document date; the date is
   correctable.
4. History — indicator trends with a «what changed» summary.

Everything below keeps the invariants of `CLAUDE.md`: API paths stay UUID-scoped, audit rows stay
payload-free, synthetic data only in tests and fixtures, contracts bump on a shape change, no file
over 250 lines (the legacy `veylta-app.tsx` only shrinks).

---

## Part 1 — header and settings

### Header

- The «Настройки» tab leaves the tab bar (`workspace-tab-settings` and its panel wiring go).
- Where the «Домашний сервер» chip with the status dot sits today, a gear icon button «Настройки»
  appears for sessions that may open settings (`canOpenSettings`: family owner or admin). It links
  to the settings of the current profile (`/<handle>/settings` after part 2; until then
  `/settings?profile=<id>`). Sessions without that right see nothing in that spot.
- The readiness dot stays on the login screen (`SystemStatus`) and moves into the «Приложение»
  section as its first line.

### Settings page

Two sections with a switcher at the top; the page keeps its shell (`settings-shell`) and the
existing blocks, regrouped:

- **«Пользователь»** (default): this person and their family — profile name and handle (part 2
  adds the handle field with its rule and availability check), the family's «Профили и доступ»
  block focused on this person (profiles, invitations, `profile.read` grants, archiving), and who
  is signed in (name, login, role).
- **«Приложение»** (admins only): server readiness (the dot and «API и база данных готовы»),
  Codex (model, efforts, the assistants' reasoning), storage, server accounts — today's admin
  blocks unchanged.

A section the session may not open behaves as today (`MissingSettingsScreen`). Deep link: the
switcher is reflected in the URL (`/settings` vs `/settings/app` before part 2;
`/<handle>/settings` vs `/<handle>/settings/app` after).

### Tests

- Pure: `account-access.ts` gains nothing new — `canOpenSettings` stays the gate; a small
  `settings-sections.ts` (which sections a session may open, default section) with unit tests.
- e2e: the gear is visible to the owner and absent for a read-only grantee; it opens the user
  section; an admin sees the application section with the readiness line.

---

## Part 2 — handles and routes

Status: delivered on 2026-08-19. Two decisions made during execution: the handle stays out of the
synthetic evidence bundle and the profile export (`Omit<PatientProfileSummary, "access" |
"handle">`, both contracts unchanged at v1), and `[handle]/layout.tsx` keeps the shell mounted
across tabs.

### Data

- Migration 0038: `patient_profiles.handle TEXT COLLATE NOCASE` (nullable in SQL, since `ALTER
  TABLE ADD COLUMN` cannot add a unique NOT NULL column; every write path sets it and the
  provisional fill leaves no NULL) and `handle_set_by TEXT NOT NULL DEFAULT 'auto' CHECK
  (handle_set_by IN ('auto', 'person'))`, unique index
  server-wide (`patient_profiles_handle_unique ON patient_profiles (handle COLLATE NOCASE)`),
  CHECK: 3–30 characters, `[a-z0-9][a-z0-9-]*`, no trailing hyphen, lower-case. The migration
  gives existing rows a provisional `p-<12 hex of the id>` (`auto`), and `pnpm db:migrate` then
  rewrites provisional handles by the default rule below in code (migrations are SQL files; the
  rule lives in TypeScript and is tested there); rollback drops the columns. An archived profile
  keeps its handle — it stays taken, and restoring needs no new one.
- **Default rule** (`apps/api/src/family/profile-handle.ts`, pure, tested):
  1. a profile linked to an account (`linked_user_id`) takes the account's username,
     normalised to the handle alphabet (`.` and `_` → `-`, truncated to 30);
  2. otherwise a transliteration of the display name's first word («Анна Иванова» → `anna`,
     «Маша» → `masha`), lower-cased, non-alphabet characters dropped;
  3. an empty or too-short result becomes `profile`;
  4. a reserved word or a taken handle gets `-2`, `-3`, … until free.
- **Reserved words** (one list in `packages/contracts/src/profile-handle.ts`, exported for the
  API and the web): `login`, `logout`, `settings`, `families`, `profiles`, `profile`, `health-api`,
  `api`, `docs`, `documents`, `history`, `dossier`, `plan`, `assistants`, `app`, `admin`, `static`,
  `_next`, `manifest.webmanifest`, `favicon.ico`, `robots.txt`.
- The server sets the handle on profile creation (every insert goes through one helper); a
  `handle_set_by` column `auto | person` records whether a person chose it, so the backfill that
  rewrites provisional handles never touches one a person set.
- Contracts (`family-profile/v3`): `PatientProfileSummary.handle`, `SessionFamily.profiles[].handle`,
  the profile-create and demo-registration responses carry `handle`;
  `PUT /v1/families/:familyId/profiles/:profileId/handle` with `{ handle }` — owner or linked adult
  (`requireProfileWrite`), 422 for an invalid or reserved handle, 409 for a taken one, 404 for a
  profile the session may not write; audited payload-free as `profile.handle.changed`.
- The API keeps UUID paths throughout; handles are a browser concern. A web request resolves a
  handle to `{ familyId, profileId }` from the session (`SessionResponse.families[].profiles[]`);
  an unknown handle renders the existing «Профиль не найден» screen with the accessible profiles.

### Browser routes

| Route | Shows |
| --- | --- |
| `/login` | sign-in; a signed-in session is sent to its first profile |
| `/` | redirect → first profile of the session, or `/login` |
| `/<handle>` | overview |
| `/<handle>/docs` | documents (queue + timeline, part 3) |
| `/<handle>/docs/<documentId>` | one document |
| `/<handle>/history` (`?code=<canonicalCode>`) | history (part 4) |
| `/<handle>/dossier` | dossier |
| `/<handle>/assistants/<assistantId>` (`?conversationId`, `?ask`) | assistant room |
| `/<handle>/settings`, `/<handle>/settings/app` | settings sections (part 1) |

- `app/paths.ts` is the only place that builds browser paths (`profilePath(handle)`,
  `profileTabPath(handle, tab)`, `documentPath(handle, id)`, `assistantPath(handle, id, …)`,
  `settingsPath(handle, section)`); `ProfileTab` maps to path segments (`overview` → ``, `documents`
  → `docs`, `history`, `dossier`). Every caller receives the handle from the session context; no
  component spells a URL by hand.
- Next route folders: `app/login/page.tsx`, `app/[handle]/page.tsx`, `app/[handle]/docs/page.tsx`,
  `app/[handle]/docs/[documentId]/page.tsx`, `app/[handle]/history/page.tsx`,
  `app/[handle]/dossier/page.tsx`, `app/[handle]/assistants/[assistantId]/page.tsx`,
  `app/[handle]/settings/page.tsx`, `app/[handle]/settings/app/page.tsx`. The dynamic `[handle]`
  segment sits below the static ones, so reserved words never reach it.
- **Legacy redirects** (kept for one release): `/families/:f/profiles/:p[/documents/:d |
  /assistants/:a]` and `?tab=` / `?canonicalCode=` render a thin redirector that resolves the
  profile through the session and `router.replace`s the new path; `/settings[?profile=]` → the
  first profile's settings (or that profile's).
- e2e: the `profileUrl` helpers and every regex on `/families/…` move to `/<handle>/…`; the review
  support reads the handle from the registration response.

### Tests

- Pure: the default rule (username, transliteration, reserved, collision suffix), the reserved
  list, `paths.ts`.
- Integration: migration 0038 up/down with existing profiles (handles filled, unique), `PUT
  …/handle` (owner 200, outsider 404, reserved and malformed 422, taken 409 regardless of case,
  the same handle again a no-op), audit payload-free.
- e2e: sign in at `/login` → lands on `/<handle>`; the owner changes the handle in settings and
  the address follows; an old `/families/…` link redirects.

---

## Part 3 — documents: queue and timeline

### Data

- Migration 0039: `documents.document_date_override TEXT` (YYYY-MM-DD or NULL) with the plan's
  date CHECK. `PUT /v1/families/:familyId/profiles/:profileId/documents/:documentId/date` with
  `{ documentDate }` (a date or `null` to clear) — `requireProfileWrite`, 422 for a malformed or
  future-beyond-tomorrow date, 404 for an unknown or unauthorised document; audited payload-free
  as `document.date.corrected` (no date in the audit row).
- **Effective date** — one rule on the server (`documents/document-date.ts`, pure, tested):
  `override` → `intelligence.documentDate` → `uploadedAt` (calendar day, UTC), with
  `source: "person" | "document" | "upload"`. Every document projection that carries
  `intelligence` gains `effectiveDate: { value, source }` (`document/v8`, `profile-overview/v3`).
- **Timeline endpoint** (`document-timeline/v1`):
  `GET …/documents/timeline?before=<YYYY-MM-DD>&limit=<1..50>` returns entries ordered by
  `effectiveDate` desc, `uploadedAt` desc: `id`, `originalFilename`, `contentType`, `uploadedAt`,
  `effectiveDate`, `category`, `title`, `shortSummary` (null until analysed), `confirmedCount`,
  `outsideRangeCount` (confirmed observations with the laboratory's flag or outside the printed
  bounds — the dossier's rule), `recordCount` (confirmed clinician records), plus `nextBefore`
  for paging. Only documents that have left the queue appear (see below), so every entry is a
  reviewed, completed document.
- **Queue membership** (one rule, `documents/document-queue.ts`, pure, tested, shared by the
  timeline query and the web): a document is *in the queue* while its processing is not
  `completed` (uploaded, processing, failed, awaiting_review) **or** it still has facts without a
  review decision. Everything else is *in the timeline*. The queue is read from the existing
  overview (`recentDocuments` + `reviewQueue`); it is bounded by nature.

### Screen `/<handle>/docs`

- **Hero** shrinks to one line: «Документы» · counts (всего · в очереди · ждут проверки) ·
  «Загрузить». The existing upload dialog stays.
- **Очередь** (`document-queue.tsx`): compact rows — filename, state, progress for a running
  analysis, «Повторить» for a retryable failure, «Проверить N значений» for awaiting review; the
  bulk actions («Повторить всё», «Подтвердить всё безопасное») sit above the queue as today.
  Empty queue: one line «Очередь пуста».
- **Лента** (`document-timeline.tsx`): a vertical timeline, newest first, grouped «Месяц ГГГГ»
  with a year marker; a node shows the date (with «по дате загрузки» when the source is not the
  document, and a pencil «Исправить дату» opening a date field that calls the endpoint above),
  category and title/short summary, filename, «подтверждено N», «вне референса: N», «записи
  врача: N» when any, and the way into the document. «Показать раньше» pages with `nextBefore`.
  A corrected date moves the node on the next render.
- Pure modules: `app/document-queue.ts` (rows, order, action copy), `app/document-timeline.ts`
  (grouping, date copy and source marker, node counts). `veylta-app.tsx` loses its documents-tab
  markup to these components.

### Tests

- Pure: effective date rule, queue membership, grouping by month/year, date copy.
- Integration: the timeline endpoint (ordering, paging, counts, queue exclusion), `PUT …/date`
  (owner 200, grantee 404, malformed 422, clearing with `null`, audit payload-free).
- e2e: upload → the document sits in the queue → review → it appears in the timeline under its
  document date; correcting the date moves it to another month.

---

## Part 4 — history: trends and «what changed»

### Data

No new API. `indicator-series/v1` (one code's values by date with printed bounds),
`observation-history/v1` (paged values with sources) and `indicator-catalog` (the codes of the
record) already exist; `app/dossier.ts` (`buildDossierSeries`, `seriesAssessment`, `printedDelta`)
already computes series, statuses and deltas — history reuses it. The only new logic is the
summary.

### Screen `/<handle>/history`

- **«Что изменилось»** (`app/history-summary.ts`, pure, tested): a period switch (3 мес · 6 мес ·
  год · всё); over the period, how many indicators moved outside the printed range, how many
  returned inside, how many stayed as they were, how many were measured for the first time; under
  each count, chips of the indicators, click selects below. Facts only, by the dossier's status
  rule over confirmed values — no scores.
- **Rail** (`history-rail.tsx`): areas in `ANALYTE_AREAS` order, indicators with a sparkline, the
  latest value and the delta since last time; a filter field on top (today's indicator catalog as
  a search); `?code=` fixes the selection (replaces `?canonicalCode=`; the old query redirects).
- **Chart** (`history-chart.tsx`, SVG per the dataviz guide): values by date, the printed
  reference band (stepped per value when the bounds differ between laboratories), status-coloured
  points, hover/focus shows value, date and laboratory, click opens the source document; the time
  axis spans the selected period. Below it, the table of that indicator's values with sources
  (today's list, filtered). With no selection the chart shows the first «вне референса» indicator
  of the summary, else the first in rail order.
- Units are never converted: two printed units of one code are two series, chosen by a chip above
  the chart.
- Mobile: the rail collapses into a select above the chart.

### Tests

- Pure: the summary over synthetic series (moved out, returned, unchanged, new; period edges),
  chart scales (band, stepped bounds, point placement).
- e2e: open history → the summary counts for the synthetic record → pick an indicator → the chart
  and the table show its values with a source link; the period switch changes the summary.

---

## Delivery, verification, boundaries

- Order: part 1 → 2 → 3 → 4; each part is one commit (or a few), green on the full sequence
  `pnpm license:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration &&
  pnpm build && pnpm test:e2e`, pushed to `main` with CI watched.
- TDD throughout: pure modules with unit tests first, integration tests for every new endpoint
  and migration, one e2e scenario per part. The synthetic stand (fake codex, synthetic fixtures)
  carries the e2e; nothing real.
- Docs: `CLAUDE.md` (routes, handles, settings sections, documents/history modules), `README.md`,
  `docs/status.md`, `PRODUCT.md` where a surface is described; contract versions bumped where
  shapes change (`family-profile/v3`, `document/v8`, `profile-overview/v3`,
  `document-timeline/v1`).
- Out of scope: API path changes, handle history/aliases for renamed handles, an events feed in
  history (noted as a later mode), editing any extracted value from the timeline.
