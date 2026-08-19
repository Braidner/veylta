import { expect, type Page } from "@playwright/test";

/**
 * Records sex and birth year through the dossier passport's inline form — the two facts every
 * interpretation starts from. Waits until the passport line reads them back.
 */
export async function recordBasics(
  page: Page,
  profileUrl: string,
  input: { sex: "female" | "male"; birthYear: string },
): Promise<void> {
  await page.goto(`${profileUrl}/dossier`);
  const basics = page.getByTestId("dossier-basics");
  await basics.getByLabel("Пол").selectOption(input.sex);
  await basics.getByLabel("Год рождения").fill(input.birthYear);
  await basics.getByRole("button", { name: "Сохранить" }).click();
  await expect(basics).toHaveCount(0);
  const age = new Date().getUTCFullYear() - Number(input.birthYear);
  await expect(page.getByTestId("dossier-passport")).toContainText(
    `${input.sex === "female" ? "Женщина" : "Мужчина"} · ${age} ${years(age)}`,
  );
}

/** «1 год», «2 года», «5 лет» — the passport's own agreement, mirrored here for the check. */
function years(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "год";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "года";
  return "лет";
}
