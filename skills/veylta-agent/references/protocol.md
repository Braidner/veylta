# Veylta agent protocol v1

The PWA publishes an allowlisted command under
`agent/commands/queued/<uuid>.json`. The loopback bridge moves one command to
`leased`, and the Codex worker receives the command plus a raw lease token over
an authenticated loopback request. Only the token digest is written to the
synchronized vault.

Supported commands:

- `scan_unprocessed`: inspect portable document manifests and propose explicit
  checksum-bound analysis commands;
- `analyze_document`: read exactly the document selected by `profileId`,
  `documentId`, and `sourceSha256`, then create a new immutable run.

The worker must not accept a path from a command, mutate an original, replace a
previous run, write credentials to the vault, or turn a proposal into a
confirmed observation. Unknown command types and contract versions fail closed.

The bridge binds only to `127.0.0.1`, rejects requests carrying a browser
`Origin`, uses a random bearer token kept in `~/.veylta-agent/bridge.json`, and
caps JSON bodies at 16 KiB. It does not expose a network listener or cloud
webhook.

Completion outcomes are `completed` or `failed`. A failure contains one safe
uppercase code such as `SOURCE_CHECKSUM_MISMATCH`; never store source values,
document text, prompt text, stack traces, or model responses in the queue record.
