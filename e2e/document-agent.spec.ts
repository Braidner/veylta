import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { uploadSyntheticDocument } from "./support/document-upload";
import { createSyntheticFamily } from "./support/synthetic-family";

const fixture = await readFile(
  new URL("../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url),
);

test("a document keeps one Russian Codex conversation after reload", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const messages: Array<{
    id: string;
    role: "assistant" | "user";
    text: string;
    createdAt: string;
    provenance: { provider: "codex"; modelId: string; runtimeVersion: string } | null;
  }> = [];
  const idempotencyKeys: string[] = [];

  await page.route("**/health-api/**/documents/*/agent{,/**}", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const documentId = url.pathname.match(/\/documents\/([^/]+)\/agent/)?.[1] ?? "document";
    if (request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          contractVersion: "document-agent/v1",
          documentId,
          conversationId: messages.length === 0 ? null : "conversation-1",
          messages,
        }),
      });
      return;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/messages")) {
      const key = request.headers()["idempotency-key"];
      if (key !== undefined) idempotencyKeys.push(key);
      const body = request.postDataJSON() as { message: string };
      messages.push(
        {
          id: "message-user-1",
          role: "user",
          text: body.message,
          createdAt: "2026-08-14T16:00:00.000Z",
          provenance: null,
        },
        {
          id: "message-assistant-1",
          role: "assistant",
          text: "Не хватает даты биоматериала. Лаборатория и код показателя уже указаны.",
          createdAt: "2026-08-14T16:00:08.000Z",
          provenance: {
            provider: "codex",
            modelId: "gpt-5.4-mini",
            runtimeVersion: "codex-cli/test",
          },
        },
      );
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          contractVersion: "document-agent/v1",
          documentId,
          conversationId: "conversation-1",
          messages,
        }),
      });
      return;
    }
    await route.continue();
  });

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
  await expect(agent.getByText("Codex получает только контекст этого документа")).toBeVisible();
  await agent.getByLabel("Сообщение для Codex").fill("Чего не хватает в этом документе?");
  await agent.getByRole("button", { name: "Отправить" }).click();
  await expect(
    agent
      .locator(".document-agent__message--user p")
      .getByText("Чего не хватает в этом документе?"),
  ).toBeVisible();
  await expect(
    agent.getByText("Не хватает даты биоматериала. Лаборатория и код показателя уже указаны."),
  ).toBeVisible();
  expect(idempotencyKeys).toHaveLength(1);

  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Диалог с Codex" })
      .getByText("Не хватает даты биоматериала. Лаборатория и код показателя уже указаны."),
  ).toBeVisible();
});
