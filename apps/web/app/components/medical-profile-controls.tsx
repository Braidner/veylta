"use client";

import type { MedicalProfileEntryKind } from "@veylta/contracts";
import { ApiError } from "../api-client";
import { medicalProfileInput } from "../medical-profile";

export interface Draft {
  readonly groupId: string;
  readonly kind: MedicalProfileEntryKind;
  readonly value: string;
  readonly recordedOn: string;
}

export function medicalProfilePath(familyId: string, profileId: string): string {
  return `/v1/families/${encodeURIComponent(familyId)}/profiles/${encodeURIComponent(profileId)}/medical-profile`;
}

export function medicalProfileErrorCopy(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return "Запись изменилась или такое значение уже есть — список обновлён, попробуйте снова.";
  }
  if (error instanceof ApiError && error.status === 422)
    return "Проверьте значение: оно вне допустимого.";
  return "Не удалось сохранить. Проверьте соединение и повторите.";
}

export function ValueControl({
  kind,
  value,
  onChange,
  id,
}: {
  kind: MedicalProfileEntryKind;
  value: string;
  onChange: (value: string) => void;
  id: string;
}) {
  const input = medicalProfileInput(kind);
  if (input.control === "select") {
    return (
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} required>
        <option value="">Выберите</option>
        {input.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (input.control === "number") {
    return (
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={input.min}
        max={input.max}
        step={kind === "birth_year" ? 1 : 0.1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    );
  }
  return (
    <input
      id={id}
      type="text"
      maxLength={300}
      placeholder={input.placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required
    />
  );
}
