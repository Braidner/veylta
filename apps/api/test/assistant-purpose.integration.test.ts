import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { assistantPath, startAssistantApp } from "./assistant-app.js";
import { register, webOrigin } from "./medical-profile-app.js";

test("a conversation with a purpose — the dossier's «Досье · Кардиолог» — is found before it is created", async () => {
  const { app, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Purpose owner");
    const path = assistantPath(owner);
    const mutation = (key: string) => ({
      cookie: owner.cookie,
      origin: webOrigin,
      "idempotency-key": key,
    });
    const created = await app.inject({
      method: "POST",
      url: `${path}/conversations`,
      headers: mutation(`create-${randomUUID()}`),
      payload: { title: "Мои анализы" },
    });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json().selectedConversationId as string;
    assert.equal(created.json().conversations[0].purpose, null);

    // A conversation with a purpose (the dossier's «Досье · Кардиолог») is found before it is
    // created: a second request with the same purpose returns the same conversation, whatever
    // its title and key; the purpose is a closed value.
    const purposeful = await app.inject({
      method: "POST",
      url: `${path}/conversations`,
      headers: mutation(`create-${randomUUID()}`),
      payload: { title: "Досье · Кардиолог", purpose: "dossier:cardiologist" },
    });
    assert.equal(purposeful.statusCode, 201, purposeful.body);
    const dossierConversationId = purposeful.json().selectedConversationId as string;
    assert.notEqual(dossierConversationId, conversationId);
    const purposeSummary = purposeful
      .json()
      .conversations.find((item: { id: string }) => item.id === dossierConversationId);
    assert.equal(purposeSummary.purpose, "dossier:cardiologist");
    const found = await app.inject({
      method: "POST",
      url: `${path}/conversations`,
      headers: mutation(`create-${randomUUID()}`),
      payload: { title: "Другое название", purpose: "dossier:cardiologist" },
    });
    assert.equal(found.statusCode, 200, found.body);
    assert.equal(found.json().selectedConversationId, dossierConversationId);
    assert.equal(found.json().conversations.length, 2);
    const badPurpose = await app.inject({
      method: "POST",
      url: `${path}/conversations`,
      headers: mutation(`create-${randomUUID()}`),
      payload: { title: "Досье · Кто-то", purpose: "dossier:astrologer" },
    });
    assert.equal(badPurpose.statusCode, 400, badPurpose.body);
  } finally {
    await close();
  }
});
