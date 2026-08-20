import { join } from "node:path";
import { MAX_SYNTHETIC_DOCUMENT_BYTES } from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import type { Database } from "../src/database/pool.js";
import { createDocumentService, type DocumentService } from "../src/documents/document-service.js";
import { registerDocumentRoutes } from "../src/documents/routes.js";
import type { FamilyService } from "../src/family/family-service.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import type { ObjectStorage } from "../src/storage/object-storage.js";
import { createFamilyApp, createTempDatabase, webOrigin } from "./family-app.js";

export interface DocumentAppOptions {
  maxDocumentBytes?: number;
  /** Builds the storage from the storage root, so tests can inject a faulty one. */
  storage?: (storageRoot: string) => ObjectStorage;
}

export interface DocumentTestContext {
  app: FastifyInstance;
  database: Database;
  storageRoot: string;
}

/** Family + document routes over the given database and storage root. */
export function createDocumentApp(
  database: Database,
  storageRoot: string,
  options: DocumentAppOptions = {},
): { app: FastifyInstance; familyService: FamilyService; documentService: DocumentService } {
  const maxDocumentBytes = options.maxDocumentBytes ?? MAX_SYNTHETIC_DOCUMENT_BYTES;
  const storage = (options.storage ?? createLocalObjectStorage)(storageRoot);
  const { app, familyService } = createFamilyApp(database);
  const documentService = createDocumentService(database, storage, { maxDocumentBytes });
  registerDocumentRoutes(app, familyService, documentService, {
    allowedMutationOrigins: [webOrigin],
    maxDocumentBytes,
  });
  return { app, familyService, documentService };
}

/** A migrated temp database, storage root, and document app; cleans up around `operation`. */
export async function withDocumentContext(
  operation: (context: DocumentTestContext) => Promise<void>,
  options: DocumentAppOptions = {},
): Promise<void> {
  const temp = await createTempDatabase();
  const storageRoot = join(temp.root, "storage");
  const { app } = createDocumentApp(temp.database, storageRoot, options);
  try {
    await operation({ app, database: temp.database, storageRoot });
  } finally {
    await app.close();
    await temp.close();
  }
}
