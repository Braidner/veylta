import assert from "node:assert/strict";
import test from "node:test";
import {
  ageFromBirthYear,
  bodyMassIndex,
  identityChips,
  identityLine,
  measurementSeries,
  passportOf,
} from "./dossier-passport";

test("the passport reads the singletons and lists conditions, medications and allergies", () => {
  const passport = passportOf(
    [
      { kind: "sex", value: "female" },
      { kind: "birth_year", value: "1992" },
      { kind: "height_cm", value: "172" },
      { kind: "weight_kg", value: "64,5" },
      { kind: "condition", value: "Гипотиреоз" },
      { kind: "medication", value: "Левотироксин 50 мкг" },
      { kind: "allergy", value: "Пенициллин" },
      { kind: "note", value: "Заметка" },
    ],
    new Date("2026-08-17T00:00:00.000Z"),
  );
  assert.equal(passport.sex, "female");
  assert.equal(passport.age, 34);
  assert.equal(passport.heightCm, 172);
  assert.equal(passport.weightKg, 64.5);
  assert.equal(passport.bmi, 21.8);
  assert.deepEqual(passport.conditions, ["Гипотиреоз"]);
  assert.deepEqual(passport.medications, ["Левотироксин 50 мкг"]);
  assert.deepEqual(passport.allergies, ["Пенициллин"]);
  assert.equal(passport.ready, true);
  assert.equal(ageFromBirthYear(1992, new Date("2026-01-01")), 34);
  assert.equal(bodyMassIndex(172, 64.5), 21.8);
  assert.equal(bodyMassIndex(null, 64.5), null);
  assert.equal(passportOf([], new Date()).ready, false);
});

test("the identity line and chips agree the age with its noun and skip what is not recorded", () => {
  const now = new Date("2026-08-17T00:00:00.000Z");
  const full = passportOf(
    [
      { kind: "sex", value: "female" },
      { kind: "birth_year", value: "1992" },
      { kind: "height_cm", value: "172" },
      { kind: "weight_kg", value: "64,5" },
      { kind: "pregnancy", value: "pregnant" },
    ],
    now,
  );
  assert.equal(identityLine(full), "Женщина · 34 года · беременность");
  assert.deepEqual(identityChips(full), [
    "Женщина · 34 года · беременность",
    "Рост 172 см",
    "Вес 64,5 кг",
  ]);
  assert.equal(
    identityLine(
      passportOf(
        [
          { kind: "sex", value: "male" },
          { kind: "birth_year", value: "1985" },
        ],
        now,
      ),
    ),
    "Мужчина · 41 год",
  );
  assert.equal(identityLine(passportOf([{ kind: "birth_year", value: "2001" }], now)), "25 лет");
  assert.equal(identityLine(passportOf([], now)), "пол и возраст не указаны");
  // Chips never show a half-recorded identity: height alone is still a fact worth a chip.
  assert.deepEqual(identityChips(passportOf([{ kind: "height_cm", value: "180" }], now)), [
    "Рост 180 см",
  ]);
});

test("a measurement series keeps the person's own numbers, the change since last time and its age", () => {
  const now = new Date("2026-08-17T10:00:00.000Z");
  const weight = measurementSeries(
    [
      { value: "80", recordedOn: "2026-05-01", at: "2026-05-01T09:00:00.000Z" },
      { value: "82,5", recordedOn: null, at: "2026-06-10T09:00:00.000Z" },
      { value: "81.9", recordedOn: "2026-07-20", at: "2026-07-21T09:00:00.000Z" },
    ],
    now,
  );
  assert.deepEqual(
    weight.points.map((point) => [point.value, point.on]),
    [
      [80, "2026-05-01"],
      [82.5, "2026-06-10"],
      [81.9, "2026-07-20"],
    ],
  );
  assert.equal(weight.latest?.printed, "81,9");
  assert.deepEqual(weight.delta, { value: "−0,6", direction: "decreased" });
  assert.equal(weight.ageDays, 28);
  assert.equal(weight.stale, false);

  // Older than a month → time to update; nothing recorded → also a prompt, with no age.
  const old = measurementSeries(
    [{ value: "178", recordedOn: "2026-05-20", at: "2026-05-20T09:00:00.000Z" }],
    now,
  );
  assert.equal(old.ageDays, 89);
  assert.equal(old.stale, true);
  assert.equal(old.delta, null);
  const none = measurementSeries([], now);
  assert.equal(none.latest, null);
  assert.equal(none.ageDays, null);
  assert.equal(none.stale, true);
});
