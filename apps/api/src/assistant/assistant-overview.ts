import type {
  AssistantId,
  AssistantUrgencyTier,
  ProfileOverviewAssistant,
} from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
import type { ProfileScope } from "../family/profile-access.js";

interface LastAnswerRow {
  assistant_id: string;
  created_at: string;
  urgency_tier: string | null;
  refused: number;
}

/**
 * The newest answer of each room of this profile. It deliberately never reads `answer_json`: the
 * overview says that a room answered and how urgent it called the picture, never what it said.
 */
const lastAnswerSql = `SELECT c.assistant_id,
                m.created_at,
                m.urgency_tier,
                CASE WHEN m.refusal_reason IS NULL THEN 0 ELSE 1 END AS refused
           FROM assistant_messages m
           JOIN assistant_conversations c
             ON c.family_id = m.family_id AND c.id = m.conversation_id
          WHERE m.family_id = $1
            AND c.patient_profile_id = $2
            AND m.role = 'assistant'
            AND NOT EXISTS (
              SELECT 1
                FROM assistant_messages later
                JOIN assistant_conversations lc
                  ON lc.family_id = later.family_id AND lc.id = later.conversation_id
               WHERE later.family_id = m.family_id
                 AND lc.patient_profile_id = c.patient_profile_id
                 AND lc.assistant_id = c.assistant_id
                 AND later.role = 'assistant'
                 AND (later.created_at > m.created_at
                      OR (later.created_at = m.created_at AND later.rowid > m.rowid))
            )
          ORDER BY m.created_at DESC, c.assistant_id`;

/** One entry per assistant room that has ever answered about this person, newest answer first. */
export async function assistantOverviewSummaries(
  client: Pick<DatabaseClient, "query">,
  scope: ProfileScope,
): Promise<ProfileOverviewAssistant[]> {
  const rows = await client.query<LastAnswerRow>(lastAnswerSql, [scope.familyId, scope.profileId]);
  return rows.rows.map((row) => ({
    assistantId: row.assistant_id as AssistantId,
    answeredAt: row.created_at,
    urgency: row.urgency_tier as AssistantUrgencyTier | null,
    refused: row.refused === 1,
  }));
}
