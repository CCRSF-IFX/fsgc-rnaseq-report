# webR Package Snapshot

This directory defines the versioned WebAssembly R package snapshot used by the
RNA-seq Report optional webR modules. The snapshot lets the browser load DESeq2,
fgsea, and their dependencies without relying on whatever package versions are
available from a generic public repository at runtime.

GitHub Actions builds this snapshot with `r-wasm/actions` during the Pages
deployment workflow. The resulting wasm package repository is published under
`webr-packages/<VERSION>/` on GitHub Pages and is consumed by webR in the
browser.

## Files

- `VERSION` is the immutable snapshot name published under
  `webr-packages/<VERSION>/`.
- `packages` lists the Bioconductor and CRAN package refs passed to
  `rwasm::add_pkg()`.
- `patches/` contains project-local build patches installed into the rwasm
  environment before package compilation.
- `published_versions` lists older snapshots that should remain available when
  the Pages site is rebuilt.

## Runtime Contract

The package snapshot must match the webR runtime configured in
`assets/report_config.json`. The Pages workflow pins `webr-image` to the same
webR release so packages are compiled against the runtime that the browser loads.

The report checks the snapshot `PACKAGES` index before enabling browser-side
package installation. If the online package repository is unavailable, users can
still mount the prebuilt webR library bundle described below.

## Published Artifacts

Each successful deployment publishes three related artifacts:

- A GitHub Pages package repository at
  `webr-packages/<VERSION>/bin/emscripten/contrib/4.5/`.
- A downloadable package-repository archive attached to the
  `rnaseq-report-webr-packages-<VERSION>` GitHub Release:

```text
rnaseq-report-webr-packages-<VERSION>.zip
```

- A browser-loadable webR library bundle attached to the release configured by
  `webr.libraryBundle.releaseTag`:

```text
rnaseq-report-webr-library-<VERSION>.zip
rnaseq-report-webr-library-<VERSION>.data.gz
rnaseq-report-webr-library-<VERSION>.js.metadata
```

The report UI presents the package repository and the prebuilt library bundle as
the same package/library snapshot version. Users can mount the ZIP, or the
`.data.gz` plus `.js.metadata` pair, as a local webR library. That path avoids
reinstalling DESeq2, fgsea, and their dependencies from the package repository
during the current browser session.

## Versioning Rules

Treat snapshot versions as immutable. When package contents change, choose a new
`VERSION`, update `assets/report_config.json`, and publish a new package/library
snapshot. The Pages workflow refuses to overwrite an existing snapshot by
default.

For a deliberate same-version replacement, run the workflow manually and set
`force_overwrite=true`. Use that only when the replacement is intentional,
because existing standalone reports may already point at the old snapshot URL.

When a snapshot must remain available for older reports, add its version to
`published_versions`. The workflow restores those packages into `_site/` before
deploying the new Pages build.

## Build Notes

The workflow applies two local compatibility patches before package compilation:

- `patches/rwasm-c17.mk` adds the C17 compiler setting required by `locfit`, a
  DESeq2 dependency, under Emscripten.
- `patches/prepare_fastmatch_source.py` prepares a patched `fastmatch` source
  tree so dummy native-registration calls do not create invalid wasm imports.

After the build, the workflow verifies that every package listed in `packages`
appears in the generated `PACKAGES` index and checks the built `fastmatch.so`
imports against the pinned webR runtime ABI.
