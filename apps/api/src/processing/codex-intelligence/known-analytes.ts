import type { AnalyteCatalogEntry } from "../document-intelligence-provider.js";
import { limits } from "./constants.js";

/** The catalog as it travels in one request: bounded in entries, aliases and text length. */
export function boundedCatalog(entries: readonly AnalyteCatalogEntry[]): AnalyteCatalogEntry[] {
  return entries.slice(0, limits.catalogEntries).map((entry) => ({
    code: entry.code,
    displayName: entry.displayName.slice(0, 200),
    unit: entry.unit.slice(0, 100),
    aliases: entry.aliases.slice(0, limits.catalogAliases).map((alias) => alias.slice(0, 200)),
  }));
}

/** The codes the schema allowed the model to propose; null when no catalog travelled. */
export function knownCodes(catalog: readonly AnalyteCatalogEntry[]): ReadonlySet<string> | null {
  return catalog.length === 0 ? null : new Set(catalog.map((entry) => entry.code));
}
