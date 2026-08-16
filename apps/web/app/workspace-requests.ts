/**
 * Serialises the reads and mutations of one workspace panel. Reads — the mount load, a
 * background refresh, a user's selection — race freely and only the newest may write state, or
 * a slow earlier response silently reverts what the user just opened. A mutation (create a
 * conversation, send a message) claims a ticket like a read, so reads that started before it are
 * discarded; and a background refresh that would start while a mutation is in flight is deferred
 * until the mutation has settled, so it can never carry a stale selection over the mutation's
 * result. A user's own selection during a mutation still wins: it is a newer intent.
 */
export class WorkspaceRequests {
  private ticket = 0;
  private mutating = false;
  private refreshDeferred = false;

  /** Registers a request; the returned check tells whether it is still the newest one. */
  claim(): () => boolean {
    const ticket = ++this.ticket;
    return () => ticket === this.ticket;
  }

  /** A background refresh may run now, or is deferred until the in-flight mutation settles. */
  requestRefresh(): boolean {
    if (!this.mutating) return true;
    this.refreshDeferred = true;
    return false;
  }

  beginMutation(): () => boolean {
    this.mutating = true;
    return this.claim();
  }

  /** Settles the mutation and reports whether a refresh was deferred meanwhile. */
  endMutation(): { readonly refreshDeferred: boolean } {
    this.mutating = false;
    const refreshDeferred = this.refreshDeferred;
    this.refreshDeferred = false;
    return { refreshDeferred };
  }
}
