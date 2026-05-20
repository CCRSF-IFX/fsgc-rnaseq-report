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
Keeping compiled dependencies such as `fastmatch`, `data.table`, `Rcpp`, and
`Matrix` in the same report snapshot avoids mixing wasm binaries built against
different webR runtimes.

The published repository has the standard webR package path:

```text
webr-packages/<VERSION>/bin/emscripten/contrib/4.5/
```

The app checks the repository `PACKAGES` index before enabling package
installation.

At runtime, the app passes the report snapshot through webR's
`webr_pkg_repos`/`webr::install(..., repos = ...)` path. Setting only the
standard R `repos` option is not enough for webR package installation. The
browser snapshot checker treats the `R` dependency field as the webR runtime
instead of a package that should appear in the wasm package index.

The package refs are parsed from `webr-packages/packages` with Bash and `awk`,
so the GitHub Actions runner does not need `Rscript` for that parsing step. The
package repository build itself is delegated to `r-wasm/actions`.

## Library Bundle

The workflow also builds a browser-loadable webR library bundle. Users can mount
that bundle in the report to avoid reinstalling DESeq2, fgsea, and dependencies
during a browser session.

The library bundle release contains:

- `rnaseq-report-webr-library-<VERSION>.zip`
- `rnaseq-report-webr-library-<VERSION>.data.gz`
- `rnaseq-report-webr-library-<VERSION>.js.metadata`

The bundle release files are uploaded to GitHub Releases rather than GitHub
Pages, so they do not increase the published Pages site size. The report mounts
the library image into webR and prepends it to `.libPaths()`, allowing DESeq2
and fgsea to load without reinstalling the whole dependency closure from the
package repository. This is session-scoped browser state; users should mount
the bundle again after reloading the page unless persistent browser storage is
added later.

The package snapshot archive is also published as a GitHub Release asset:

```text
rnaseq-report-webr-packages-<VERSION>.zip
```

That archive can be downloaded and mirrored as a static wasm package
repository. If the repository is mirrored elsewhere, update
`assets/report_config.json` before building the standalone HTML.

## Browser Snapshot Recovery

When the report opens, it checks the configured `PACKAGES` index before
enabling package installation. If the snapshot cannot be reached, the report
keeps package installation disabled and offers recovery actions:

- Download the webR library bundle.
- Choose the downloaded bundle.
- Continue in report-only mode.
- Retry the online package snapshot.

If the user selects "don't show again", that choice is stored in browser
`localStorage` for that report and package/library snapshot version.

## Build Patches

The workflow applies project-local patches before package compilation:

- `rwasm-c17.mk` supplies C17 compiler settings for `locfit`.
- `prepare_fastmatch_source.py` patches `fastmatch` source before wasm build.

These patches are part of the package snapshot contract and should be reviewed
when upgrading webR, DESeq2, fgsea, or low-level compiled dependencies.

The Pages workflow verifies that every package listed in `webr-packages/packages`
appears in the generated wasm `PACKAGES` index before publishing. It also checks
the built `fastmatch.so` wasm imports against the pinned webR runtime ABI, which
catches strict-linking failures before deployment.

## Updating A Snapshot

When the optional R package set changes:

1. Choose a new immutable version, for example `v0.2.0`, or deliberately keep
   the same version and deploy manually with `force_overwrite=true`.
2. Update `webr-packages/VERSION`.
3. Update `webr-packages/packages`.
4. Update `assets/report_config.json` so `packageRepo`,
   `packageRepoVersion`, and `packageArchiveUrl` match the package snapshot.
5. Update `webr.libraryBundle.version`, `archiveFile`, `releaseTag`, and
   `releaseUrl` when the browser-loadable library bundle artifact changes.
6. Enable or disable optional modules in `assets/report_config.json` to match
   the available packages.
7. Add previously published versions that must remain available to
   `webr-packages/published_versions`.
8. Run validation before pushing.

Package snapshots are overwrite-protected by default. Use
`force_overwrite=true` only for an intentional replacement.
