import {
  MAX_PROFILE_HANDLE_LENGTH,
  MIN_PROFILE_HANDLE_LENGTH,
  RESERVED_PROFILE_HANDLES,
} from "@veylta/contracts";

/** A plain Cyrillic transliteration for names — a household convenience, not a standard. */
const letters: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  і: "i",
  ї: "yi",
  є: "ye",
  ґ: "g",
};

export function transliterate(value: string): string {
  return [...value.toLowerCase()].map((char) => letters[char] ?? char).join("");
}

const fallback = "profile";

/** Within the length bound, no trailing hyphen, and long enough to be a handle at all. */
function finalize(cleaned: string): string {
  const clipped = cleaned.slice(0, MAX_PROFILE_HANDLE_LENGTH).replace(/-+$/, "");
  return clipped.length < MIN_PROFILE_HANDLE_LENGTH ? fallback : clipped;
}

/** The first word of a name in the handle alphabet; too short or empty → `profile`. */
export function handleFromName(displayName: string): string {
  const first = transliterate(displayName).trim().split(/\s+/)[0] ?? "";
  return finalize(first.replace(/[^a-z0-9-]/g, "").replace(/^-+/, ""));
}

/** A username (`[a-z0-9._-]`) in the handle alphabet: dots and underscores become hyphens. */
export function handleFromUsername(username: string): string {
  return finalize(
    username
      .toLowerCase()
      .replace(/[._]/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/^-+/, ""),
  );
}

/** `base`, `base-2`, `base-3`, … — the first one `taken` does not know, within the bound. */
export function withSuffix(base: string, taken: (candidate: string) => boolean): string {
  if (!taken(base)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, MAX_PROFILE_HANDLE_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken(candidate)) return candidate;
  }
  throw new Error("No free profile handle");
}

/**
 * The default rule: the account's username for a linked profile, the name otherwise; a reserved
 * word is treated as taken so it is suffixed. Uniqueness against the database is the caller's
 * `taken` — this function only knows the reserved list.
 */
export function defaultHandle(input: { username: string | null; displayName: string }): string {
  const base =
    input.username === null
      ? handleFromName(input.displayName)
      : handleFromUsername(input.username);
  return withSuffix(base, (candidate) => RESERVED_PROFILE_HANDLES.includes(candidate));
}
