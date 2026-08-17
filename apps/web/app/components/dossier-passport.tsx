"use client";

import type { MedicalProfileEntryResponse, MedicalProfileResponse } from "@veylta/contracts";
import { ContactRound, Pencil, ShieldAlert } from "lucide-react";
import { type FormEvent, useState } from "react";
import { apiRequest } from "../api-client";
import { identityLine, type Passport, passportOf } from "../dossier-passport";
import { medicalProfileErrorCopy, medicalProfilePath } from "./medical-profile-controls";

interface DossierPassportProps {
  readonly familyId: string;
  readonly profileId: string;
  readonly displayName: string;
  readonly profile: MedicalProfileResponse | null;
  readonly canWrite: boolean;
  readonly editing: boolean;
  readonly onToggleEditing: () => void;
  readonly onChanged: () => void;
}

function Fact({ label, value }: { readonly label: string; readonly value: string | null }) {
  if (value === null) return null;
  return (
    <div className="dossier-passport__fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChipList({ label, items }: { readonly label: string; readonly items: readonly string[] }) {
  return (
    <div className="dossier-passport__list">
      <span>{label}</span>
      {items.length === 0 ? (
        <em>не указано</em>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The person at the top of their dossier: what they recorded about themselves, read as facts.
 * Sex and birth year are the two facts interpretation starts from, so while either is missing
 * the passport asks for them right here instead of pointing at a form elsewhere.
 */
export function DossierPassport({
  familyId,
  profileId,
  displayName,
  profile,
  canWrite,
  editing,
  onToggleEditing,
  onChanged,
}: DossierPassportProps) {
  const passport: Passport | null =
    profile === null ? null : passportOf(profile.entries, new Date());
  const [sex, setSex] = useState<"female" | "male" | "">("");
  const [birthYear, setBirthYear] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveBasics(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (passport === null) return;
    const entries: Array<{ kind: "sex" | "birth_year"; value: string }> = [];
    if (passport.sex === null && sex !== "") entries.push({ kind: "sex", value: sex });
    if (passport.birthYear === null && birthYear.trim() !== "") {
      entries.push({ kind: "birth_year", value: birthYear.trim() });
    }
    if (entries.length === 0) return;
    setPending(true);
    setError(null);
    try {
      for (const entry of entries) {
        await apiRequest<MedicalProfileEntryResponse>(
          `${medicalProfilePath(familyId, profileId)}/entries/${crypto.randomUUID()}`,
          { method: "PUT", body: JSON.stringify({ ...entry, recordedOn: null }) },
        );
      }
      onChanged();
    } catch (caught) {
      setError(medicalProfileErrorCopy(caught));
    } finally {
      setPending(false);
    }
  }

  const initial = displayName.trim().charAt(0).toLocaleUpperCase("ru-RU");
  return (
    <section className="dossier-passport" aria-label="Паспорт досье" data-testid="dossier-passport">
      <div className="dossier-passport__identity">
        <span className="dossier-passport__avatar" aria-hidden="true">
          {initial.length === 0 ? <ContactRound size={22} /> : initial}
        </span>
        <div>
          <h2>{displayName}</h2>
          {passport !== null ? (
            <p className="dossier-passport__line">{identityLine(passport)}</p>
          ) : null}
        </div>
      </div>

      {passport !== null && !passport.ready ? (
        <form
          className="dossier-passport__basics"
          onSubmit={saveBasics}
          data-testid="dossier-basics"
        >
          <p>
            <ShieldAlert size={16} aria-hidden="true" />
            <span>
              <strong>Пол и год рождения — с них начинается любая интерпретация.</strong> Пока их
              нет, ИИ-врач только спросит недостающее, а референсы читаются без поправки на возраст.
            </span>
          </p>
          {canWrite ? (
            <div className="dossier-passport__basics-row">
              {passport.sex === null ? (
                <label>
                  <span>Пол</span>
                  <select
                    value={sex}
                    onChange={(event) => setSex(event.target.value as "female" | "male" | "")}
                    disabled={pending}
                  >
                    <option value="">—</option>
                    <option value="female">Женский</option>
                    <option value="male">Мужской</option>
                  </select>
                </label>
              ) : null}
              {passport.birthYear === null ? (
                <label>
                  <span>Год рождения</span>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    placeholder="1990"
                    value={birthYear}
                    onChange={(event) => setBirthYear(event.target.value)}
                    disabled={pending}
                  />
                </label>
              ) : null}
              <button className="button button--primary" type="submit" disabled={pending}>
                {pending ? "Сохраняем…" : "Сохранить"}
              </button>
            </div>
          ) : null}
          {error !== null ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}

      {passport !== null ? (
        <>
          <div className="dossier-passport__facts">
            <Fact
              label="Рост"
              value={passport.heightCm === null ? null : `${passport.heightCm} см`}
            />
            <Fact
              label="Вес"
              value={
                passport.weightKg === null
                  ? null
                  : `${String(passport.weightKg).replace(".", ",")} кг`
              }
            />
            <Fact
              label="ИМТ"
              value={passport.bmi === null ? null : String(passport.bmi).replace(".", ",")}
            />
            <Fact
              label="Год рождения"
              value={passport.birthYear === null ? null : String(passport.birthYear)}
            />
          </div>
          <div className="dossier-passport__lists">
            <ChipList label="Состояния" items={passport.conditions} />
            <ChipList label="Лекарства" items={passport.medications} />
            <ChipList label="Аллергии и непереносимости" items={passport.allergies} />
          </div>
        </>
      ) : (
        <p className="dossier-passport__loading">Читаем досье…</p>
      )}
      {canWrite ? (
        <button
          type="button"
          className="dossier-passport__edit"
          aria-expanded={editing}
          onClick={onToggleEditing}
        >
          <Pencil size={15} aria-hidden="true" />
          {editing ? "Скрыть редактор" : "Изменить досье"}
        </button>
      ) : null}
    </section>
  );
}
