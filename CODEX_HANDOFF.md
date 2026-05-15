# Codex Handoff: Versioned webR Package Snapshots

This note is for any other session working in this repository.

## Goal

Use the "single report app" architecture: `rnaseq-report` hosts both the static
report and the exact WebAssembly R package snapshot needed by that report.

The report should refer to a versioned package repository URL, so delivered HTML
files can keep using the same package set:

```text
https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/
```

## Current Local Changes

The following logic has been added locally but not committed here:

- `.github/workflows/deploy-pages.yml`
  - Builds the static site into `_site/`.
  - Checks out `r-wasm/actions@v2`.
  - Reads the snapshot version from `webr-packages/VERSION`.
  - Reads package refs from `webr-packages/packages`.
  - Patches `rwasm::add_pkg()` to use `remotes = NULL`, matching the workaround
    used in `webr-bioc-wasm` for the current `pkgdepends/pkgcache` resolver bug.
  - Builds the wasm package repo into
    `_site/webr-packages/${VERSION}/`.
  - Uploads `_site` to GitHub Pages.

- `webr-packages/VERSION`
  - Current value: `v0.1.0`.

- `webr-packages/packages`
  - Current package refs:

    ```text
    bioc::limma
    bioc::edgeR
    ```

- `assets/report_config.json`
  - `webr.packageRepo` now points at:

    ```text
    https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/
    ```

  - `webr.packageRepoVersion` is `v0.1.0`.
  - The DESeq2 webR module is disabled for now because this snapshot only hosts
    `limma` and `edgeR`.

- `assets/js/downstreamPlugins.js`
  - Respects `modules.deseq2.enabled === false`, so the DESeq2 card does not
    appear unless explicitly enabled.

- `scripts/build_standalone_report.py`
  - Existing/dirty local work builds a standalone HTML file and embeds
    `assets/report_config.json`, so the delivered HTML carries the versioned
    package repo URL.

## Validation Already Run

From `/Users/xies4/github/rna_report/rnaseq-report`:

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/deploy-pages.yml"); puts "yaml ok"'
python3 -m json.tool assets/report_config.json >/dev/null
node --check assets/js/downstreamPlugins.js
Rscript --vanilla -e 'pkgs <- unique(trimws(readLines("webr-packages/packages", warn = FALSE))); pkgs <- pkgs[nzchar(pkgs) & !startsWith(pkgs, "#")]; cat(paste(pkgs, collapse = ","), "\n")'
python3 scripts/build_standalone_report.py
```

The generated `dist/rnaseq-report.html` contains the `v0.1.0` package repo URL.

## Important Caveat

This implementation creates a versioned path, but GitHub Pages artifact
deployment replaces the whole published site each run. If `VERSION` is later
changed to `v0.2.0`, the old `v0.1.0` directory will not be preserved unless the
workflow is extended to copy forward prior snapshots or publish snapshots to a
durable artifact store.

For true immutable historical snapshots, use one of these follow-ups:

1. Keep a checked-in `webr-package-snapshots/` archive branch or `gh-pages`
   branch and deploy old plus new snapshots.
2. Publish snapshots to object storage, e.g. S3, Cloudflare R2, GCS, Azure Blob,
   or internal MinIO.
3. Store package snapshots as GitHub Release assets and have report manifests
   reference release URLs.

For the immediate `v0.1.0` report delivery, the current setup is enough: the
HTML points to one explicit snapshot URL and the Pages workflow builds that
snapshot during deployment.

## Suggested Next Step

Run the GitHub Pages workflow in `rnaseq-report`, then verify:

```text
https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/bin/emscripten/contrib/4.5/PACKAGES
```

Only after that should the delivered standalone HTML be treated as pinned to a
working package snapshot.
