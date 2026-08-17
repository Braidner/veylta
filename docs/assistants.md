# Assistants: navigator, nutrition, movement — working plan

Status: **draft for discussion** (2026-08-17). Nothing here is delivered; the open decisions at
the end need an owner's answer before slice 1 starts.

## What exists today

- The profile overview shows three assistant cards (`profile-dashboard.ts`): «Медицинский
  навигатор», «Питание», «Движение». The navigator is a deterministic projection of the
  review/processing state (it links to the pending review, the latest document, the summary).
  Nutrition and movement only open the care plan and say what they *would* do.
- The care plan (`home-care-plan/v1`) has five lanes — `laboratory`, `clinician`, `nutrition`,
  `activity`, `reminder` — with items in `proposed → accepted → completed | dismissed`. A Codex
  proposal run (`codex-care-plan/v1`) may only *choose lanes* over the latest confirmed health
  summary; titles and notes are deterministic server templates («Собрать контекст о питании
  для обсуждения», «Уточнить ограничения для физической активности»…), every item carries run,
  summary version, model, rule version, source observation and missing context, and stays
  `proposed` until a person decides. The request needs the literal acknowledgement
  `send_confirmed_summary_to_codex`.
- Per-document Codex dialogues (`document-agent/v2`): resumable `codex exec` threads, a
  short-lived loopback MCP endpoint whose only tool re-authorises the document scope and returns
  bounded read-only projections. The runtime never sees storage keys or credentials.
- The health summary (`health-summary/v1`) is the immutable evidence snapshot: confirmed
  observations with provenance, missing data, and only deterministic next actions.
- Invariants that do not move: no diagnosis, triage, risk, trend or treatment advice; nothing
  reaches the model without explicit disclosure; audit stays payload-free; every displayed
  value is traceable to a page and fragment; drafts never become actions by themselves.

## The idea in one sentence

The assistants do not tell a family what to do with its health — they help the family **carry
out what its clinicians decided, understand its own evidence, and arrive at the next visit
prepared**. Advice originates in a clinician's document or in the family's own decision; the
assistants organise, explain, schedule and remind, and every claim about this family's data
points at a source.

That framing is what lets three assistants be genuinely useful without becoming a doctor:

| Assistant | Is | Is not |
| --- | --- | --- |
| **Навигатор** («Медицинский навигатор») | A guide over the family's own evidence: what is confirmed, what is pending, what a document or analyte is in general, what to ask at the visit, what the clinician's document says to do next | A doctor. It never says what a value *means for you*, never diagnoses, ranks urgency, or suggests treatment |
| **Питание** | A secretary and educator for the diet the clinician (or the family) decided on: turns a written recommendation into a schedule, keeps restrictions and preferences, explains nutrition concepts in general, prepares questions for a dietitian | A dietitian. It never derives a diet from a laboratory value, never prescribes supplements, calories or exclusions |
| **Движение** | A secretary and educator for activity: schedules what a physician or physiotherapist recommended, keeps constraints, explains concepts (zones, warm-up, load progression) in general, prepares questions | A trainer or physician. It never derives a programme from a laboratory value, never clears the person for a load |

## Where advice may come from — the source ladder

Every assistant output is one of four kinds, and the kind is visible in the UI:

1. **From a clinician's document.** A recommendation extracted from an uploaded source (a diet
   sheet, a discharge note, a physiotherapy plan) with page and fragment. Extraction follows the
   laboratory-fact pipeline exactly: closed schema, per-item verification, human confirmation
   before it becomes a plan item. Provenance: document, page, fragment.
2. **From the family's own decision.** A goal or constraint the person typed («не ем глютен»,
   «хочу ходить 30 минут в день», «врач разрешил только ходьбу»). Stored as profile context,
   user-authored, editable, dated. Provenance: «Ваше решение, dd.mm.yyyy».
3. **General knowledge.** An explanation of a concept («что такое ферритин», «зачем нужна
   разминка») that does not use this family's values. Rendered with a fixed label «Общая
   справка, не про ваши значения» and no numbers from the profile in the same block.
4. **Deterministic navigation.** Counts, states and links Veylta computes itself (pending
   review, last source date, items due). No model involved.

There is deliberately no fifth kind — «a recommendation derived from your value». A prompt is
not enough to guarantee that; the answer schema and the validator make it structurally
impossible (below).

## How an assistant answers

Each assistant is a profile-scoped Codex conversation, built on the document-agent runtime
(resumable `codex exec` thread, loopback MCP tools, capability token per turn). What changes
is the **tool set** and the **answer shape**.

### Tools (read-only unless stated)

| Tool | Returns | Available to |
| --- | --- | --- |
| `get_profile_context` | confirmed observations (code, printed value, unit, sample date, laboratory, source pointer), latest summary version, pending review counts, care plan items, the family's own context (goals, restrictions) | all |
| `get_source_fragment(observationId)` | the exact page fragment behind one confirmed value | all |
| `list_sources` | documents with title, category, date, extraction state | all |
| `get_document_recommendations(documentId)` | confirmed clinician recommendations extracted from a document (slice 2) | all |
| `propose_plan_item` (**write**) | creates one `proposed` care-plan item with provenance to this conversation turn and, when applicable, to a document fragment or a context entry | Питание, Движение, Навигатор |
| `propose_visit_questions` (**write**) | stores a draft question list for the next visit, each question bound to an observation or a context entry | Навигатор |

Every tool re-authorises the profile scope from the capability token; no tool returns storage
keys, paths, bytes, or anything outside the profile. Writes only ever create `proposed`
things — nothing accepted, nothing scheduled, nothing changed.

### Answer shape

An assistant turn is not free prose. It is a bounded list of typed blocks the server
validates and the UI renders:

```
answer = {
  blocks: [
    { kind: "evidence",  text, refs: [observationId | documentId+fragment] }   // must cite
    { kind: "general",   text }                                                 // labelled general
    { kind: "question",  text, refs: [...] }                                    // for the clinician
    { kind: "proposal",  itemId }                                               // created via tool
    { kind: "missing",   context: "dietary_restrictions" | ... }                // what it needs
    { kind: "boundary",  code: "not_a_diagnosis" | "ask_clinician" | ... }      // fixed copy
  ]
}
```

Validation, fail-closed and per block like the extraction pipeline:

- an `evidence` block must reference authorised observations/fragments that exist; a block
  whose reference does not resolve is dropped; an answer whose every block fails is refused with
  a closed reason (`unbound_reference`, `prescriptive_language`, `schema_shape`…);
- `general` blocks may not contain a number that appears among the profile's values (a cheap
  deterministic check that keeps «general» general);
- a lexicon gate refuses prescriptive language in any block: dosages («мг», «мкг/сут»,
  «таблетк»), drug forms, «принимайте», «назначаю», «диагноз», «у вас … (болезнь)» patterns.
  It is a guard, not a classifier: false positives are shown as «Ассистент не смог ответить в
  рамках правил», never as a softened answer;
- `boundary` codes render fixed Russian copy from one table, exactly like rejection reasons;
- the raw exchange is stored per turn for the owner (like the run journal), payload-free
  elsewhere.

### What the person sees

- One workspace per assistant on the profile: the conversation, and next to it the assistant's
  «рабочий стол» — for the navigator the pending review, last sources and the draft visit
  questions; for nutrition and movement the relevant care-plan lane, the context entries the
  assistant relies on, and the proposals awaiting a decision.
- Every evidence sentence carries the same source link as the review workspace (document,
  page, quoted fragment). Every general block carries its label. Every proposal is a card with
  «Принять / Отклонить», never applied on its own.
- Egress is disclosed once per assistant conversation, naming exactly what travels: confirmed
  values with codes and dates, the family's context entries, the conversation — never raw
  documents unless the person attaches one deliberately (which opens the existing document
  dialogue). The acknowledgement is stored with the conversation.

## What each assistant does, concretely

### Навигатор

- «Что у меня подтверждено и что ждёт решения?» — deterministic; the model only phrases.
- «Что это за анализ / документ?» — general block + evidence block («в вашем источнике от
  20.03.2026 он есть на стр. 2»).
- «Подготовь вопросы к приёму» — reads confirmed observations, source flags (the laboratory's
  own out-of-range marks — never Veylta's judgement), missing data, the family's goals; drafts
  a question list where each question cites its source; the person edits and accepts; the
  accepted list is attached to the health summary bundle for the visit.
- «Что врач написал делать?» — surfaces confirmed recommendations extracted from clinician
  documents (slice 2) and offers to turn them into plan items.
- Never: interpret a value, rank urgency, suggest a specialist «because of» a value. It may
  say «в источнике лаборатория пометила значение как вне референса» — that is the source's
  own flag.

### Питание

- Keeps the family's dietary context: restrictions, allergies, preferences, goals — typed by the
  person, dated, with an optional link to the document they came from.
- Turns a clinician's written diet recommendations (extracted and confirmed) into a plan:
  items in the `nutrition` lane, reminders, a shopping-list draft — every item pointing at the
  fragment it came from.
- Explains general nutrition concepts on request, labelled general.
- Prepares questions for a dietitian or the treating physician from the context and the
  confirmed values («у меня ферритин из отчёта от 20.03 — стоит ли обсуждать питание?» is a
  *question* the person will ask, not an answer).
- Optional (decision 2): generic, non-medical templates offered as drafts only after the person
  states there are no clinical restrictions and accepts the disclosure — e.g. «структура
  недельного меню» without quantities tied to values.
- Never: a diet from a value, supplements, calories, exclusions «because of» a value.

### Движение

- Keeps activity context: constraints («после операции — только ходьба до июня»), clearance
  status as the person stated it, preferences, equipment, goals.
- Schedules what a physician or physiotherapist recommended (extracted from a document or typed
  by the person as their decision) into the `activity` lane with reminders and a simple
  adherence log («сделано / пропущено», user-recorded).
- Explains general concepts, labelled general.
- Prepares questions for the physician/physiotherapist about load and limits.
- Optional (decision 2): generic beginner templates (walking, mobility) as drafts, only after
  stated constraints and disclosure, never adjusted by laboratory values.
- Never: clear a load, progress intensity from values, treat pain or symptoms.

## Architecture (reuse first)

- **Runtime**: `codex-document-agent-runtime.ts` generalised to `assistant-runtime` — same
  `codex exec` + resume, same disabled features, same bounded I/O; the prompt per assistant
  lives in `apps/api/src/prompts/assistant-<id>.prompt.ts`.
- **MCP**: `document-agent-mcp.ts` generalised to a per-turn capability that names the profile
  scope and the assistant id; tools registered per assistant from one registry.
- **Storage**: `assistant_conversations` / `assistant_messages` (shape of the document-agent
  tables plus `assistant_id`), `assistant_exchanges` for the owner-visible raw turn (like
  `processing_job_exchanges`), `profile_context_entries` (user-authored context: kind, text,
  optional source pointer, created/updated, revision), `visit_question_sets` (draft → accepted).
- **Contracts**: `assistant/v1` (conversation, message, blocks, boundary codes),
  `profile-context/v1`, care-plan provenance extended with `conversationTurnId` and
  `contextEntryId` next to the existing `sourceObservationId`.
- **Recommendation extraction** (slice 2): a second extraction target next to laboratory facts —
  `document_recommendations` bound to page + fragment, reviewed like facts, with a closed
  `kind` (diet, activity, medication-as-written, follow-up, other) and never rephrased into
  advice by Veylta.
- **Validation**: `assistant-answer-parser` sits beside `codex-intelligence/` and reuses its
  primitives (bounded strings, per-item keep/drop, closed reasons, source binding through
  `SourceText` for fragment references).
- **Prompts** in the prompts folder; phrases pinned by tests as today.

## Delivery in slices (each ships green: unit, integration, e2e; each behind the same egress disclosure)

1. **Profile context + navigator questions (no new extraction).** Context entries CRUD in the
   plan tab; navigator conversation with `get_profile_context`, `get_source_fragment`,
   `propose_visit_questions`; typed blocks + validator + lexicon gate; exchange journal;
   disclosure. Acceptance: a question list where every question opens its source; a refused
   answer names its rule; nothing in audit rows.
2. **Clinician recommendations from documents.** Extraction target, review, `document_recommendations`,
   `get_document_recommendations`; navigator can surface them; care-plan items may cite them.
   Acceptance: a diet sheet fixture yields items each linked to its fragment; unbound items are
   dropped exactly like unbound facts.
3. **Питание.** Its conversation, `propose_plan_item` into `nutrition`/`reminder`, dietary context
   kinds, questions for a dietitian, general explanations. Acceptance: no numeric value from
   the profile ever appears inside a `general` block; a diet «because of a value» is refused by
   the gate in a red-team spec.
4. **Движение.** Same shape over `activity`; adherence log on accepted items.
5. **Optional generic templates** (decision 2), behind an explicit per-profile switch and the
   constraint statement; then reminders/notifications hardening; then evaluation: a fixed set
   of adversarial prompts (asking for diagnosis, dosage, «is this dangerous?») run in CI against
   the fake codex with expected boundary codes.

Not in this plan: symptom questions, medication management beyond «as written in the
document», anything that reads unconfirmed extractions, and any assistant initiative without a
person's message.

## Open decisions (owner's call, with a recommendation)

1. **Name of the first assistant.** «Доктор» in the request vs «Медицинский навигатор» in the
   product. *Recommendation:* keep «Навигатор» in the UI (or «Навигатор по здоровью») — the
   product promises never to impersonate a professional, and the name is the first thing that
   promise touches; «доктор» can stay as our internal shorthand.
2. **Depth of nutrition and movement content.** (A) secretary + educator only; (B) A plus
   generic non-medical templates as drafts after stated constraints; (C) recommendations
   derived from values — excluded, it breaks the invariants. *Recommendation:* ship A in slices
   3–4, decide on B after seeing A in use.
3. **Interaction model.** (a) structured requests only (buttons: «Подготовить вопросы»,
   «Составить расписание из документа»); (b) chat with typed blocks; (c) both, chat first.
   *Recommendation:* (b) — one conversation surface per assistant, but every request the
   buttons would make is also a chip in the composer, so the common paths need no typing.
4. **What travels to the model.** Confirmed values with codes/dates/laboratory and the family's
   context; never raw documents in the assistant channel (a document is discussed in its own
   dialogue). *Recommendation:* yes, and say it verbatim in the disclosure.
5. **Reference ranges in evidence blocks.** Show only the printed range and the laboratory's own
   flag (as the review workspace does), or hide ranges from assistants entirely.
   *Recommendation:* show the printed range and the source's flag — it is source data, and
   hiding it invites the model to guess.
