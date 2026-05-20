# Runtime Packages

Optional browser analysis uses webR to run R code inside the browser. Package
availability is managed through a report-scoped WebAssembly package snapshot.

## Runtime Configuration

The webR settings live in `assets/report_config.json` under `webr`.

Important fields include:

- `enabled`: turns browser R features on or off.
- `baseUrl`: the pinned webR runtime URL.
- `packageRepo`: the report package repository URL.
- `packageRepoVersion`: the expected package snapshot version.
- `packageArchiveUrl`: downloadable package repository archive.
- `libraryBundle`: settings for a prebuilt browser-loadable webR library.
- `modules`: per-feature package lists and experimental flags.

The webR runtime URL and package repository must stay compatible. A package
snapshot built for one webR release may fail against another runtime.

## Package Repository

The package repository is built from `webr-packages/packages`. The list includes
DESeq2, fgsea, and the hard dependency closure needed by the browser workflows.

The published repository has the standard webR package path:

```text
webr-packages/<VERSION>/bin/emscripten/contrib/4.5/
```

The app checks the repository `PACKAGES` index before enabling package
installation.

## Library Bundle

The workflow also builds a browser-loadable webR library bundle. Users can mount
that bundle in the report to avoid reinstalling DESeq2, fgsea, and dependencies
during a browser session.

The library bundle release contains:

- `rnaseq-report-webr-library-<VERSION>.zip`
- `rnaseq-report-webr-library-<VERSION>.data.gz`
- `rnaseq-report-webr-library-<VERSION>.js.metadata`

## Build Patches

The workflow applies project-local patches before package compilation:

- `rwasm-c17.mk` supplies C17 compiler settings for `locfit`.
- `prepare_fastmatch_source.py` patches `fastmatch` source before wasm build.

These patches are part of the package snapshot contract and should be reviewed
when upgrading webR, DESeq2, fgsea, or low-level compiled dependencies.
