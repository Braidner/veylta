import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  medicalProfilePath,
  register,
  startMedicalProfileApp,
  webOrigin,
} from "./medical-profile-app.js";

test("the medical profile is user-authored, revisioned and singleton-safe", async () => {
  const { app, database, close } = await startMedicalProfileApp();
  try {
    const owner = await register(app, "Profile owner");
    const path = medicalProfilePath(owner);

    const empty = await app.inject({ method: "GET", url: path, headers: { cookie: owner.cookie } });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.equal(empty.headers["cache-control"], "no-store");
    assert.deepEqual(empty.json(), {
      contractVersion: "medical-profile/v2",
      profileId: owner.body.profile.id,
      canWrite: true,
      entries: [],
      measurements: { heightCm: [], weightKg: [] },
      interpretationReady: false,
    });

    // Create is idempotent on the client-chosen id; the same id with a different body is a conflict.
    const sexId = randomUUID();
    const createSex = () =>
      app.inject({
        method: "PUT",
        url: `${path}/entries/${sexId}`,
        headers: { cookie: owner.cookie, origin: webOrigin },
        payload: { kind: "sex", value: "female", recordedOn: null },
      });
    const created = await createSex();
    assert.equal(created.statusCode, 201, created.body);
    assert.equal((await createSex()).statusCode, 200);
    const conflicting = await app.inject({
      method: "PUT",
      url: `${path}/entries/${sexId}`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { kind: "sex", value: "male", recordedOn: null },
    });
    assert.equal(conflicting.statusCode, 409);

    // A second active singleton of the same kind is refused; closed values are validated.
    const secondSex = await app.inject({
      method: "PUT",
      url: `${path}/entries/${randomUUID()}`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { kind: "sex", value: "male", recordedOn: null },
    });
    assert.equal(secondSex.statusCode, 409, secondSex.body);
    const badSex = await app.inject({
      method: "PUT",
      url: `${path}/entries/${randomUUID()}`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { kind: "sex", value: "unknown", recordedOn: null },
    });
    assert.equal(badSex.statusCode, 422);
    const badYear = await app.inject({
      method: "PUT",
      url: `${path}/entries/${randomUUID()}`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { kind: "birth_year", value: "1850", recordedOn: null },
    });
    assert.equal(badYear.statusCode, 422);

    const yearId = randomUUID();
    const year = await app.inject({
      method: "PUT",
      url: `${path}/entries/${yearId}`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { kind: "birth_year", value: "1992", recordedOn: null },
    });
    assert.equal(year.statusCode, 201, year.body);
    const medicationId = randomUUID();
    const medication = await app.inject({
      method: "PUT",
      url: `${path}/entries/${medicationId}`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: {
        kind: "medication",
        value: "Синтетический препарат A, 1 таблетка утром",
        recordedOn: "2026-08-01",
      },
    });
    assert.equal(medication.statusCode, 201, medication.body);

    // Entries recorded within one millisecond still list in the order they were recorded.
    await database.transaction(async (client) => {
      for (const [kind, value] of [
        ["symptom", "Синтетическая жалоба"],
        ["goal", "Синтетическая цель"],
      ]) {
        await client.query(
          `INSERT INTO medical_profile_entries
             (id, family_id, patient_profile_id, kind, value, recorded_on, created_by_user_id,
              created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NULL, $6, '2026-08-17T00:00:00.000Z',
                   '2026-08-17T00:00:00.000Z')`,
          [randomUUID(), owner.body.family.id, owner.body.profile.id, kind, value, owner.userId],
        );
      }
    });

    // Sex and birth year make the profile ready for interpretation.
    const ready = await app.inject({ method: "GET", url: path, headers: { cookie: owner.cookie } });
    assert.equal(ready.json().interpretationReady, true);
    assert.deepEqual(
      ready.json().entries.map((entry: { kind: string }) => entry.kind),
      ["symptom", "goal", "sex", "birth_year", "medication"],
    );

    // Update is optimistic on the revision.
    const staleUpdate = await app.inject({
      method: "PUT",
      url: `${path}/entries/${medicationId}/value`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { revision: 7, value: "Синтетический препарат A, 2 таблетки", recordedOn: null },
    });
    assert.equal(staleUpdate.statusCode, 409);
    const updated = await app.inject({
      method: "PUT",
      url: `${path}/entries/${medicationId}/value`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { revision: 1, value: "Синтетический препарат A, 2 таблетки", recordedOn: null },
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().entry.revision, 2);
    assert.equal(updated.json().entry.recordedOn, null);

    // Archiving hides the entry, keeps the row, and frees the singleton slot.
    const archived = await app.inject({
      method: "PUT",
      url: `${path}/entries/${sexId}/archive`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { revision: 1 },
    });
    assert.equal(archived.statusCode, 200, archived.body);
    const afterArchive = await app.inject({
      method: "GET",
      url: path,
      headers: { cookie: owner.cookie },
    });
    assert.equal(afterArchive.json().interpretationReady, false);
    assert.equal(afterArchive.json().entries.length, 4);
    const newSex = await app.inject({
      method: "PUT",
      url: `${path}/entries/${randomUUID()}`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { kind: "sex", value: "male", recordedOn: null },
    });
    assert.equal(newSex.statusCode, 201, newSex.body);
    const rows = await database.query<{ count: number }>(
      "SELECT count(*) AS count FROM medical_profile_entries WHERE archived_at IS NOT NULL",
    );
    assert.equal(rows.rows[0]?.count, 1);

    // Height and weight are read over time: an archived measurement stays in the series in the
    // order it was recorded, while `entries` keeps only the active one.
    const firstWeightId = randomUUID();
    for (const [id, value, recordedOn] of [
      [firstWeightId, "80", "2026-06-01"],
      [randomUUID(), "178", "2026-05-20"],
    ] as const) {
      const measurement = await app.inject({
        method: "PUT",
        url: `${path}/entries/${id}`,
        headers: { cookie: owner.cookie, origin: webOrigin },
        payload: { kind: id === firstWeightId ? "weight_kg" : "height_cm", value, recordedOn },
      });
      assert.equal(measurement.statusCode, 201, measurement.body);
    }
    const weightArchived = await app.inject({
      method: "PUT",
      url: `${path}/entries/${firstWeightId}/archive`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { revision: 1 },
    });
    assert.equal(weightArchived.statusCode, 200, weightArchived.body);
    const secondWeight = await app.inject({
      method: "PUT",
      url: `${path}/entries/${randomUUID()}`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { kind: "weight_kg", value: "82,5", recordedOn: "2026-07-01" },
    });
    assert.equal(secondWeight.statusCode, 201, secondWeight.body);
    const measured = await app.inject({
      method: "GET",
      url: path,
      headers: { cookie: owner.cookie },
    });
    const body = measured.json();
    assert.deepEqual(
      body.measurements.weightKg.map((point: { value: string; recordedOn: string | null }) => [
        point.value,
        point.recordedOn,
      ]),
      [
        ["80", "2026-06-01"],
        ["82.5", "2026-07-01"],
      ],
    );
    assert.deepEqual(
      body.measurements.heightCm.map((point: { value: string }) => point.value),
      ["178"],
    );
    assert.equal(
      body.entries.filter((entry: { kind: string }) => entry.kind === "weight_kg").length,
      1,
    );
    assert.match(body.measurements.weightKg[0].at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await close();
  }
});
