# License policy

## Project license

Original Veylta code and documentation are released under the root MIT
license: `Copyright (c) 2026 Veylta contributors`.

The MIT license for this repository does not automatically make dependencies,
container images, model weights, OCR trained data, fixtures, fonts, or external
services MIT-licensed. Each is reviewed under its own terms before use.

The checked-in synthetic PDF fixture embeds a reviewed subset of Liberation
Sans Regular under SIL OFL 1.1. The browser UI also installs the exact
`@fontsource-variable/geist` 5.2.9 package under OFL-1.1. Both reviews, their
distribution scopes, and retained notices are recorded in
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). OFL is not added to the
global software allowlist; a font package or version change fails closed.

## Dependency allowlist

Runtime, development, direct, optional, and transitive software dependencies
must resolve to one of these SPDX licenses:

- `MIT`
- `BSD-2-Clause`
- `BSD-3-Clause`
- `Apache-2.0`
- `0BSD`

Apache-2.0 and other permitted packages retain all required copyright,
attribution, and NOTICE material. Required notices are recorded in a generated
inventory and, where necessary, `THIRD_PARTY_NOTICES.md`.

License expressions, exceptions, dual licensing, custom licenses, missing or
`UNKNOWN` metadata, and packages outside the allowlist fail closed and require a
documented review before merge. A transitive package is not exempt.

The runnable scaffold records narrow exact-version reviews in
`config/license-policy.json` and `THIRD_PARTY_NOTICES.md`. These currently cover
permissive ISC utilities required by the runtime and UI, the exact OFL browser
font, plus the CC-BY-4.0 `caniuse-lite` browser-compatibility dataset required by
Next.js. They are not global allowlist additions; removal or a version change
invalidates the exception. Optional `sharp`/libvips and `lightningcss` are
explicitly excluded because their LGPL/MPL licenses cross the core boundary.

Local persistence uses the SQLite runtime bundled with Node.js through
`node:sqlite`; it adds no npm dependency, container image, or vendored database
source to the repository. Node.js and its bundled components retain their own
upstream licenses and must be inventoried with the distributed runtime. They do
not become MIT-licensed merely because the project source is MIT-licensed.

## Prohibited core inclusion

- Do not copy, translate, adapt, link, bundle, vendor, or derive core code from
  GPL or AGPL projects, including Fasten or wger.
- Do not add GPL/AGPL/copyleft packages or code to the monorepo because they are
  convenient implementation references.
- Do not copy their fixtures, schemas, migrations, assets, or UI unless a
  separate provenance/license review explicitly permits that particular work.
- Weak-copyleft, source-available, non-commercial, research-only, custom, and
  unlicensed material is rejected by default pending written review.

A copyleft system may be considered later only as a separately deployed external
service through an API, after a specific legal and architectural review. It is
not included in the default local runtime or core distribution.

## Provider and data boundary

LLM, OCR, and cloud storage integrations use independent adapters. The optional
S3-compatible adapter uses exact `@aws-sdk/client-s3` 3.1098.0 (Apache-2.0),
reviewed through the lockfile gate and third-party notice. It uses the SDK only
on the API/worker server and never exposes its client or provider credentials to
the browser. Before adding or changing a provider integration, review separately:

- client SDK and transitive dependencies;
- hosted service terms and data-use/privacy terms;
- model weights and inference/runtime license;
- OCR engine, trained-data/language packs, and redistribution terms;
- container base image and included operating-system packages;
- sample documents, fonts, icons, and other assets.

The implemented local synthetic PDF/image OCR boundary uses exact
`tesseract.js` 7.0.0 and `tesseract.js-core` 7.0.0 (Apache-2.0), the exact
`@tesseract.js-data/eng` 1.0.0 trained-data package (MIT), and
`@napi-rs/canvas` 1.0.5 (MIT). They are server/worker-only, use a locked local
English model path, and are recorded in `THIRD_PARTY_NOTICES.md`; no model file
is copied into this repository. `tesseract.js` install scripts are explicitly
disabled through pnpm's `allowBuilds` policy. Any engine, language package,
runtime binary, model, or version change needs a fresh exact-version review.
LLM and external OCR providers remain absent.

## Review workflow

Before adding or upgrading a dependency:

1. Confirm that existing platform/runtime code cannot solve the need simply.
2. Record package name, exact version, purpose, source, SPDX expression, and
   transitive tree.
3. Inspect the authoritative license and included NOTICE files, not package
   metadata alone.
4. Verify lockfile output with the repository license checker.
5. Add required attribution/NOTICE content without altering its terms.
6. Run security/provenance checks and document any approved exception.
7. Merge only when CI is green and the reviewer can reproduce the inventory.

The scaffold task must implement `pnpm license:check` against the lockfile. CI
must fail on prohibited, unknown, missing, or unreviewed licenses and detect
changes to the third-party inventory.

## Source provenance

- Contributors certify that changes are original or compatible with MIT
  distribution and identify incorporated third-party material.
- Do not paste code from a repository, answer, article, or generated output when
  provenance/license compatibility cannot be established.
- Architectural inspiration and public API interoperability do not authorize
  copying an implementation.

## Medical data and repository contents

Real user medical files and values are not licensable project fixtures and must
never be committed, added to public tests, sent to telemetry, or included in
screenshots/build artifacts. All examples are conspicuously synthetic and free
of real identities, secrets, or provider credentials.

## Exceptions

There is no informal exception. A proposed exception must be documented with
the exact artifact/version, distribution/linkage/deployment model, obligations,
risk owner, counsel or authorized review where appropriate, and expiry/review
date. Until approved, CI and maintainers treat it as prohibited.
