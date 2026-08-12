# Third-party notices

Family Health's own source is MIT-licensed. Installed dependencies retain their
own licenses and notices. This file records reviewed obligations that are not
fully represented by the root MIT license; package distributions remain the
authoritative source for complete license text.

## Browser compatibility data

`caniuse-lite` 1.0.30001809 is required transitively by Next.js and distributes
browser compatibility data under CC-BY-4.0. Source and attribution information:
<https://github.com/browserslist/caniuse-lite>. The package's `LICENSE` file is
retained in every installed distribution. Family Health does not modify that
dataset.

## Apache-2.0 and dual-licensed tooling

- `@playwright/test` 1.62.1 — Apache-2.0.
- `typescript` 5.9.3 — Apache-2.0.
- `@biomejs/biome` 2.5.8 and its platform CLI packages — MIT OR Apache-2.0.

Their complete license and NOTICE material is retained in the installed package
distribution. No third-party source is copied into the Family Health codebase.

## Exact permissive ISC reviews

The following unavoidable transitive packages use the permissive ISC license.
They are exact-version exceptions rather than additions to the global allowlist:

- `fastq` 1.20.1 (Fastify/avvio queue utility)
- `picocolors` 1.1.1 (Next.js/PostCSS terminal-color helper)
- `semver` 7.8.5 (Fastify version parser)
- `split2` 4.2.0 (pino stream utility)

Each installed package retains its ISC `LICENSE` file. Any version change fails
the repository license gate until it is reviewed again.

## CI infrastructure

- `actions/checkout` v4 at commit `11d5960a326750d5838078e36cf38b85af677262`
  and `actions/setup-node` v4 at commit
  `49933ea5288caeca8642d1e84afbd3f7d6820020` are MIT-licensed GitHub Actions.

The local database uses the SQLite runtime built into Node.js; it adds no npm
package, container, or vendored source to this repository. Node.js and its
bundled components retain their own upstream licenses.
