import type { FastifyInstance } from "fastify";
import type { Database } from "../src/database/pool.js";
import { registerProfileHandleRoutes } from "../src/family/profile-handle-routes.js";
import { createMedicalProfileService } from "../src/medical-profile/medical-profile-service.js";
import { registerMedicalProfileRoutes } from "../src/medical-profile/routes.js";
import { createFamilyApp, createTempDatabase, type Identity, webOrigin } from "./family-app.js";

export { type Identity, register, webOrigin } from "./family-app.js";

export function medicalProfilePath(identity: Identity): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}/medical-profile`;
}

/** A migrated temp database and an app with family + medical-profile routes; call `close()` when done. */
export async function startMedicalProfileApp(): Promise<{
  app: FastifyInstance;
  database: Database;
  close: () => Promise<void>;
}> {
  const temp = await createTempDatabase();
  const { app, familyService } = createFamilyApp(temp.database);
  registerProfileHandleRoutes(app, familyService, temp.database, {
    allowedMutationOrigins: [webOrigin],
  });
  registerMedicalProfileRoutes(app, familyService, createMedicalProfileService(temp.database), {
    allowedMutationOrigins: [webOrigin],
  });
  return {
    app,
    database: temp.database,
    close: async () => {
      await app.close();
      await temp.close();
    },
  };
}
