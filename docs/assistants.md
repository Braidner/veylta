# Assistants: physician, nutritionist, trainer — second-opinion plan

Status: **approved by the owner on 2026-08-17 (revision 3)**; slice 1 delivered on 2026-08-17 (medical
profile, ИИ-врач with parser + checker + egress gate + journal + referrals; «Рассуждения ассистентов»
on the settings page next to the document effort, default `high` from `CODEX_ASSISTANT_REASONING_EFFORT`;
the assistants and the checker run on the dialogue model — a separate assistant model waits for a
real need; evidence travels inline — the MCP tool set below stays a later shape). **Slice 2
(консилиум) delivered on 2026-08-17**: the analyte→specialty table (`assistant/consilium-panel.ts`),
persona prompts, parallel opinions each verified and refuted, the therapist's synthesis on the
conversation's thread with agreements, side-by-side opinions and «Спросить …» chips; a person can
add a specialty to the panel, and the therapist asking for one on its own waits for a real need.
Revision 1 framed the assistants as
navigators and secretaries; the owner's intent is different and this revision follows it:

> The assistants are a real physician, nutritionist and trainer. Each first analyses the
> confirmed evidence, then names likely diagnoses and treatment options — all of it as
> recommendations. Every diagnosis and every suggested test carries a referral to a real
> clinician for confirmation. The main goal is to see how well clinicians choose diagnoses and
> treatment.

Slices 1 and 2 are delivered; the decisions at the end were taken as recommended.

## What changes in the product, deliberately

Veylta so far promised «no diagnosis, no treatment advice, no risk, no trend». That promise is
withdrawn **for the assistant surfaces**, on purpose, and replaced by a stricter one:

1. An assistant may state an interpretation, a likely diagnosis, a workup and treatment options
   — always labelled as an AI recommendation, never as a finding.
2. Every such statement is bound to the evidence it rests on (confirmed values with page and
   fragment, the person's own medical profile), states its uncertainty, and is paired with a
   referral: «подтвердить у врача (специальность)».
3. Urgency is never softened. If the evidence can mean an emergency, the assistant says so first,
   in fixed copy, before anything else.
4. Nothing an assistant says changes the record by itself: diagnoses, treatments and referrals
   are proposals until a person accepts them into the care plan; the raw exchange is kept for
   the owner; audit rows stay payload-free.

Everything else holds: source-first, immutable originals, human confirmation of extracted facts,
explicit egress disclosure, no credentials, no cloud of ours. The rewritten invariants land in
`PRODUCT.md`, `docs/threat-model.md` and `CLAUDE.md` in slice 1 — the current text says the
opposite and must not stay.

Two facts to keep in view. Regulation: a household tool for one's own family is a private
matter, but a diagnosing tool offered to others is software-as-a-medical-device in most
jurisdictions — the plan is written for the household. Model quality: the model has no live
guideline access (tools are disabled by design), so any guideline reference is the model's
memory and is labelled that way; the checker pass and evidence binding below exist because a
single generation is not trustworthy enough for this task.

## The three assistants

| Assistant | Delivers | Confirms with |
| --- | --- | --- |
| **ИИ-врач** («второе мнение») | Interpretation of confirmed values against printed ranges, age and sex; likely explanations ranked with stated confidence; suggested workup; treatment options a physician would consider, with rationale and the person's contraindications checked against their profile; a comparison with what the family's own clinician documented; questions for the visit | Referral per item: therapist / specialist named by the assistant |
| **ИИ-нутрициолог** | A diet assessment from the same evidence plus goals, restrictions and preferences; a concrete plan (structure, foods to favour or limit, and — decision 3 — quantities and supplements); what to re-check and when | Physician or dietitian; anything that interacts with a condition or medication is flagged |
| **ИИ-тренер** | An activity assessment from evidence, stated constraints, clearance and goals; a concrete programme with progression; what to stop and re-check | Physician / physiotherapist for clearance where the profile or values warrant it |

All three read the same evidence, the same medical profile, and each other's accepted plan
items, so nutrition and training do not contradict what the physician-assistant recommended and
the physician-assistant sees the diet and load the person is actually following.

## One physician, a консилиум on demand

Medicine is not one doctor. But a separate chat per specialty is a poor surface and an
expensive one. The plan takes the shape real care has:

- **The physician-assistant is a therapist (лечащий врач)**: the single entry point, the one
  who owns the synthesis and the referrals.
- **A консилиум is convened per case, not per message.** Which specialists join is decided
  deterministically from the evidence — a table from analyte codes to specialties
  (`tsh`, `t4.free`, `anti-tpo` → эндокринолог; lipids → кардиолог; `alt`, `ast`, `ggt`,
  bilirubin → гастроэнтеролог; the blood count → гематолог; `creatinine`, `urea` → нефролог;
  sex hormones → гинеколог / андролог; …) — plus whoever the therapist asks for. The person
  sees why each specialist was invited («в данных есть ТТГ и Т4»).
- **Each specialist is a persona prompt** (`prompts/assistant-specialist-<id>.prompt.ts`) run
  separately over the same evidence and profile, answering in the same typed blocks. The
  therapist's synthesis then names where the specialists agree, where they differ and why —
  a disagreement between specialists is itself a useful signal, exactly as in a real
  консилиум — takes the highest urgency, and consolidates the referrals. The checker pass
  verifies the synthesis.
- **In the UI** it is one conversation with «ИИ-врач», an action «Собрать консилиум», the
  opinions side by side under the synthesis, and composer chips such as «Спросить
  эндокринолога» that address one persona inside the same conversation.
- **For the сверка** this yields the by-specialty view the owner is after: which specialty the
  clinician referred to versus which the консилиум would have involved.

## Evidence the assistants reason over

- **Confirmed observations** — code, printed value and unit, printed reference range and the
  laboratory's own flag, sample date, laboratory, source page and fragment. Never unconfirmed
  extractions.
- **The medical profile** (new, user-authored, dated, versioned): sex, birth year, height/weight,
  known conditions, current medications with dose as the person records them, allergies,
  intolerances, family history, symptoms and complaints (free text, dated), pregnancy/lactation
  where relevant, goals, dietary restrictions and preferences, activity constraints and
  clearance as stated. Age and sex are not optional: interpretation without them is guesswork,
  and the assistant refuses to interpret while they are missing (a `missing` block).
- **The clinician's own record** (new extraction target, slice 2): diagnoses, prescriptions
  (drug, dose, schedule as written), referrals, follow-up instructions extracted from uploaded
  documents, reviewed like laboratory facts, bound to page and fragment.
- **The care plan and the accepted proposals** — what the person decided.

Everything that travels to the model is disclosed verbatim in the assistant's egress notice.

## How an assistant answers

Built on the document-agent runtime (`codex exec` + resumable thread, loopback MCP tools,
capability token per turn, features disabled, bounded I/O). What is new is the answer shape,
the checker pass and the tool set.

### Typed blocks

```
answer = { urgency, blocks: [...] }

urgency: { tier: "none" | "routine" | "soon" | "urgent" | "emergency", reasons: [evidenceRef] }

block kinds:
  interpretation   { text, refs: [observationId] }                        // what the values show
  hypothesis       { name, confidence: "low"|"moderate"|"high", rationale, refs, confirmWith: specialty, workup: [test] }
  treatment_option { name, kind: "lifestyle"|"medication_class"|"medication"|"procedure"|"referral",
                     rationale, refs, contraindications: "checked_clear"|"checked_conflict"|"unknown",
                     conflictNotes, confirmWith: specialty }
  clinician_check  { claim: "agree"|"differs"|"cannot_assess", theirs: recordRef, ours: hypothesis|treatment_option, why }
  question         { text, refs }                                          // for the visit
  general          { text }                                                // knowledge, labelled
  missing          { context: "sex"|"birth_year"|"medications"|"symptoms"|... }
  proposal         { itemId }                                              // created through a tool
```

### Validation — fail closed, per block

- Every `interpretation`, `hypothesis`, `treatment_option` and `clinician_check` must reference
  evidence that exists and is authorised; an unbound block is dropped, an answer whose every
  block fails is refused with a closed reason (`unbound_reference`, `missing_urgency`,
  `unpaired_recommendation`, `schema_shape`, …).
- Every `hypothesis` and `treatment_option` must carry `confirmWith`; an answer that recommends
  without a referral is refused (`unpaired_recommendation`). Accepting the block creates the
  referral item in the `clinician` lane automatically.
- `urgency` is mandatory. `urgent`/`emergency` render fixed copy at the top of the answer and
  in the assistant card, and cannot be dismissed by the model's own later blocks.
- A `treatment_option` of kind `medication` with a dose is refused unless it quotes the
  clinician's own prescription from a document (decision 3 may relax this for the nutritionist's
  supplements).
- `general` blocks may not contain a number that appears among the profile's values.
- The raw exchange, the checker verdict and the closed reason are stored per turn for the owner
  (like the run journal); nothing of it reaches logs, metrics or audit.

### The checker pass

Every substantive answer runs a second, independent `codex exec` with a different prompt: given
the evidence and the answer, refute it. It returns per block `supported | overreach |
contradicted | unsafe`, plus its own urgency read. Rules: a block marked `contradicted` or
`unsafe` is dropped; `overreach` lowers the confidence and adds the checker's note; the higher
of the two urgency reads wins. Two disagreeing runs are cheaper than one wrong recommendation,
and the disagreement is visible to the owner. Both runs use the assistants' own model and effort
setting (settings page, next to the document model) — the strongest model the household has,
at high effort; the fast document model is not enough here.

### Tools

| Tool | Returns | Available to |
| --- | --- | --- |
| `get_medical_profile` | the profile as the person recorded it | all |
| `get_confirmed_observations` | confirmed values with ranges, flags, dates, source pointers; optional code filter and time window | all |
| `get_source_fragment(observationId)` | the exact fragment | all |
| `get_clinician_record` | confirmed diagnoses / prescriptions / referrals from documents (slice 2) | all |
| `get_care_plan` | accepted and proposed items with provenance | all |
| `propose_plan_item` (write) | one `proposed` item in a lane, with provenance to this turn and its evidence | all |
| `propose_referral` (write) | one `proposed` `clinician` item naming the specialty and the block it confirms | all |

Writes create proposals only. Every tool re-authorises the profile scope from the capability
token and returns bounded projections — no storage keys, paths, bytes.

## Seeing how well the clinicians did

The owner's main goal is a comparison, and it has to be honest about what it can know:

- **What we can measure**: agreement between the assistant's second opinion and the clinician's
  documented diagnosis/treatment; what the assistant would have added (workup, referrals) that
  the clinician did not order; what later evidence showed (a follow-up value, a later
  diagnosis in a later document); which side the person eventually acted on.
- **What we cannot claim**: that either side was right. The assistant's own error rate is not
  known; a disagreement is a question for the next visit, not a verdict.

So slice 2 delivers the **сверка** («сверка с назначением врача»): per document, the
clinician's record next to the assistant's independent read, item by item — agree / differs
(with why) / cannot assess — and every «differs» becomes a question the person can bring to
that clinician or to a second one. Slice 5 adds the **outcome log**: for each hypothesis and
treatment option the person marks what the clinician said (confirmed / rejected / modified,
dated, optionally linked to the document that says so). Over time the log answers the owner's
question as far as it can be answered: agreement rates, what was missed by whom, and how often
later evidence sided with the assistant or the clinician. It is shown as counts with links to
the cases, never as a rating of a named doctor.

## Architecture (reuse first)

- **Runtime**: `codex-document-agent-runtime.ts` generalised to `assistant-runtime` (same
  `codex exec` + resume, disabled features, bounded I/O) plus a second `checker` invocation per
  turn. Prompts in `apps/api/src/prompts/assistant-<id>.prompt.ts` and
  `assistant-checker.prompt.ts`; the disclaimer copy and boundary codes in one table.
- **MCP**: `document-agent-mcp.ts` generalised — a per-turn capability names profile scope and
  assistant id; tools registered per assistant from one registry.
- **Storage**: `assistant_conversations` / `assistant_messages` (document-agent shape +
  `assistant_id`), `assistant_exchanges` (raw turn, checker verdict, reason),
  `medical_profile` + `medical_profile_entries` (typed, dated, revisioned),
  `clinician_records` (slice 2, bound to page + fragment, reviewed like facts),
  `assistant_outcomes` (slice 5).
- **Contracts**: `assistant/v1` (conversation, urgency, blocks, reasons), `medical-profile/v1`,
  `clinician-record/v1`; care-plan provenance gains `conversationTurnId`, `clinicianRecordId`.
- **Extraction**: clinician records reuse `codex-intelligence/` — closed schema, per-item
  verification through `SourceText`, human review — a second target next to laboratory facts.
- **Validation**: `assistant-answer-parser` beside `codex-intelligence/`, reusing its
  primitives (bounded strings, per-item keep/drop, closed reasons, source binding).
- **Evaluation**: `apps/api/eval/assistants/` — synthetic vignettes with expected urgency,
  expected top hypotheses and forbidden statements; run on demand against the real model
  (`pnpm eval:assistants`), and in CI against the fake codex for plumbing only.

## Delivery in slices

1. **Medical profile + ИИ-врач (терапевт).** Profile CRUD in the plan tab (age/sex mandatory for the
   assistant to interpret); the physician conversation with the tools above minus clinician
   records; typed blocks, validator, urgency, checker pass; referral proposals; exchange
   journal; egress disclosure; assistant model/effort settings; the rewritten invariants in
   PRODUCT.md / threat model / CLAUDE.md. Acceptance: a synthetic anaemia vignette yields an
   interpretation bound to the values, ranked hypotheses each with a referral, an urgency tier,
   and a checker verdict; a fixture with a critical potassium yields `emergency` before any
   block; an answer without referrals is refused by name.
2. **Консилиум.** The analyte→specialty table, specialist persona prompts, per-case parallel
   runs, the therapist's synthesis, side-by-side view and «Спросить …» chips. Acceptance: a
   thyroid fixture convenes the endocrinologist for a stated reason; a disagreement between
   two personas is shown, not averaged away; the synthesis carries the highest urgency.
3. **Clinician records + сверка.** Extraction of diagnoses / prescriptions / referrals from
   documents with review; `get_clinician_record`; the comparison view; every «differs» as a
   question. Acceptance: a discharge-note fixture yields records each opening its fragment; the
   comparison marks agree/differs against the assistant's read of the same evidence.
4. **ИИ-нутрициолог.** Diet assessment and plan into the `nutrition` lane; interaction with
   conditions and medications from the profile flagged; supplements per decision 3.
5. **ИИ-тренер.** Activity assessment and programme into `activity` with progression and an
   adherence log; clearance handling.
6. **Outcome log and evaluation.** Confirmed / rejected / modified per item, dated, linked to
   the confirming document; the agreement view; the vignette eval harness with a first set of
   30 synthetic cases and its report.

## Open decisions (owner's call, with a recommendation)

1. **Names.** «ИИ-врач · второе мнение», «ИИ-нутрициолог», «ИИ-тренер» — honest about being
   AI, honest about the depth. *Recommendation:* these three; «Медицинский навигатор» retires.
2. **Model and effort.** A separate assistant model setting; default the strongest model at
   high effort, checker on the same model. *Recommendation:* yes; the fast document model
   stays for extraction only.
3. **Doses and supplements.** (a) never invent a dose — quote only the clinician's;
   (b) allow the nutritionist supplement doses within general reference ranges, referral
   required; (c) allow medication doses as recommendations. *Recommendation:* (a) in slice 1;
   (b) can be switched on per profile in slice 3; (c) not offered — it is where the tool stops
   being a second opinion and starts prescribing.
4. **Urgency behaviour.** Fixed copy for `urgent`/`emergency` at the top of the answer and on
   the card; no way for the model to soften it. *Recommendation:* yes, and log the tier in the
   payload-free audit as a code.
5. **What the сверка may say about a clinician.** Agree / differs / cannot assess with reasons,
   counts over time, never a score for a named doctor. *Recommendation:* exactly that.
6. **Guideline grounding.** Model memory only (labelled) now; a locally curated guideline pack
   fed as context later. *Recommendation:* start with memory + label; add the pack when the
   eval shows where the model drifts.
