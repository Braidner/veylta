import assert from "node:assert/strict";
import test from "node:test";
import { FAMILY_PROFILE_CONTRACT_VERSION, type SessionResponse } from "@veylta/contracts";
import { legacyDestination } from "./legacy-destination";

const profile = (id: string, handle: string, displayName: string) => ({
  id,
  familyId: "f1",
  displayName,
  handle,
  kind: "adult" as const,
  access: "owner" as const,
  createdAt: "2026-08-18T00:00:00.000Z",
});

const session: SessionResponse = {
  contractVersion: FAMILY_PROFILE_CONTRACT_VERSION,
  user: { id: "u", username: "braidner", displayName: "Владелец", role: "admin" },
  families: [
    {
      id: "f1",
      displayName: "Семья",
      role: "owner",
      createdAt: "2026-08-18T00:00:00.000Z",
      profiles: [profile("p1", "braidner", "Владелец"), profile("p2", "anna", "Анна")],
    },
  ],
};

test("old links land on the same person and surface", () => {
  assert.equal(legacyDestination(session, { familyId: "f1", profileId: "p2" }), "/anna");
  assert.equal(
    legacyDestination(session, { familyId: "f1", profileId: "p2", tab: "dossier" }),
    "/anna/dossier",
  );
  assert.equal(
    legacyDestination(session, {
      familyId: "f1",
      profileId: "p2",
      tab: "history",
      canonicalCode: "tsh",
    }),
    "/anna/history?code=tsh",
  );
  assert.equal(
    legacyDestination(session, { familyId: "f1", profileId: "p1", documentId: "d1" }),
    "/braidner/docs/d1",
  );
  assert.equal(
    legacyDestination(session, {
      familyId: "f1",
      profileId: "p1",
      assistantId: "physician",
      ask: "consilium",
    }),
    "/braidner/assistants/physician?ask=consilium",
  );
  assert.equal(
    legacyDestination(session, {
      profileId: "p2",
      assistantId: "trainer",
      conversationId: "c1",
    }),
    "/anna/assistants/trainer?conversationId=c1",
  );
  assert.equal(legacyDestination(session, { settings: "app" }), "/braidner/settings/app");
  assert.equal(legacyDestination(session, { profileId: "p2", settings: "user" }), "/anna/settings");
  assert.equal(legacyDestination(session, { familyId: "f1", profileId: "nope" }), null);
});
