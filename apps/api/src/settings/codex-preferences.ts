import type { CodexExecutionPreference } from "@veylta/contracts";
import { requireCodexExecutionPreference } from "../codex/codex-execution-profile.js";
import type { Database, DatabaseClient } from "../database/pool.js";

interface PreferenceRow {
  model_id: string;
  document_model_id: string | null;
  reasoning_effort: string;
  document_reasoning_effort: string;
  service_tier: string;
}

export interface CodexPreferencesStore {
  get(): Promise<CodexExecutionPreference>;
  write(
    client: DatabaseClient,
    preference: CodexExecutionPreference,
    actorUserId: string,
    now: Date,
  ): Promise<void>;
}

export function createCodexPreferencesStore(
  database: Database,
  fallback: CodexExecutionPreference,
): CodexPreferencesStore {
  const defaultPreference = requireCodexExecutionPreference(fallback);
  return {
    async get() {
      const row = (
        await database.query<PreferenceRow>(
          `SELECT model_id, document_model_id, reasoning_effort, document_reasoning_effort,
                  service_tier
             FROM codex_preferences WHERE id = 'primary'`,
        )
      ).rows[0];
      return row === undefined
        ? defaultPreference
        : requireCodexExecutionPreference({
            modelId: row.model_id,
            documentModelId: row.document_model_id,
            reasoningEffort: row.reasoning_effort,
            documentReasoningEffort: row.document_reasoning_effort,
            serviceTier: row.service_tier,
          });
    },
    async write(client, preference, actorUserId, now) {
      const value = requireCodexExecutionPreference(preference);
      await client.query(
        `INSERT INTO codex_preferences
           (id, model_id, document_model_id, reasoning_effort, document_reasoning_effort,
            service_tier, updated_by_user_id, created_at, updated_at)
         VALUES ('primary', $1, $7, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (id) DO UPDATE SET
           model_id = excluded.model_id,
           document_model_id = excluded.document_model_id,
           reasoning_effort = excluded.reasoning_effort,
           document_reasoning_effort = excluded.document_reasoning_effort,
           service_tier = excluded.service_tier,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at = excluded.updated_at`,
        [
          value.modelId,
          value.reasoningEffort,
          value.documentReasoningEffort,
          value.serviceTier,
          actorUserId,
          now,
          value.documentModelId,
        ],
      );
    },
  };
}
