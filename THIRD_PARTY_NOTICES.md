# Third-party notices

Veylta's own source is MIT-licensed. Installed dependencies retain their
own licenses and notices. This file records reviewed obligations that are not
fully represented by the root MIT license; package distributions remain the
authoritative source for complete license text.

## Browser compatibility data

`caniuse-lite` 1.0.30001809 is required transitively by Next.js and distributes
browser compatibility data under CC-BY-4.0. Source and attribution information:
<https://github.com/browserslist/caniuse-lite>. The package's `LICENSE` file is
retained in every installed distribution. Veylta does not modify that
dataset.

## Apache-2.0 and dual-licensed tooling

- `@playwright/test` 1.62.1 — Apache-2.0.
- `pdfjs-dist` 6.2.108 — Apache-2.0; used only for local bounded PDF text-layer
  extraction and bounded rendered-page input for local synthetic-PDF OCR.
- `tesseract.js` 7.0.0 and `tesseract.js-core` 7.0.0 — Apache-2.0; used only in
  the API/worker for bounded local recognition of image-only synthetic PDFs.
  The application supplies the package's fixed local model path and no provider
  URL; its install script is disabled by pnpm policy.
- `typescript` 5.9.3 — Apache-2.0.
- `@biomejs/biome` 2.5.8 and its platform CLI packages — MIT OR Apache-2.0.
- `@aws-sdk/client-s3` 3.1098.0 and its modular AWS SDK v3 dependencies —
  Apache-2.0; used only by the optional server-side S3-compatible
  `ObjectStorage/v1` adapter. It is not bundled into the browser and introduces
  no provider credentials, bucket, or medical fixture into the repository.

`@tesseract.js-data/eng` 1.0.0 is MIT-licensed English trained data used by the
local OCR worker. `@napi-rs/canvas` 1.0.5 is MIT-licensed and renders the
bounded local page image. Both remain server/worker-only package dependencies;
the repository does not copy their model or native-binary contents.

Their complete license and NOTICE material is retained in the installed package
distribution. No third-party source is copied into the Veylta codebase.

## Synthetic PDF fixture font notice

`fixtures/veylta-synthetic-lab-report.pdf` is a synthetic-only test fixture,
not a real medical document. It embeds a subset of Liberation Sans Regular.
Liberation Sans is licensed under SIL Open Font License 1.1. The complete font
license and its copyright notices are retained at
[`fixtures/licenses/liberation-sans-license.txt`](fixtures/licenses/liberation-sans-license.txt).

This is a reviewed, artifact-specific asset notice rather than a general
dependency allowlist change: the PDF is a document created using the font, the
font binary is not distributed separately, and the fixture's SHA-256 is
`8c6147e28880f3d9fe0161a3affd586604627c561bb519da0155e4e3914c88cb`.
Review owner: Veylta maintainers. Re-review on fixture/font replacement or by
2027-08-12, whichever comes first.

## Browser interface font

`@fontsource-variable/geist` 5.2.9 packages the Geist variable font used by the
Veylta browser interface under SIL Open Font License 1.1. The font is
self-hosted by the application; no Google Fonts or other font CDN request is
made. The package's complete OFL license and copyright material remain in its
installed distribution. This is an exact-version asset review and does not add
OFL-1.1 to the global software allowlist. Re-review on font or package version
change or by 2027-08-14.

## Exact permissive ISC reviews

The following unavoidable transitive packages use the permissive ISC license.
They are exact-version exceptions rather than additions to the global allowlist:

- `fastq` 1.20.1 (Fastify/avvio queue utility)
- `picocolors` 1.1.1 (Next.js/PostCSS terminal-color helper)
- `semver` 7.8.5 (Fastify version parser)
- `split2` 4.2.0 (pino stream utility)
- `lucide-react` 1.21.0 (browser UI icon components)

Each installed package retains its ISC `LICENSE` file. Any version change fails
the repository license gate until it is reviewed again.

## CI infrastructure

- `actions/checkout` v4 at commit `11d5960a326750d5838078e36cf38b85af677262`
  and `actions/setup-node` v4 at commit
  `49933ea5288caeca8642d1e84afbd3f7d6820020` are MIT-licensed GitHub Actions.

The local database uses the SQLite runtime built into Node.js; it adds no npm
package, container, or vendored source to this repository. Node.js and its
bundled components retain their own upstream licenses.
