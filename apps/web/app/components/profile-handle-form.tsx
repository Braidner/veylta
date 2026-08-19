"use client";

import type { PatientProfileSummary, ProfileHandleResponse } from "@veylta/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { apiRequest } from "../api-client";
import { settingsPath } from "../paths";
import { handleFieldError, handleSaveErrorCopy } from "../profile-handle-copy";

/**
 * The person's own address: `/<handle>` on this server. Validated in the field by the same rule
 * the server enforces; on success the session is refreshed and the page moves to the new address.
 */
export function ProfileHandleForm({
  profile,
  onSaved,
}: {
  readonly profile: PatientProfileSummary;
  readonly onSaved: () => Promise<void>;
}) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(profile.handle);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldError = handleFieldError(value);
  const unchanged = value.trim().toLowerCase() === profile.handle;

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (fieldError !== null || unchanged) return;
    setPending(true);
    setError(null);
    try {
      const saved = await apiRequest<ProfileHandleResponse>(
        `/v1/families/${encodeURIComponent(profile.familyId)}/profiles/${encodeURIComponent(profile.id)}/handle`,
        { method: "PUT", body: JSON.stringify({ handle: value.trim().toLowerCase() }) },
      );
      await onSaved();
      router.replace(settingsPath(saved.handle, "user"));
    } catch (requestError) {
      setError(handleSaveErrorCopy(requestError));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="profile-handle"
      aria-labelledby={`${id}-title`}
      onSubmit={(event) => void save(event)}
    >
      <div className="settings-section-heading">
        <div>
          <p className="section-label">Адрес страницы</p>
          <h2 id={`${id}-title`}>{profile.displayName}</h2>
        </div>
        <p>
          /<strong>{profile.handle}</strong>
        </p>
      </div>
      <label className="field" htmlFor={`${id}-handle`}>
        <span>Адрес</span>
        <input
          id={`${id}-handle`}
          value={value}
          maxLength={30}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={fieldError !== null}
          aria-describedby={`${id}-hint`}
          onChange={(event) => setValue(event.target.value)}
          disabled={pending}
        />
      </label>
      <small id={`${id}-hint`} className="field-hint">
        {fieldError ??
          "Латиница, цифры и дефис, от 3 до 30 символов. Старый адрес перестанет открываться."}
      </small>
      <button
        className="button button--secondary"
        type="submit"
        disabled={pending || unchanged || fieldError !== null}
      >
        {pending ? "Сохраняем…" : "Сохранить адрес"}
      </button>
      {error !== null ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
