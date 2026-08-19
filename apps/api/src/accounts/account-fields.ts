import { DomainValidationError } from "../family/family-service.js";

/** What a person types to sign in: lower-case latin, 3–32, `.`, `_` and `-` inside. */
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
  return usernamePattern.test(value);
}

/**
 * The fields an account is created from, checked in one place: the first-administrator setup and
 * the administrator's «Пользователи» accept exactly the same username, name and password.
 */
export function validateAccountFields(input: {
  username: string;
  displayName: string;
  password: string;
}): void {
  if (
    !isValidUsername(input.username) ||
    input.displayName.length === 0 ||
    input.displayName.length > 120 ||
    input.password.length < 12 ||
    input.password.length > 128 ||
    Buffer.byteLength(input.password, "utf8") > 256
  ) {
    throw new DomainValidationError();
  }
}
