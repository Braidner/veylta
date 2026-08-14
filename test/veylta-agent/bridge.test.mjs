import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createLocalAgentBridge,
  createVaultCommandStore,
} from "../../skills/veylta-agent/scripts/bridge-lib.mjs";

const vaultId = "10000000-0000-4000-8000-000000000001";

async function makeVault() {
  const root = await mkdtemp(join(tmpdir(), "veylta-bridge-test-"));
  const vaultPath = join(root, "vault");
  const stateDirectory = join(root, "state");
  await mkdir(join(vaultPath, "agent", "commands", "queued"), { recursive: true });
  await mkdir(join(vaultPath, "agent", "commands", "leased"), { recursive: true });
  await mkdir(join(vaultPath, "agent", "commands", "completed"), { recursive: true });
  await mkdir(join(vaultPath, "agent", "commands", "failed"), { recursive: true });
  await writeFile(
    join(vaultPath, "vault.json"),
    `${JSON.stringify({
      contractVersion: "veylta-vault/v1",
      vaultId,
      createdAt: "2026-08-13T12:00:00.000Z",
    })}\n`,
  );
  return { root, vaultPath, stateDirectory };
}

function scanCommand(id = "10000000-0000-4000-8000-000000000010") {
  return {
    protocolVersion: "veylta-agent/v1",
    id,
    type: "scan_unprocessed",
    vaultId,
    requestedAt: "2026-08-13T12:01:00.000Z",
  };
}

function authorization(token) {
  return { Authorization: `Bearer ${token}` };
}

test("persists a command and lets only one concurrent worker lease it", async (t) => {
  const { vaultPath, stateDirectory } = await makeVault();
  const store = await createVaultCommandStore({ vaultPath });
  await store.enqueue(scanCommand());

  const bridge = await createLocalAgentBridge({
    vaultPath,
    stateDirectory,
    leaseDurationMs: 5_000,
  });
  t.after(() => bridge.close());

  const claimUrl = `${bridge.baseUrl}/v1/commands/claim?waitMs=0`;
  const [first, second] = await Promise.all([
    fetch(`${claimUrl}&workerId=worker-a`, { headers: authorization(bridge.token) }),
    fetch(`${claimUrl}&workerId=worker-b`, { headers: authorization(bridge.token) }),
  ]);

  assert.deepEqual([first.status, second.status].sort(), [200, 204]);
  const claimedResponse = first.status === 200 ? first : second;
  const claimed = await claimedResponse.json();
  assert.equal(claimed.command.id, scanCommand().id);
  assert.equal(claimed.attempt, 1);
  assert.match(claimed.leaseToken, /^[a-f0-9]{64}$/);

  const leased = JSON.parse(
    await readFile(
      join(vaultPath, "agent", "commands", "leased", `${scanCommand().id}.json`),
      "utf8",
    ),
  );
  assert.equal(leased.state, "leased");
  assert.equal(leased.attemptCount, 1);
});

test("rejects invalid commands, traversal-shaped ids, and credentials stored inside the vault", async () => {
  const { vaultPath } = await makeVault();
  const store = await createVaultCommandStore({ vaultPath });

  await assert.rejects(
    () => store.enqueue({ ...scanCommand(), type: "read_arbitrary_file" }),
    /invalid agent command/i,
  );
  await assert.rejects(
    () => store.enqueue({ ...scanCommand(), id: "../../outside" }),
    /invalid agent command/i,
  );
  await assert.rejects(
    () =>
      createLocalAgentBridge({
        vaultPath,
        stateDirectory: join(vaultPath, "agent", "private-state"),
      }),
    /outside the vault/i,
  );
  await assert.rejects(
    () => stat(join(vaultPath, "agent", "private-state")),
    (error) => error?.code === "ENOENT",
  );
});

test("requires its random bearer token and rejects browser-origin requests", async (t) => {
  const { vaultPath, stateDirectory } = await makeVault();
  const bridge = await createLocalAgentBridge({ vaultPath, stateDirectory });
  t.after(() => bridge.close());

  const statusUrl = `${bridge.baseUrl}/v1/status`;
  assert.equal((await fetch(statusUrl)).status, 401);
  assert.equal(
    (
      await fetch(statusUrl, {
        headers: { ...authorization(bridge.token), Origin: "https://attacker.example" },
      })
    ).status,
    403,
  );

  const authorized = await fetch(statusUrl, { headers: authorization(bridge.token) });
  assert.equal(authorized.status, 200);
  assert.deepEqual(await authorized.json(), {
    protocolVersion: "veylta-agent/v1",
    vaultId,
    queue: { queued: 0, leased: 0, completed: 0, failed: 0 },
  });

  const state = JSON.parse(await readFile(join(stateDirectory, "bridge.json"), "utf8"));
  assert.equal(state.token, bridge.token);
  assert.equal(state.baseUrl, bridge.baseUrl);
  assert.equal(
    (await readFile(join(vaultPath, "vault.json"), "utf8")).includes(bridge.token),
    false,
  );
});

test("requeues an expired lease and rejects completion with a stale lease token", async (t) => {
  const { vaultPath, stateDirectory } = await makeVault();
  let currentTime = new Date("2026-08-13T12:02:00.000Z");
  const store = await createVaultCommandStore({ vaultPath, now: () => currentTime });
  await store.enqueue(scanCommand());
  const bridge = await createLocalAgentBridge({
    vaultPath,
    stateDirectory,
    leaseDurationMs: 1_000,
    now: () => currentTime,
  });
  t.after(() => bridge.close());

  const firstResponse = await fetch(
    `${bridge.baseUrl}/v1/commands/claim?workerId=worker-a&waitMs=0`,
    { headers: authorization(bridge.token) },
  );
  const first = await firstResponse.json();
  currentTime = new Date("2026-08-13T12:02:02.000Z");

  const secondResponse = await fetch(
    `${bridge.baseUrl}/v1/commands/claim?workerId=worker-b&waitMs=0`,
    { headers: authorization(bridge.token) },
  );
  const second = await secondResponse.json();
  assert.equal(second.command.id, first.command.id);
  assert.equal(second.attempt, 2);
  assert.notEqual(second.leaseToken, first.leaseToken);

  const staleCompletion = await fetch(
    `${bridge.baseUrl}/v1/commands/${scanCommand().id}/complete`,
    {
      method: "POST",
      headers: { ...authorization(bridge.token), "Content-Type": "application/json" },
      body: JSON.stringify({
        workerId: "worker-a",
        leaseToken: first.leaseToken,
        outcome: "completed",
      }),
    },
  );
  assert.equal(staleCompletion.status, 409);

  const completion = await fetch(`${bridge.baseUrl}/v1/commands/${scanCommand().id}/complete`, {
    method: "POST",
    headers: { ...authorization(bridge.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      workerId: "worker-b",
      leaseToken: second.leaseToken,
      outcome: "completed",
    }),
  });
  assert.equal(completion.status, 200);
  assert.equal(
    JSON.parse(
      await readFile(
        join(vaultPath, "agent", "commands", "completed", `${scanCommand().id}.json`),
        "utf8",
      ),
    ).state,
    "completed",
  );
});

test("binds analyze commands to a canonical document id and immutable checksum", async () => {
  const { vaultPath } = await makeVault();
  const store = await createVaultCommandStore({ vaultPath });

  await assert.rejects(
    () =>
      store.enqueue({
        ...scanCommand(),
        type: "analyze_document",
        profileId: "10000000-0000-4000-8000-000000000020",
        documentId: "10000000-0000-4000-8000-000000000021",
        sourceSha256: "not-a-checksum",
      }),
    /invalid agent command/i,
  );

  await store.enqueue({
    ...scanCommand("10000000-0000-4000-8000-000000000022"),
    type: "analyze_document",
    profileId: "10000000-0000-4000-8000-000000000020",
    documentId: "10000000-0000-4000-8000-000000000021",
    sourceSha256: "a".repeat(64),
  });
});

test("treats a durable terminal record as final after a crash before lease cleanup", async () => {
  const { vaultPath } = await makeVault();
  const command = scanCommand();
  const terminal = {
    protocolVersion: "veylta-agent/v1",
    state: "completed",
    command,
    attemptCount: 1,
    queuedAt: "2026-08-13T12:01:00.000Z",
    completedAt: "2026-08-13T12:02:00.000Z",
  };
  const staleLease = {
    protocolVersion: "veylta-agent/v1",
    state: "leased",
    command,
    attemptCount: 1,
    queuedAt: "2026-08-13T12:01:00.000Z",
    workerId: "worker-before-crash",
    leaseTokenHash: "b".repeat(64),
    leasedAt: "2026-08-13T12:01:01.000Z",
    leaseExpiresAt: "2026-08-13T12:01:02.000Z",
  };
  await writeFile(
    join(vaultPath, "agent", "commands", "completed", `${command.id}.json`),
    JSON.stringify(terminal),
  );
  await writeFile(
    join(vaultPath, "agent", "commands", "leased", `${command.id}.json`),
    JSON.stringify(staleLease),
  );

  const store = await createVaultCommandStore({
    vaultPath,
    now: () => new Date("2026-08-13T12:05:00.000Z"),
  });
  assert.equal(await store.claim("worker-after-crash", 1_000), null);
  assert.deepEqual(await store.counts(), { queued: 0, leased: 0, completed: 1, failed: 0 });
});

test("rejects a queue symlink that escapes the selected vault", async () => {
  const { root, vaultPath } = await makeVault();
  const queuedPath = join(vaultPath, "agent", "commands", "queued");
  const outsidePath = join(root, "outside");
  await mkdir(outsidePath);
  await rm(queuedPath, { recursive: true });
  await symlink(outsidePath, queuedPath, "dir");

  await assert.rejects(
    () => createVaultCommandStore({ vaultPath }),
    /vault agent layout is unsafe/i,
  );
});

test("rejects a queue file whose name and immutable command id disagree", async () => {
  const { vaultPath } = await makeVault();
  const command = scanCommand("10000000-0000-4000-8000-000000000030");
  await writeFile(
    join(vaultPath, "agent", "commands", "queued", "10000000-0000-4000-8000-000000000031.json"),
    JSON.stringify({
      protocolVersion: "veylta-agent/v1",
      state: "queued",
      command,
      attemptCount: 0,
      queuedAt: "2026-08-13T12:01:00.000Z",
    }),
  );

  const store = await createVaultCommandStore({ vaultPath });
  await assert.rejects(() => store.claim("worker-a", 1_000), /queue record is invalid/i);
});
