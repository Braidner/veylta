# Part 1 — Header gear and split settings: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move settings out of the tab bar into a gear icon where the «Домашний сервер» chip sits, and split the settings page into «Пользователь» (this person and the family) and «Приложение» (server, admins only), each with its own URL.

**Architecture:** A pure `app/settings-sections.ts` decides which sections a session may open and which is the default; `app/paths.ts` gains `settingsPath(section, profileId?)`; two thin Next pages (`/settings`, `/settings/app`) pass the section into `VeyltaApp`; the header renders a `SettingsGear` link for sessions that may open settings and keeps the «Домашний сервер» chip only while nobody is signed in; `HomeSettingsScreen` renders one section at a time under a `SettingsSectionSwitch`. The legacy `veylta-app.tsx` only loses lines: new markup lives in new components.

**Tech Stack:** Next.js 16 app router, React 19, TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), `node:test` + `node:assert/strict` for pure modules, Playwright for e2e, Biome for lint/format.

**Spec:** `docs/superpowers/specs/2026-08-18-shell-routes-documents-history-design.md` — Part 1.

## Global Constraints

- No source file over 250 lines; `apps/web/app/components/veylta-app.tsx` is a legacy file listed in `config/file-length-baseline.json` (7390) and may only shrink.
- UI text is Russian; code, comments and commit messages are English.
- `canOpenSettings(session)` (`apps/web/app/account-access.ts`) stays the only gate for the gear and the page; `session.user.role === "admin"` gates the «Приложение» section.
- Biome a11y rules are on (no `role="group"` on a div — use `<fieldset>`; no `autoFocus`).
- Every change ends with `pnpm lint && pnpm typecheck && pnpm --filter @veylta/web test`; e2e specs run through `pnpm test:e2e <spec>` (the script puts a fake `codex` on PATH).
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Pure settings sections and the settings path

**Files:**
- Create: `apps/web/app/settings-sections.ts`
- Create: `apps/web/app/settings-sections.test.ts`
- Modify: `apps/web/app/paths.ts` (append `settingsPath`)

**Interfaces:**
- Produces: `type SettingsSection = "user" | "app"`, `SETTINGS_SECTIONS: readonly SettingsSection[]`, `settingsSections(session): SettingsSection[]`, `defaultSettingsSection = "user"`, `parseSettingsSection(value: string | undefined): SettingsSection`, `settingsPath(section: SettingsSection, profileId?: string): string` (`/settings`, `/settings/app`, with `?profile=<id>` when a profile id is given).

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/settings-sections.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { settingsPath } from "./paths";
import {
  defaultSettingsSection,
  parseSettingsSection,
  SETTINGS_SECTIONS,
  settingsSections,
} from "./settings-sections";

const owner = { user: { role: "user" }, families: [{ role: "owner" }] };
const admin = { user: { role: "admin" }, families: [{ role: "adult_member" }] };
const member = { user: { role: "user" }, families: [{ role: "adult_member" }] };

test("a family owner opens the user section only; an admin both; a member none", () => {
  assert.deepEqual(SETTINGS_SECTIONS, ["user", "app"]);
  assert.deepEqual(settingsSections(owner), ["user"]);
  assert.deepEqual(settingsSections(admin), ["user", "app"]);
  assert.deepEqual(settingsSections(member), []);
  assert.equal(defaultSettingsSection, "user");
});

test("the URL segment names the section; anything else is the user section", () => {
  assert.equal(parseSettingsSection("app"), "app");
  assert.equal(parseSettingsSection("user"), "user");
  assert.equal(parseSettingsSection(undefined), "user");
  assert.equal(parseSettingsSection("server"), "user");
});

test("the settings path carries the section and, when given, the profile to manage first", () => {
  assert.equal(settingsPath("user"), "/settings");
  assert.equal(settingsPath("app"), "/settings/app");
  assert.equal(
    settingsPath("user", "00000000-0000-4000-8000-000000000001"),
    "/settings?profile=00000000-0000-4000-8000-000000000001",
  );
  assert.equal(
    settingsPath("app", "00000000-0000-4000-8000-000000000001"),
    "/settings/app?profile=00000000-0000-4000-8000-000000000001",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @veylta/web exec tsx --test app/settings-sections.test.ts`
Expected: FAIL — `Cannot find module './settings-sections'` (and `settingsPath` is not exported).

- [ ] **Step 3: Write the module and the path helper**

```ts
// apps/web/app/settings-sections.ts
import { canOpenSettings } from "./account-access";

/** The two faces of settings: this person and their family, and the server an admin runs. */
export const SETTINGS_SECTIONS = ["user", "app"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const defaultSettingsSection: SettingsSection = "user";

/** Which sections a session may open: the user section for anyone who may open settings at all. */
export function settingsSections(session: {
  readonly user: { readonly role: string | null };
  readonly families: ReadonlyArray<{ readonly role: string | null }>;
}): SettingsSection[] {
  if (!canOpenSettings(session)) return [];
  return session.user.role === "admin" ? ["user", "app"] : ["user"];
}

/** The `/settings/<segment>` segment as a section; an unknown segment is the user section. */
export function parseSettingsSection(value: string | undefined): SettingsSection {
  return value === "app" ? "app" : defaultSettingsSection;
}
```

Append to `apps/web/app/paths.ts`:

```ts
/** Settings as a page of their own: the section in the path, the profile to manage first in the query. */
export function settingsPath(section: "user" | "app", profileId?: string): string {
  const base = section === "app" ? "/settings/app" : "/settings";
  return profileId === undefined ? base : `${base}?profile=${encodeURIComponent(profileId)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @veylta/web exec tsx --test app/settings-sections.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint and commit**

```bash
pnpm exec biome check --write apps/web/app/settings-sections.ts apps/web/app/settings-sections.test.ts apps/web/app/paths.ts
git add apps/web/app/settings-sections.ts apps/web/app/settings-sections.test.ts apps/web/app/paths.ts
git commit -m "feat(web): settings sections and their path as pure helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: The `/settings/app` route and the section prop

**Files:**
- Create: `apps/web/app/settings/app/page.tsx`
- Modify: `apps/web/app/settings/page.tsx`
- Modify: `apps/web/app/components/veylta-app.tsx` (props `VeyltaAppProps`, the `HomeSettingsScreen` mount)

**Interfaces:**
- Consumes: `SettingsSection`, `parseSettingsSection` from Task 1.
- Produces: `VeyltaApp` prop `requestedSettingsSection?: SettingsSection` (default `"user"`), passed to `HomeSettingsScreen` as `section`.

- [ ] **Step 1: Add the route page**

```tsx
// apps/web/app/settings/app/page.tsx
import { VeyltaApp } from "../../components/veylta-app";

interface SettingsAppPageProps {
  searchParams: Promise<{ profile?: string | string[] }>;
}

/** «Приложение»: the server an administrator runs — Codex, storage, accounts. */
export default async function SettingsAppPage({ searchParams }: SettingsAppPageProps) {
  const { profile } = await searchParams;
  return (
    <VeyltaApp
      requestedSettings
      requestedSettingsSection="app"
      requestedSettingsProfileId={Array.isArray(profile) ? profile[0] : profile}
    />
  );
}
```

Edit `apps/web/app/settings/page.tsx` so the existing page passes the user section explicitly:

```tsx
    <VeyltaApp
      requestedSettings
      requestedSettingsSection="user"
      requestedSettingsProfileId={Array.isArray(profile) ? profile[0] : profile}
    />
```

- [ ] **Step 2: Thread the prop through `VeyltaApp`**

In `apps/web/app/components/veylta-app.tsx`:

1. Import the type next to the other `../` imports: `import type { SettingsSection } from "../settings-sections";`
2. In `interface VeyltaAppProps` (near line 329) add after `requestedSettings?: boolean;`:
   ```ts
   /** Which settings section `/settings[/app]` asked for; the user section by default. */
   requestedSettingsSection?: SettingsSection | undefined;
   ```
3. In the destructuring (near line 343) add `requestedSettingsSection = "user",`.
4. Where `<HomeSettingsScreen` is mounted (near line 722) add the prop `section={requestedSettingsSection}`.
5. In `interface HomeSettingsScreenProps` (near line 793) add `section: SettingsSection;` and destructure `section` in `HomeSettingsScreen` (it is used in Task 4; until then TypeScript accepts an unused destructured prop — Biome does not flag unused destructured props).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @veylta/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
pnpm exec biome check --write apps/web/app
git add apps/web/app/settings apps/web/app/components/veylta-app.tsx
git commit -m "feat(web): /settings/app route carries the settings section into the app

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: The gear in the header, the tab gone

**Files:**
- Create: `apps/web/app/components/settings-gear.tsx`
- Modify: `apps/web/app/components/veylta-app.tsx` (tab bar near lines 647–664; the `workspace-actions` block near lines 677–681)
- Modify: `apps/web/app/globals.css` (after `.workspace-icon-action:hover`, near line 286)

**Interfaces:**
- Consumes: `canOpenSettings` (`app/account-access.ts`), `settingsPath` (Task 1).
- Produces: `<SettingsGear session={session} profileId={navigationProfile?.id} />` — renders a `Link` with `aria-label="Настройки"` or `null`.

- [ ] **Step 1: Write the gear component**

```tsx
// apps/web/app/components/settings-gear.tsx
"use client";

import type { SessionResponse } from "@veylta/contracts";
import { Settings } from "lucide-react";
import Link from "next/link";
import { canOpenSettings } from "../account-access";
import { settingsPath } from "../paths";

/**
 * Settings as a gear where the server chip used to sit: for a family owner it opens this person's
 * settings, for an administrator the same page with the application section within reach; for
 * anyone else nothing — the spot stays empty, the rule stays `canOpenSettings`.
 */
export function SettingsGear({
  session,
  profileId,
}: {
  readonly session: SessionResponse;
  readonly profileId: string | undefined;
}) {
  if (!canOpenSettings(session)) return null;
  return (
    <Link
      className="workspace-icon-action workspace-gear"
      href={settingsPath("user", profileId)}
      aria-label="Настройки"
      title="Настройки"
      data-testid="settings-gear"
    >
      <Settings size={19} aria-hidden="true" />
    </Link>
  );
}
```

- [ ] **Step 2: Remove the «Настройки» tab and swap the chip**

In `apps/web/app/components/veylta-app.tsx`:

1. Delete the whole `{session !== undefined && canOpenSettings(session) ? ( <Link id="workspace-tab-settings" … >Настройки</Link> ) : null}` block inside `.workspace-primary-nav` (lines ≈647–664).
2. Replace the chip inside `.workspace-actions`:
   ```tsx
          <span className="environment">
            <span aria-hidden="true" />
            Домашний сервер
          </span>
   ```
   with
   ```tsx
          {session === undefined ? (
            <span className="environment">
              <span aria-hidden="true" />
              Домашний сервер
            </span>
          ) : (
            <SettingsGear session={session} profileId={navigationProfile?.id} />
          )}
   ```
3. Add `import { SettingsGear } from "./settings-gear";` next to the other `./` component imports (alphabetical: after `./page-hero` imports if present, before `./system-status`).
4. If the `Settings` lucide icon is now unused in this file, remove it from the `lucide-react` import list (Biome will tell you).
5. `activeTab === "settings"` stays: the settings page still highlights no tab; leave `WorkspaceTab` as is.

- [ ] **Step 3: Style the gear**

Append after `.workspace-icon-action:hover { … }` in `apps/web/app/globals.css`:

```css
.workspace-gear {
  color: var(--color-muted);
  text-decoration: none;
}

.workspace-gear:hover {
  color: var(--color-ink);
}
```

- [ ] **Step 4: Lint, typecheck, and check the legacy file shrank**

Run: `pnpm exec biome check --write apps/web/app && pnpm --filter @veylta/web typecheck && pnpm lint`
Expected: no errors; `pnpm lint` prints `File lengths OK` (veylta-app.tsx must be at or below its baseline — it lost ~17 lines of tab and gained ~6).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/settings-gear.tsx apps/web/app/components/veylta-app.tsx apps/web/app/globals.css
git commit -m "feat(web): settings move from the tab bar to a gear where the server chip sat

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: The settings page in two sections

**Files:**
- Create: `apps/web/app/components/settings-section-switch.tsx`
- Create: `apps/web/app/components/settings-user-section.tsx`
- Modify: `apps/web/app/components/veylta-app.tsx` (`HomeSettingsScreen`, lines ≈799–1625)
- Modify: `apps/web/app/globals.css` (after `.settings-heading` rules)

**Interfaces:**
- Consumes: `SettingsSection`, `settingsSections` (Task 1), `settingsPath` (Task 1), `SystemStatus` (`./system-status`), `ProfileManagementSettings` (stays in veylta-app.tsx; its props are `{ session, initialProfileId } & ProfileManagementProps`).
- Produces: `<SettingsSectionSwitch sections current profileId />` (links), `<SettingsUserSection session …profileManagement>` (the user section body: identity block + `ProfileManagementSettings`). `ProfileManagementSettings` must be exported from veylta-app.tsx for the new component: add `export` to its declaration (`export function ProfileManagementSettings(`).

- [ ] **Step 1: Write the switch**

```tsx
// apps/web/app/components/settings-section-switch.tsx
"use client";

import Link from "next/link";
import { settingsPath } from "../paths";
import type { SettingsSection } from "../settings-sections";

const label: Record<SettingsSection, string> = { user: "Пользователь", app: "Приложение" };

/** «Пользователь» · «Приложение» — only the sections this session may open, the current one marked. */
export function SettingsSectionSwitch({
  sections,
  current,
  profileId,
}: {
  readonly sections: readonly SettingsSection[];
  readonly current: SettingsSection;
  readonly profileId: string | undefined;
}) {
  if (sections.length < 2) return null;
  return (
    <nav className="settings-sections" aria-label="Разделы настроек">
      {sections.map((section) => (
        <Link
          key={section}
          className={`settings-sections__item${section === current ? " is-current" : ""}`}
          href={settingsPath(section, profileId)}
          aria-current={section === current ? "page" : undefined}
        >
          {label[section]}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Write the user section**

```tsx
// apps/web/app/components/settings-user-section.tsx
"use client";

import type { SessionResponse } from "@veylta/contracts";
import { ProfileManagementSettings, type ProfileManagementProps } from "./veylta-app";

const roleCopy: Record<string, string> = {
  admin: "Администратор системы",
  user: "Пользователь системы",
};

/** «Пользователь»: who is signed in, and the family's profiles and access focused on this person. */
export function SettingsUserSection({
  session,
  initialProfileId,
  profileManagement,
}: {
  readonly session: SessionResponse;
  readonly initialProfileId: string | undefined;
  readonly profileManagement: ProfileManagementProps;
}) {
  return (
    <>
      <section className="settings-identity" aria-labelledby="settings-identity-title">
        <div className="settings-section-heading">
          <div>
            <p className="section-label">Учётная запись</p>
            <h2 id="settings-identity-title">{session.user.displayName}</h2>
          </div>
          <p>
            {session.user.username === null ? "демо-сессия" : `@${session.user.username}`} ·{" "}
            {roleCopy[session.user.role ?? "user"] ?? "Пользователь системы"}
          </p>
        </div>
      </section>
      <ProfileManagementSettings
        session={session}
        initialProfileId={initialProfileId}
        {...profileManagement}
      />
    </>
  );
}
```

Export `ProfileManagementProps` and `ProfileManagementSettings` from `veylta-app.tsx` (add `export` before `interface ProfileManagementProps` and `function ProfileManagementSettings`).

- [ ] **Step 3: Restructure `HomeSettingsScreen`**

In `apps/web/app/components/veylta-app.tsx`, inside `HomeSettingsScreen`, replace the two returns — the non-admin branch (`if (!isAdmin) { … }`, lines ≈992–1017) and the admin `return ( <section id="workspace-panel-settings" … > … </section> )` (lines ≈1048–1625) — by one render. Keep all the admin blocks' JSX exactly as it is, only moved under `section === "app"`:

```tsx
  const isAdmin = session.user.role === "admin";
  const sections = settingsSections(session);
  if (sections.length === 0 || (section === "app" && !isAdmin)) return <MissingSettingsScreen />;
  if (section === "app" && loadState === "loading") {
    return <LoadingScreen copy="Проверяем домашний сервер…" />;
  }
  if (section === "app" && loadState === "denied") return <MissingSettingsScreen />;
  if (section === "app" && (loadState === "error" || settings === null)) {
    return <ErrorScreen onRetry={() => void load()} />;
  }
  // …the existing `codexState`, `subscriptionConnected`, `selectedModel`, `selectedDocumentModel`,
  // `reasoningLabels` declarations stay here, guarded: compute them only when `settings !== null`
  // (wrap the admin-only block below in `settings !== null ? (…) : null`).

  return (
    <section
      id="workspace-panel-settings"
      className="settings-shell workspace-tab-panel workspace-tab-panel--settings"
      aria-labelledby="settings-title"
      aria-label="Настройки"
    >
      <div className="settings-heading">
        <div>
          <p className="context-line">{section === "app" ? "Управление домашним контуром" : "Семья"}</p>
          <h1 id="settings-title">{section === "app" ? "Настройки сервера" : "Настройки"}</h1>
          <p className="lede">
            {section === "app"
              ? "Здесь администратор управляет локальным агентом, местом хранения и доступом людей. Оригиналы остаются в выбранном домашнем хранилище. Только подтверждённая выжимка отправляется в Codex после отдельного согласия владельца."
              : "Профили семьи, архив и доступ участников. Серверные настройки — Codex, хранилище, учётные записи — в разделе «Приложение», доступном администратору."}
          </p>
        </div>
        {section === "app" ? (
          <div className="settings-heading__identity">
            <span>Администратор</span>
            <strong>{session.user.displayName}</strong>
            <small>@{session.user.username}</small>
          </div>
        ) : null}
      </div>
      <SettingsSectionSwitch sections={sections} current={section} profileId={initialProfileId} />
      {section === "user" ? (
        <SettingsUserSection
          session={session}
          initialProfileId={initialProfileId}
          profileManagement={profileManagement}
        />
      ) : settings !== null ? (
        <>
          <SystemStatus />
          {notice !== null ? (
            <p className="settings-notice" role="status">
              {notice}
            </p>
          ) : null}
          <div className="settings-console">{/* the existing codex-console and storage-settings sections, unchanged */}</div>
          {/* the existing account-settings section, unchanged */}
        </>
      ) : null}
    </section>
  );
```

Details the implementer must apply while moving the JSX:
- The `<ProfileManagementSettings … />` call that sat between `.settings-console` and `.account-settings` in the admin render is **deleted** there (it now renders in the user section only).
- `role="tabpanel"` and `aria-labelledby="workspace-tab-settings settings-title"` go (there is no tab any more): use `aria-labelledby="settings-title"`.
- Imports to add: `import { settingsSections, type SettingsSection } from "../settings-sections";`, `import { SettingsSectionSwitch } from "./settings-section-switch";`, `import { SettingsUserSection } from "./settings-user-section";`. `SystemStatus` is already imported.
- The admin `useEffect` that loads `/v1/settings` stays as it is (admins load regardless of section; a family owner never asks).

- [ ] **Step 4: Style the switch and the identity block**

Append to `apps/web/app/globals.css` after the last `.settings-heading…` rule:

```css
.settings-sections {
  display: inline-flex;
  gap: 4px;
  margin: 0 0 18px;
  padding: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 999px;
}

.settings-sections__item {
  min-height: 34px;
  padding: 6px 14px;
  color: var(--color-muted);
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 650;
  line-height: 22px;
  text-decoration: none;
}

.settings-sections__item.is-current {
  color: var(--color-ink);
  background: var(--color-canvas);
  box-shadow: 0 1px 2px oklch(0 0 0 / 0.08);
}

.settings-identity .settings-section-heading p {
  margin: 0;
  color: var(--color-muted);
  font-size: 0.8125rem;
}
```

- [ ] **Step 5: Lint, typecheck, unit tests, line budget**

Run: `pnpm exec biome check --write apps/web/app && pnpm --filter @veylta/web typecheck && pnpm --filter @veylta/web test && pnpm lint`
Expected: all green; `veylta-app.tsx` shorter than before Task 3 (the duplicated owner branch is gone).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/settings-section-switch.tsx apps/web/app/components/settings-user-section.tsx apps/web/app/components/veylta-app.tsx apps/web/app/globals.css
git commit -m "feat(web): settings split into «Пользователь» and «Приложение» with the readiness line inside

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: e2e — the gear, the sections, the readiness line

**Files:**
- Modify: `e2e/account-setup.spec.ts` (lines ≈34–50 and ≈130–137)
- Modify: `e2e/family-profile.spec.ts` (`openProfileManagement`, lines ≈41–46)
- Keep: `e2e/foundation.spec.ts` (the «Домашний сервер» marker is asserted on `/` without a session — still rendered).

- [ ] **Step 1: Update the admin flow in `e2e/account-setup.spec.ts`**

Replace

```ts
  await page.getByRole("tab", { name: "Настройки" }).click();
  // Opened from a profile, settings carries that profile so family management starts on it.
  await expect(page).toHaveURL(/\/settings(?:\?profile=[0-9a-f-]{36})?$/);
  await expect(page.getByRole("heading", { level: 1, name: "Настройки сервера" })).toBeVisible();
  await expect(page.locator(".workspace-bar--profile")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Настройки" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tabpanel", { name: "Настройки" })).toBeVisible();
```

with

```ts
  await expect(page.getByRole("tab", { name: "Настройки" })).toHaveCount(0);
  await page.getByTestId("settings-gear").click();
  // Opened from a profile, settings carries that profile so family management starts on it.
  await expect(page).toHaveURL(/\/settings\?profile=[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Настройки" })).toBeVisible();
  await expect(page.getByTestId("profile-settings")).toBeVisible();
  await expect(page.getByText("Администратор системы")).toBeVisible();
  await page.getByRole("link", { name: "Приложение" }).click();
  await expect(page).toHaveURL(/\/settings\/app\?profile=[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Настройки сервера" })).toBeVisible();
  await expect(page.getByText("API и база данных готовы")).toBeVisible();
  await expect(page.locator(".workspace-bar--profile")).toBeVisible();
```

and leave the following assertions («Локальный агент без API-ключа», selects) as they are — they belong to the application section now open. Further down, where the family user is checked:

```ts
  await expect(page.getByRole("link", { name: "Настройки" })).toHaveCount(0);
```

stays true (the gear is a link named «Настройки» and the member may not open settings). Add right after `await page.goto("/settings");` assertions one more:

```ts
  await page.goto("/settings/app");
  await expect(page.getByRole("heading", { level: 1, name: "Настройки недоступны" })).toBeVisible();
```

- [ ] **Step 2: Update `openProfileManagement` in `e2e/family-profile.spec.ts`**

```ts
/** Family profiles and access live in the user section of settings, behind the gear. */
async function openProfileManagement(page: Page): Promise<void> {
  await page.getByTestId("settings-gear").click();
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByTestId("profile-settings")).toBeVisible();
}
```

Search the same file for any other `getByRole("tab", { name: "Настройки" })` or `tabpanel` named «Настройки» and replace with the gear + `profile-settings` checks in the same way.

- [ ] **Step 3: Run the three specs**

Run: `pnpm test:e2e e2e/account-setup.spec.ts e2e/family-profile.spec.ts e2e/foundation.spec.ts`
Expected: all pass. If `family-profile.spec.ts` navigates back to a profile after settings through a tab, keep those lines — tabs other than settings are unchanged.

- [ ] **Step 4: Commit**

```bash
git add e2e/account-setup.spec.ts e2e/family-profile.spec.ts
git commit -m "test(e2e): settings open from the gear; the application section holds the server

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Docs, full check, push

**Files:**
- Modify: `CLAUDE.md` — the paragraph «**Settings serves two audiences.**»
- Modify: `docs/status.md` — add item 27.

- [ ] **Step 1: Update `CLAUDE.md`**

Replace the paragraph starting `**Settings serves two audiences.**` with:

```md
**Settings serves two audiences, in two sections.** The page opens from a gear in the header
(`components/settings-gear.tsx`, shown when `canOpenSettings`; the «Домашний сервер» chip stays
only while nobody is signed in). `/settings` is «Пользователь» — who is signed in and the family's
«Профили и доступ» (any family owner; never calls `/v1/settings`); `/settings/app` is «Приложение»
— the readiness line, Codex, storage, server accounts (admin only). `app/settings-sections.ts`
decides the sections a session may open; `settingsPath(section, profileId?)` builds the link and
`?profile=` opens management on that person. Profile management is not on the documents tab.
```

- [ ] **Step 2: Update `docs/status.md`**

Append after item 26:

```md
27. open settings from a gear in the header instead of a tab, in two sections —
    «Пользователь» (the signed-in account and the family's profiles and access)
    and «Приложение» (server readiness, Codex, storage, accounts; administrators).
```

- [ ] **Step 3: Full check sequence**

Run: `pnpm license:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:e2e`
Expected: all green (e2e ≈ 42 passed, 2 skipped README screenshot specs).

- [ ] **Step 4: Commit and push, watch CI**

```bash
git add CLAUDE.md docs/status.md
git commit -m "docs: settings behind the gear, in two sections

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
gh run list --limit 1
```

Wait for the run to complete (`gh run view <id> --json status,conclusion`); it must be `success`.
