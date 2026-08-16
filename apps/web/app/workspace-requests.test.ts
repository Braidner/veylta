import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceRequests } from "./workspace-requests.js";

test("only the newest read may write; an earlier read is stale once a mutation starts", () => {
  const requests = new WorkspaceRequests();
  const mountLoad = requests.claim();
  const refresh = requests.claim();
  assert.equal(mountLoad(), false);
  assert.equal(refresh(), true);

  const create = requests.beginMutation();
  assert.equal(refresh(), false);
  assert.equal(create(), true);
});

test("a background refresh during a mutation is deferred and reported when the mutation settles", () => {
  const requests = new WorkspaceRequests();
  assert.equal(requests.requestRefresh(), true);

  const create = requests.beginMutation();
  assert.equal(requests.requestRefresh(), false);
  assert.equal(create(), true, "a deferred refresh claims no ticket over the mutation");
  assert.deepEqual(requests.endMutation(), { refreshDeferred: true });
  assert.deepEqual(requests.endMutation(), { refreshDeferred: false });
  assert.equal(requests.requestRefresh(), true);
});

test("a user's own selection during a mutation is a newer intent and wins", () => {
  const requests = new WorkspaceRequests();
  const send = requests.beginMutation();
  const selection = requests.claim();
  assert.equal(send(), false);
  assert.equal(selection(), true);
  requests.endMutation();
});
