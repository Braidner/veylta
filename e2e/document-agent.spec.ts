import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { uploadSyntheticDocument } from "./support/document-upload";
import { createSyntheticFamily } from "./support/synthetic-family";

const fixture = await readFile(
  new URL("../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url),
);

type AgentMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  createdAt: string;
  provenance: { provider: "codex"; modelId: string; runtimeVersion: string } | null;
};

type Conversation = {
  id: string;
  title: string;
  messages: AgentMessage[];
  createdAt: string;
  updatedAt: string;
};

test("a document keeps separate Russian Codex conversations and shows ephemeral runs", async ({
  page,
}) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const conversations: Conversation[] = [];
  const idempotencyKeys: string[] = [];

  await page.route(
    /\/health-api\/.*\/documents\/[^/]+\/agent(?:\/[^?]*)?(?:\?.*)?$/,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const documentId = url.pathname.match(/\/documents\/([^/]+)\/agent/)?.[1] ?? "document";

      const response = (selectedConversationId: string | null) => {
        const selected =
          conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;
        return {
          contractVersion: "document-agent/v2",
          documentId,
          selectedConversationId: selected?.id ?? null,
          conversations: conversations.map((conversation) => ({
            id: conversation.id,
            title: conversation.title,
            messageCount: conversation.messages.length,
            lastMessagePreview: conversation.messages.at(-1)?.text ?? null,
            lastMessageAt: conversation.messages.at(-1)?.createdAt ?? null,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
          })),
          messages: selected?.messages ?? [],
          runs: [
            {
              id: "run-1",
              title: "Первичный анализ",
              state: "completed",
              attemptCount: 1,
              createdAt: "2026-08-14T15:59:42.000Z",
              completedAt: "2026-08-14T16:00:00.000Z",
              ephemeral: true,
              provenance: {
                provider: "codex",
                modelId: "gpt-5.6-sol",
                runtimeVersion: "codex-cli/test",
              },
            },
          ],
        };
      };

      if (request.method() === "GET") {
        const requested = url.searchParams.get("conversationId");
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(response(requested ?? conversations[0]?.id ?? null)),
        });
        return;
      }

      if (request.method() === "POST" && url.pathname.endsWith("/conversations")) {
        const body = request.postDataJSON() as { title: string };
        const now = `2026-08-14T16:0${conversations.length}:00.000Z`;
        const conversation: Conversation = {
          id: `conversation-${conversations.length + 1}`,
          title: body.title,
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
        conversations.unshift(conversation);
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(response(conversation.id)),
        });
        return;
      }

      if (request.method() === "POST" && url.pathname.endsWith("/messages")) {
        const key = request.headers()["idempotency-key"];
        if (key !== undefined) idempotencyKeys.push(key);
        const conversationId = url.pathname.match(/\/conversations\/([^/]+)\/messages$/)?.[1];
        const conversation = conversations.find((item) => item.id === conversationId);
        if (conversation === undefined) {
          await route.fulfill({ status: 404, body: "{}" });
          return;
        }
        const body = request.postDataJSON() as { message: string };
        conversation.messages.push(
          {
            id: `message-user-${conversation.id}`,
            role: "user",
            text: body.message,
            createdAt: "2026-08-14T16:10:00.000Z",
            provenance: null,
          },
          {
            id: `message-assistant-${conversation.id}`,
            role: "assistant",
            text: "Не хватает даты биоматериала. Лаборатория и код показателя уже указаны.",
            createdAt: "2026-08-14T16:10:08.000Z",
            provenance: {
              provider: "codex",
              modelId: "gpt-5.6-sol",
              runtimeVersion: "codex-cli/test",
            },
          },
        );
        conversation.updatedAt = "2026-08-14T16:10:08.000Z";
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(response(conversation.id)),
        });
        return;
      }

      await route.continue();
    },
  );

  await createSyntheticFamily(page, {
    owner: `Владелец agent ${suffix}`,
    family: `Семья agent ${suffix}`,
    profile: `Профиль agent ${suffix}`,
  });
  await uploadSyntheticDocument(page, {
    name: `agent-${suffix}.pdf`,
    mimeType: "application/pdf",
    buffer: fixture,
  });

  const agent = page.getByRole("region", { name: "Диалог с Codex" });
  await expect(agent.getByText("Только контекст этого документа.")).toBeVisible();
  await expect(agent.getByText("Первичный анализ")).toBeVisible();
  await expect(agent.getByText("Завершён за 18 с · временный")).toBeVisible();
  await expect(agent.getByText(`agent-${suffix}.pdf`)).toBeVisible();

  await agent.getByRole("button", { name: "Создать диалог" }).click();
  await agent.getByLabel("Название диалога").fill("Проверка дат");
  await agent.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(agent.getByRole("heading", { name: "Проверка дат" })).toBeVisible();

  await agent.getByLabel("Сообщение для Codex").fill("Чего не хватает в этом документе?");
  await agent.getByRole("button", { name: "Отправить" }).click();
  await expect(
    agent
      .locator(".document-agent-workspace__message.is-user p")
      .getByText("Чего не хватает в этом документе?"),
  ).toBeVisible();
  await expect(
    agent
      .locator(".document-agent-workspace__message.is-assistant p")
      .getByText("Не хватает даты биоматериала. Лаборатория и код показателя уже указаны."),
  ).toBeVisible();
  expect(idempotencyKeys).toHaveLength(1);

  await agent.getByRole("button", { name: "Создать диалог" }).click();
  await agent.getByLabel("Название диалога").fill("Разбор показателей");
  await agent.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(agent.getByRole("heading", { name: "Разбор показателей" })).toBeVisible();
  await expect(
    agent
      .locator(".document-agent-workspace__message.is-assistant p")
      .getByText("Не хватает даты биоматериала. Лаборатория и код показателя уже указаны."),
  ).toHaveCount(0);

  await agent.getByRole("button", { name: /Проверка дат/ }).click();
  await expect(
    agent
      .locator(".document-agent-workspace__message.is-assistant p")
      .getByText("Не хватает даты биоматериала. Лаборатория и код показателя уже указаны."),
  ).toBeVisible();

  await page.reload();
  const reloadedAgent = page.getByRole("region", { name: "Диалог с Codex" });
  await expect(reloadedAgent.getByRole("heading", { name: "Разбор показателей" })).toBeVisible();
  await reloadedAgent.getByRole("button", { name: /Проверка дат/ }).click();
  await expect(
    reloadedAgent
      .locator(".document-agent-workspace__message.is-assistant p")
      .getByText("Не хватает даты биоматериала. Лаборатория и код показателя уже указаны."),
  ).toBeVisible();
});
