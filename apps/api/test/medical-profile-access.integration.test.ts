import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  medicalProfilePath,
  register,
  startMedicalProfileApp,
  webOrigin,
} from "./medical-profile-app.js";

test("the medical profile is profile-authorized and its audit rows are payload-free", async () => {
  const { app, database, close } = await startMedicalProfileApp();
  try {
    const owner = await register(app, "Access owner");
    const reader = await register(app, "Access reader");
    const outsider = await register(app, "Access outsider");
    const path = medicalProfilePath(owner);
    const seeded = await app.inject({
      method: "PUT",
      url: `${path}/entries/${randomUUID()}`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { kind: "medication", value: "Синтетический препарат A", recordedOn: null },
    });
    assert.equal(seeded.statusCode, 201, seeded.body);

    // A granted reader may read but not write; an outsider sees nothing at all.
    await database.transaction(async (client) => {
      await client.query(
        `INSERT INTO family_memberships (family_id, user_id, role, status, created_at)
         VALUES ($1, $2, 'caregiver', 'active', $3)`,
        [owner.body.family.id, reader.userId, new Date()],
      );
      await client.query(
        `INSERT INTO profile_consent_grants
           (id, family_id, patient_profile_id, grantee_user_id, capability, granted_by_user_id, created_at)
         VALUES ($1, $2, $3, $4, 'profile.read', $5, $6)`,
        [
          randomUUID(),
          owner.body.family.id,
          owner.body.profile.id,
          reader.userId,
          owner.userId,
          new Date(),
        ],
      );
    });
    const readerView = await app.inject({
      method: "GET",
      url: path,
      headers: { cookie: reader.cookie },
    });
    assert.equal(readerView.statusCode, 200);
    assert.equal(readerView.json().canWrite, false);
    const readerWrite = await app.inject({
      method: "PUT",
      url: `${path}/entries/${randomUUID()}`,
      headers: { cookie: reader.cookie, origin: webOrigin },
      payload: { kind: "note", value: "не должно сохраниться", recordedOn: null },
    });
    assert.equal(readerWrite.statusCode, 404);
    const outsiderView = await app.inject({
      method: "GET",
      url: path,
      headers: { cookie: outsider.cookie },
    });
    assert.equal(outsiderView.statusCode, 404);

    // Audit rows carry actions and selectors only.
    const audit = await database.query<{ action: string; metadata: string | null }>(
      "SELECT action, metadata FROM audit_events WHERE action LIKE 'profile.medical_profile.%' ORDER BY created_at",
    );
    assert.ok(audit.rows.some((row) => row.action === "profile.medical_profile.entry_created"));
    for (const row of audit.rows) {
      assert.doesNotMatch(row.metadata ?? "", /препарат|female|1992/);
    }
  } finally {
    await close();
  }
});
