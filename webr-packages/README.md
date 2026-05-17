# webR Package Snapshot

This directory defines the report-scoped WebAssembly R package repository built
with the GitHub Pages workflow.

- `VERSION` is the immutable snapshot path published under
  `webr-packages/<VERSION>/`.
- `packages` contains package references for `rwasm::add_pkg()`.
- `patches/` contains project-local Makevars overrides installed into the
  rwasm build environment before package compilation.
- `published_versions` lists old snapshots that should be preserved during
  future deploys.

When package contents change, create a new version instead of overwriting an
existing report snapshot. The Pages workflow blocks overwrites by default, but
manual workflow runs can set `force_overwrite=true` when a same-version
replacement is intentional.

Each deployment also writes a downloadable package-repository archive as a
GitHub Release asset:

```text
webr-packages-<VERSION>.zip
```

The archive contains the compiled `bin/emscripten/contrib/4.5` package index and
artifacts for users who want to mirror or inspect the wasm package snapshot.

The workflow also builds a browser-loadable webR library image from the package
snapshot and uploads it to the separate GitHub Release configured by
`webr.libraryBundle.releaseTag`. The package snapshot version and library bundle
version are intentionally decoupled:

```text
rnaseq-report-webr-library-<LIBRARY_VERSION>.zip
rnaseq-report-webr-library-<LIBRARY_VERSION>.data.gz
rnaseq-report-webr-library-<LIBRARY_VERSION>.js.metadata
```

The report UI can mount the ZIP, or the `.data.gz` plus `.js.metadata` pair, as
a local webR library. That path avoids reinstalling DESeq2, fgsea, and their
dependencies from the package repository during the current browser session.
