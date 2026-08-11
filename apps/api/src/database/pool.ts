import { Pool } from "pg";

export interface ReadinessProbe {
  check(): Promise<void>;
}

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function databaseReadiness(pool: Pool): ReadinessProbe {
  return {
    async check() {
      await pool.query("SELECT 1");
    },
  };
}
