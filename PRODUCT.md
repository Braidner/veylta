# Product

## Register

product

## Platform

web

## Users

The primary user is the administrator of a household Veylta server who keeps health documents for themselves and family members. Local users sign in to their own account and open a profile only when they own it, administer the installation, or hold an explicit grant. Dependent profiles have no independent sign-in.

Users may be reviewing unfamiliar medical language while worried or short on time. The interface must always make the active family member, the status of unconfirmed data, and the path back to the source document obvious.

## Product Purpose

Veylta is a home health-care PWA backed by SQLite and immutable source documents. It helps a household upload a result, review uncertain extraction, confirm facts, and understand what is known, missing, or due without presenting itself as a clinician or an electronic health record. The profile landing page turns those existing states into a small inbox of assistants and factual health signals so the next safe action is visible immediately.

Success means a user can verify every displayed medical value against a specific page and fragment of the source, distinguish evidence from safe suggestions, correct uncertain extraction without destroying the raw value, and control who may open each profile.

## Positioning

Every health value remains understandable in context and independently traceable to the family's own source document.

## Brand Personality

Calm, exact, and humane. The product should lower cognitive load without softening uncertainty, use plain language without becoming patronizing, and communicate urgency only when evidence supports it.

## Anti-references

- Opaque or gamified health scores.
- Black-box AI answers without dates, confidence, or provenance.
- Alarmist red states and false urgency for routine review work.
- Clinic billing, scheduling, or EHR administration patterns imposed on a family tool.
- Decorative wellness imagery that competes with the user's actual documents and measurements.
- Generic server-admin dashboards that make the household member secondary.

## Design Principles

1. Source before interpretation: a value, explanation, or recommendation always has a visible path to evidence.
2. Uncertainty is a first-class state: low-confidence extraction requires an explicit human decision.
3. The active person is never implicit: every screen makes the selected family profile clear.
4. Progressive disclosure: lead with the next useful action, then reveal raw, technical, and provenance details.
5. Familiar controls, careful language: interaction should disappear into the task while medical meaning stays precise.
6. Home-server clarity: account, storage, Codex runtime, and access settings must expose their actual local state without revealing secrets.

## Assistant Surfaces

- `ИИ-врач · второе мнение` is a real second opinion over the person's confirmed values and their own medical profile (docs/assistants.md). It answers only in typed, evidence-bound blocks — interpretation, hypothesis, treatment option, question for the visit, general knowledge, missing data — under a mandatory urgency tier rendered as fixed copy. Every hypothesis and treatment option names the specialty that must confirm it; a medication is never proposed with a dose; a second, independent run refutes each answer before it is shown; an answer that fails verification is refused with a closed reason. It is a recommendation for a conversation with a clinician, never a diagnosis or a prescription, and it interprets nothing until sex and birth year are recorded.
- The evidence that leaves the machine is disclosed verbatim in the egress notice and confirmed per conversation before the first message: confirmed observations with printed ranges, the medical profile, the care plan. Never a document, page or file. The raw exchange and the checker's verdict are journaled for the owner, like a run journal; nothing of it reaches logs, metrics or audit.
- «Собрать консилиум» convenes specialist personas the evidence itself names (a table from analyte codes to specialties, shown to the person as «в данных: ТТГ»), plus any the person adds; each persona reads the same evidence independently and is verified and refuted like the therapist; the therapist's synthesis takes the highest urgency, keeps every referral and names where the specialists agree and differ. Every opinion is shown beside the synthesis, so a disagreement is never averaged away; a chip lets the person ask one persona directly inside the same conversation. Nothing beyond the disclosed evidence leaves the machine for a консилиум.
- `ИИ-нутрициолог` and `ИИ-тренер` lead to the existing care plan today (Codex may prepare a bounded draft only after the user explicitly requests it and accepts the disclosed egress boundary) and become assistants of the same kind in later slices.
- No assistant sends unsolicited medical advice or silently changes the care plan. Accepting a referral or a proposal is a human action that creates one `clinician`/lane item; every proposal remains a draft until then.
- Veylta itself — rules, summaries, dashboards, comparisons — never produces a health score, diagnosis, triage, risk, trend or treatment advice. `Сигналы здоровья` reports only counts and explicit source flags: pending review, source-marked range flags, recent sources, and confirmed values.

## Accessibility & Inclusion

Target WCAG 2.2 AA as an engineering baseline, without claiming conformance before an audit. All core actions must work with a keyboard and screen reader, status must never rely on color alone, text and controls must retain strong contrast, touch targets must remain usable on mobile web, and reduced-motion preferences must be honored.
