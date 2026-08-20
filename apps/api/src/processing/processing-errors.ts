/** The failures every step of a processing run raises, in one place so any step may import them. */

export class StaleProcessingLeaseError extends Error {
  constructor() {
    super("Processing lease is stale");
    this.name = "StaleProcessingLeaseError";
  }
}

export class InvalidProcessingOutputError extends Error {
  constructor() {
    super("Processing output is invalid");
    this.name = "InvalidProcessingOutputError";
  }
}

export class InvalidProcessingStageTransitionError extends Error {
  constructor() {
    super("Processing stage transition is invalid");
    this.name = "InvalidProcessingStageTransitionError";
  }
}

export class ProcessingPersistenceConflictError extends Error {
  constructor() {
    super("Existing processing output conflicts with this attempt");
    this.name = "ProcessingPersistenceConflictError";
  }
}
