import assert from "node:assert/strict";
import test from "node:test";
import {
  FAMILY_PROFILE_CONTRACT_VERSION,
  isValidProfileHandle,
  type PatientProfileSummary,
  PROFILE_HANDLE_PATTERN,
  RESERVED_PROFILE_HANDLES,
} from "./index.js";

test("a handle is short lower-case latin with hyphens inside, never a reserved route word", () => {
  assert.equal(FAMILY_PROFILE_CONTRACT_VERSION, "family-profile/v3");
  for (const good of ["anna", "braidner", "anna-2", "p-0123456789ab", "a1b"]) {
    assert.equal(isValidProfileHandle(good), true, good);
  }
  for (const bad of ["an", "Anna", "anna_", "-anna", "anna-", "анна", "a".repeat(31), "a b", ""]) {
    assert.equal(isValidProfileHandle(bad), false, bad);
  }
  for (const reserved of RESERVED_PROFILE_HANDLES) {
    assert.equal(isValidProfileHandle(reserved), false, reserved);
  }
  assert.ok(RESERVED_PROFILE_HANDLES.includes("login"));
  assert.ok(RESERVED_PROFILE_HANDLES.includes("docs"));
  assert.ok(RESERVED_PROFILE_HANDLES.includes("health-api"));
  assert.equal(PROFILE_HANDLE_PATTERN.test("a-b"), true);
});

test("a profile summary names its handle", () => {
  const profile = {
    id: "00000000-0000-4000-8000-000000000001",
    familyId: "00000000-0000-4000-8000-000000000002",
    displayName: "Анна",
    kind: "adult",
    access: "owner",
    handle: "anna",
    createdAt: "2026-08-18T00:00:00.000Z",
  } as const satisfies PatientProfileSummary;
  assert.equal(profile.handle, "anna");
});
