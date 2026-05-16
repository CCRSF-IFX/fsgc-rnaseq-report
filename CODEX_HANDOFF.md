# Codex Handoff: Versioned webR Package Snapshots

This note is for any other session working in this repository.

## Goal

`rnaseq-report` hosts the static report and the exact WebAssembly R package
snapshot needed by optional browser-side modules. Delivered HTML files should
point at a versioned package repository URL:

```text
https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/
```

## Current Snapshot

- `webr-packages/VERSION`: `v0.1.0`
- `assets/report_config.json` points `webr.packageRepo` at:

  ```text
  https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/
  ```

- `webr-packages/packages` currently contains:

  ```text
  bioc::DESeq2
  bioc::fgsea
  bioc::S4Vectors
  bioc::IRanges
  bioc::GenomicRanges
  bioc::SummarizedExperiment
  bioc::BiocGenerics
  bioc::Biobase
  bioc::BiocParallel
  bioc::MatrixGenerics
  bioc::Seqinfo
  bioc::S4Arrays
  bioc::DelayedArray
  bioc::SparseArray
  bioc::XVector
  cran::locfit
  ```

- `webr-packages/published_versions` currently lists:

  ```text
  v0.1.0
  ```

## Workflow Behavior

`.github/workflows/deploy-pages.yml`:

- Builds the static site into `_site/`.
- Refuses to overwrite an existing `webr-packages/<VERSION>/.../PACKAGES` URL by
  default.
- Allows deliberate same-version replacement only from manual
  `workflow_dispatch` with `force_overwrite=true`.
- Restores previously published versions listed in
  `webr-packages/published_versions` into `_site/` before deploying.
- Checks out `r-wasm/actions@v2`.
- Reads package refs from `webr-packages/packages` using Bash/`awk`; no
  `Rscript` is required for that parsing step.
- Patches `rwasm::add_pkg()` to use `remotes = NULL`, matching the current
  resolver workaround. The package list explicitly includes DESeq2's
  Bioconductor hard dependency closure; fgsea is added as a browser-side GSEA
  package.
- Builds the current wasm package repo into `_site/webr-packages/${VERSION}/`.
- Writes `_site/webr-packages/${VERSION}/webr-packages-${VERSION}.zip` so users
  can download or mirror the compiled package snapshot.
- Uploads `_site` to GitHub Pages.

## Current Browser Features

- Minimum inputs: `counts.csv` plus a sample metadata file such as
  `sample_manifest.csv`.
- Browser fallbacks compute PCA, sample distances, exploratory Welch-test DE,
  and a Clustergrammer expression heatmap from counts.
- The Clustering tab has a Clustergrammer-JS expression heatmap with metadata
  annotation, row z-score/logCPM scale, and row/column clustering toggles.
  Clustergrammer-JS is loaded from its npm browser bundle at runtime.
- The Differential Expression tab has a basic webR DESeq2 runner for two-group
  contrasts. It supports one primary factor plus optional additive
  covariate/blocking columns from the sample manifest, for example
  `~ batch + sex + condition`. It installs/loads `DESeq2` from the configured
  package snapshot.
- The Sample Metadata tab lets users upload a replacement count matrix plus a
  required sample manifest; uploaded count matrices are refused without matching
  sample metadata.
- The Enrichment tab can run browser-side fgsea from the current DE contrast
  using hg38/mm10 GMT pathway references or a user-uploaded GMT file.
- The Optional Analysis tab shows the configured package repository, can check
  the remote `PACKAGES` index, can install/load configured webR packages, and
  links to the snapshot ZIP.

## Simulated Test Data

`assets/data/simulated/` contains a minimal manifest-driven fixture:

- `sample_manifest.csv`
- `counts.csv`

Validate it with:

```bash
python3 scripts/validate_assets.py assets/data/simulated
```

## Validation Commands

From `/Users/xies4/github/rna_report/rnaseq-report`:

```bash
python3 scripts/validate_assets.py assets/data
python3 scripts/validate_assets.py assets/data/simulated
python3 -m json.tool assets/report_config.json >/dev/null
python3 -m py_compile scripts/validate_assets.py scripts/build_standalone_report.py
node --check assets/js/app.js
node --check assets/js/analysis.js
node --check assets/js/dataLoader.js
node --check assets/js/downstreamPlugins.js
node --check assets/js/deseq2.js
node --check assets/js/fgsea.js
node --check assets/js/heatmap.js
node --check assets/js/packageRepository.js
node --check assets/js/plots.js
node --check assets/js/userData.js
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/deploy-pages.yml"); puts "yaml ok"'
awk '{ gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0); if ($0 == "" || substr($0, 1, 1) == "#") next; if (!seen[$0]++) { if (out != "") out = out ","; out = out $0 } } END { print out }' webr-packages/packages
python3 scripts/build_standalone_report.py
```

Expected package parser output:

```text
bioc::DESeq2,bioc::fgsea,bioc::S4Vectors,bioc::IRanges,bioc::GenomicRanges,bioc::SummarizedExperiment,bioc::BiocGenerics,bioc::Biobase,bioc::BiocParallel,bioc::MatrixGenerics,bioc::Seqinfo,bioc::S4Arrays,bioc::DelayedArray,bioc::SparseArray,bioc::XVector,cran::locfit
```

## Verification URL

After the Pages workflow force-overwrites `v0.1.0`, verify:

```text
https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/bin/emscripten/contrib/4.5/PACKAGES
```

Also verify the package archive:

```text
https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/webr-packages-v0.1.0.zip
```
