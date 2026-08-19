import {
  isValidProfileHandle,
  MAX_PROFILE_HANDLE_LENGTH,
  MIN_PROFILE_HANDLE_LENGTH,
  PROFILE_HANDLE_PATTERN,
  RESERVED_PROFILE_HANDLES,
} from "@veylta/contracts";
import { ApiError } from "./api-client";

/** The rule in the person's words, before the request; null when the value may be sent. */
export function handleFieldError(value: string): string | null {
  const handle = value.trim().toLowerCase();
  if (handle.length < MIN_PROFILE_HANDLE_LENGTH || handle.length > MAX_PROFILE_HANDLE_LENGTH) {
    return `Адрес — от ${MIN_PROFILE_HANDLE_LENGTH} до ${MAX_PROFILE_HANDLE_LENGTH} символов.`;
  }
  if (/[^a-z0-9-]/.test(handle)) return "Только латиница, цифры и дефис.";
  if (!PROFILE_HANDLE_PATTERN.test(handle)) return "Дефис не может стоять в начале или в конце.";
  if (RESERVED_PROFILE_HANDLES.includes(handle)) return "Это слово занято системой.";
  return isValidProfileHandle(handle) ? null : "Адрес не подходит.";
}

export function handleSaveErrorCopy(error: unknown): string {
  if (error instanceof ApiError && error.status === 409)
    return "Такой адрес уже занят другим профилем.";
  if (error instanceof ApiError && error.status === 422) return "Адрес не подходит по правилам.";
  return "Не удалось сохранить адрес. Проверьте соединение и повторите.";
}
