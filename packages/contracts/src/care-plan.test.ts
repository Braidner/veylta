import assert from "node:assert/strict";
import test from "node:test";
import {
  CARE_PLAN_CHECKIN_CATEGORIES,
  CARE_PLAN_CHECKIN_DAYS,
  CARE_PLAN_CHECKIN_STATUSES,
  type CarePlanCheckinRequest,
  type CarePlanProposalResponse,
  type CarePlanResponse,
  HOME_CARE_PLAN_CONTRACT_VERSION,
} from "./index.js";

test("the care plan carries the person's own check-ins on the regimen lanes, one per day", () => {
  assert.equal(HOME_CARE_PLAN_CONTRACT_VERSION, "home-care-plan/v2");
  assert.deepEqual(CARE_PLAN_CHECKIN_CATEGORIES, ["activity", "nutrition"]);
  assert.deepEqual(CARE_PLAN_CHECKIN_STATUSES, ["done", "skipped"]);
  assert.equal(CARE_PLAN_CHECKIN_DAYS, 28);
  const request = { status: "done", note: null } as const satisfies CarePlanCheckinRequest;
  assert.equal(request.status, "done");
});

test("home care plan separates evidence, proposals, and accepted user actions", () => {
  const response = {
    contractVersion: HOME_CARE_PLAN_CONTRACT_VERSION,
    profileId: "00000000-0000-4000-8000-000000000001",
    canWrite: true,
    evidence: {
      sourceCount: 1,
      pendingReviewCount: 0,
      confirmedObservationCount: 1,
      latestSummary: {
        id: "00000000-0000-4000-8000-000000000002",
        version: 1,
        createdAt: "2026-08-14T00:00:00.000Z",
      },
    },
    items: [
      {
        id: "00000000-0000-4000-8000-000000000003",
        category: "nutrition",
        title: "Подготовить вопросы о питании",
        note: null,
        scheduledFor: null,
        state: "proposed",
        origin: "codex",
        revision: 1,
        provenance: {
          proposalRunId: "00000000-0000-4000-8000-000000000005",
          healthSummary: {
            id: "00000000-0000-4000-8000-000000000002",
            version: 1,
          },
          sourceObservationId: "00000000-0000-4000-8000-000000000004",
          modelId: "gpt-5.4-mini",
          runtimeVersion: "codex-cli 0.147.0",
          ruleVersion: "home-care-safe/v1",
          missingContext: ["dietary_restrictions"],
        },
        checkins: [],
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
      },
    ],
  } as const satisfies CarePlanResponse;

  assert.equal(response.items[0]?.origin, "codex");
  assert.equal(response.items[0]?.provenance?.missingContext[0], "dietary_restrictions");
});

test("Codex care-plan drafts keep immutable model provenance and require human acceptance", () => {
  const response = {
    contractVersion: "home-care-plan/v2",
    profileId: "00000000-0000-4000-8000-000000000001",
    replayed: false,
    run: {
      id: "00000000-0000-4000-8000-000000000002",
      healthSummary: { id: "00000000-0000-4000-8000-000000000003", version: 4 },
      modelId: "gpt-5.4-mini",
      runtimeVersion: "codex-cli 0.147.0",
      ruleVersion: "codex-care-plan/v1",
      proposalCount: 1,
      completedAt: "2026-08-14T10:00:00.000Z",
    },
    items: [
      {
        id: "00000000-0000-4000-8000-000000000004",
        category: "laboratory",
        title: "Обсудить повторный контроль: Синтетический аналит A",
        note: "Решение о повторе принимает врач после сверки подтверждённого источника.",
        scheduledFor: null,
        state: "proposed",
        origin: "codex",
        revision: 1,
        provenance: {
          proposalRunId: "00000000-0000-4000-8000-000000000002",
          healthSummary: { id: "00000000-0000-4000-8000-000000000003", version: 4 },
          sourceObservationId: "00000000-0000-4000-8000-000000000005",
          modelId: "gpt-5.4-mini",
          runtimeVersion: "codex-cli 0.147.0",
          ruleVersion: "codex-care-plan/v1",
          missingContext: ["sample_date"],
        },
        checkins: [],
        createdAt: "2026-08-14T10:00:00.000Z",
        updatedAt: "2026-08-14T10:00:00.000Z",
      },
    ],
  } as const satisfies CarePlanProposalResponse;

  assert.equal(response.items[0].state, "proposed");
  assert.equal(response.items[0].provenance.modelId, "gpt-5.4-mini");
});
