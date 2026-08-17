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
      contractVersion: "medical-profile/v1",
      profileId: owner.body.profile.id,
      canWrite: true,
      entries: [],
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

    // Sex and birth year make the profile ready for interpretation.
    const ready = await app.inject({ method: "GET", url: path, headers: { cookie: owner.cookie } });
    assert.equal(ready.json().interpretationReady, true);
    assert.deepEqual(
      ready
        .json()
        .entries.map((entry: { kind: string; value: string }) => [entry.kind, entry.value]),
      [
        ["sex", "female"],
        ["birth_year", "1992"],
        ["medication", "Синтетический препарат A, 1 таблетка утром"],
      ],
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
    assert.equal(afterArchive.json().entries.length, 2);
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
  } finally {
    await close();
  }
});
