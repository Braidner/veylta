import assert from "node:assert/strict";
import test from "node:test";
import { FAMILY_PROFILE_CONTRACT_VERSION, type SessionResponse } from "@veylta/contracts";
import { entryRedirect, findProfileByHandle } from "./profile-route-resolution";

function session(...handles: readonly string[]): SessionResponse {
  return {
    contractVersion: FAMILY_PROFILE_CONTRACT_VERSION,
    user: { id: "u", username: "braidner", displayName: "Владелец", role: "admin" },
    families: [
      {
        id: "f1",
        displayName: "Семья",
        role: "owner",
        createdAt: "2026-08-18T00:00:00.000Z",
        profiles: handles.map((handle, index) => ({
          id: `p${index + 1}`,
          familyId: "f1",
          displayName: handle,
          handle,
          kind: "adult" as const,
          access: "owner" as const,
          createdAt: "2026-08-18T00:00:00.000Z",
        })),
      },
    ],
  };
}

const route = {
  session: null as SessionResponse | null,
  requestedHandle: undefined as string | undefined,
  requestedLogin: false,
  legacyTab: undefined as string | undefined,
};

test("a profile is found by its handle, whatever case the link was typed in", () => {
  const found = findProfileByHandle(session("braidner", "anna"), "ANNA");
  assert.equal(found?.profile.handle, "anna");
  assert.equal(found?.family.id, "f1");
  assert.equal(findProfileByHandle(session("braidner"), "anna"), undefined);
});

test("without a session every page but /login sends the person to sign in", () => {
  assert.equal(entryRedirect({ ...route, requestedHandle: "anna" }), "/login");
  assert.equal(entryRedirect(route), "/login");
  assert.equal(entryRedirect({ ...route, requestedLogin: true }), null);
});

test("with a session /login and / open the first profile; without profiles they stay", () => {
  const signedIn = session("braidner", "anna");
  assert.equal(entryRedirect({ ...route, session: signedIn, requestedLogin: true }), "/braidner");
  assert.equal(entryRedirect({ ...route, session: signedIn }), "/braidner");
  assert.equal(entryRedirect({ ...route, session: session(), requestedLogin: true }), null);
  assert.equal(entryRedirect({ ...route, session: session() }), null);
});

test("a known handle stays where it is; an unknown one is not redirected away", () => {
  const signedIn = session("braidner", "anna");
  assert.equal(entryRedirect({ ...route, session: signedIn, requestedHandle: "anna" }), null);
  assert.equal(entryRedirect({ ...route, session: signedIn, requestedHandle: "nobody" }), null);
  assert.equal(
    entryRedirect({ ...route, session: signedIn, requestedHandle: "nobody", legacyTab: "dossier" }),
    null,
  );
});

test("an old `?tab=` lands on the tab's own segment, its own name or the dossier's old one", () => {
  const signedIn = session("braidner", "anna");
  const at = (legacyTab: string) =>
    entryRedirect({ ...route, session: signedIn, requestedHandle: "anna", legacyTab });
  assert.equal(at("dossier"), "/anna/dossier");
  assert.equal(at("plan"), "/anna/dossier");
  assert.equal(at("documents"), "/anna/docs");
  assert.equal(at("history"), "/anna/history");
  assert.equal(at("overview"), null);
  assert.equal(
    entryRedirect({
      ...route,
      session: signedIn,
      requestedHandle: "anna",
      legacyTab: "history",
      legacyCanonicalCode: "tsh",
    }),
    "/anna/history?code=tsh",
  );
});
