# RNA-seq Report

A static, portable RNA-seq report application for pipeline outputs. The minimum
inputs are a count matrix and a sample manifest. From those, the browser can
compute PCA coordinates, a sample-distance matrix, an expression heatmap, and
exploratory two-group differential expression, then visualize the results
without running a backend server.

Precomputed pipeline outputs are still preferred when available. If files such
as `pca.json`, `sample_distance_matrix.json`, or differential-expression CSVs
are present, the report displays those instead of recomputing them.

Optional browser-side R analysis is available through a small plugin layer. The
default optional backend is webR, intended only for small exploratory analyses.
The report can install/load DESeq2 from the configured wasm package snapshot and
run a basic two-group DESeq2 contrast in the browser. For production statistics,
keep DESeq2 or another mature RNA-seq method in the pipeline and export the
final results into this report.

## Repository Contents

- `index.html` - modular static report shell for development and hosted use.
- `assets/css/` - report styling.
- `assets/js/` - data loading, count-derived analysis, plotting, tables, tab wiring, and optional webR managers.
- `assets/data/` - demo report data assets.
- `assets/report_config.json` - report title, data root, analysis settings, QC thresholds, and webR package configuration.
- `schemas/` - documented JSON structures.
- `scripts/validate_assets.py` - lightweight asset validator.
- `scripts/build_standalone_report.py` - builds a double-clickable single-file HTML report.
- `webr-packages/` - versioned package snapshot definition for optional webR modules.
- `.github/workflows/deploy-pages.yml` - GitHub Pages deployment plus report-scoped webR package repo build.

## Local Preview

Use a local static server while developing:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Do not rely on double-clicking `index.html`. Browsers commonly block local
`fetch()` calls and JavaScript modules from `file://` pages.

## End-User Delivery

For users who should not run a local server, build a single HTML file:

```bash
python3 scripts/build_standalone_report.py
```

Send the generated file:

```text
dist/rnaseq-report.html
```

That file embeds the report data, CSS, and application JavaScript. By default it
still loads Plotly from the public CDN, which keeps the file small.

The standalone file also keeps the configured webR and package-repository URLs.
Users can run the browser DESeq2 module when the browser can reach those URLs.
The Optional Analysis tab includes install/load controls and a link to download
the compiled package snapshot ZIP.

For a larger report that can render plots without internet access, inline Plotly:

```bash
python3 scripts/build_standalone_report.py --embed-plotly
```

`--embed-plotly` only inlines Plotly. The Clustergrammer heatmap still loads
Clustergrammer-JS and its browser dependencies from CDN unless you vendor those
scripts and update `assets/js/heatmap.js`.

Useful builder options:

```bash
python3 scripts/build_standalone_report.py --output path/to/report.html
python3 scripts/build_standalone_report.py --plotly-file path/to/plotly.min.js
python3 scripts/build_standalone_report.py --plotly-url https://cdn.plot.ly/plotly-2.35.2.min.js
```

`dist/` is ignored by git because generated report files can contain run-specific
data.

## GitHub Pages

This repository is configured to publish with GitHub Actions:

1. Push to `main` or `master`, or run the workflow manually.
2. In repository settings, set Pages source to **GitHub Actions**.
3. The workflow builds a deployable `_site/` directory.
4. The workflow builds the configured webR package set into `_site/webr-packages/<VERSION>/`.
5. The workflow writes `_site/webr-packages/<VERSION>/webr-packages-<VERSION>.zip`.
6. The workflow uploads `_site/` to GitHub Pages.

The current report config points to:

```text
https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/
```

The workflow reads package refs from `webr-packages/packages` using Bash/`awk`.
It does not require `Rscript` to be present on the runner for that parsing step.
The actual package repo build is delegated to `r-wasm/actions`.

The package list includes DESeq2 plus the Bioconductor hard dependency closure
that is not available from the default webR package repository. This keeps the
snapshot focused while still making `library(DESeq2)` loadable in webR.
At runtime, the app passes the report snapshot through webR's
`webr_pkg_repos`/`webr::install(..., repos = ...)` path; setting only the
standard R `repos` option is not enough for webR package installation.
The browser snapshot checker treats the `R` dependency field as the webR runtime
instead of a package that should appear in the wasm package index.
The workflow also appends the project-local
`webr-packages/patches/rwasm-c17.mk` override before building packages so
`locfit`, a DESeq2 import that requires C17, compiles with Emscripten instead
of the host C compiler.

Package snapshots are overwrite-protected by default. If
`webr-packages/<VERSION>/bin/emscripten/contrib/4.5/PACKAGES` already exists on
GitHub Pages, normal pushes fail. To intentionally replace an existing snapshot,
run the workflow manually and set `force_overwrite=true`.

The current package set intentionally reuses `v0.1.0`, so deployment must be a
manual workflow run with `force_overwrite=true`.

Previously published snapshots listed in `webr-packages/published_versions` are
restored into `_site/` before deploying, so older report HTML files can keep
using their pinned package URLs.

## Data Model

The smallest useful report needs:

```text
assets/
  report_config.json
  data/
    sample_manifest.csv
    counts.csv
```

The sample manifest may be any one of these files:

```text
samples.json
sample_manifest.csv
sample_manifest.tsv
samples.csv
samples.tsv
```

The report checks those names in that order. To use a different manifest name,
set it in `assets/report_config.json`:

```json
{
  "sampleManifest": "metadata/my_samples.tsv"
}
```

`sampleManifest` is resolved relative to `dataRoot`.

With those two data files, the report derives:

- PCA coordinates from log2(CPM + 1) expression.
- sample distances from log2(CPM + 1) expression.
- a Clustergrammer expression heatmap with metadata annotation and row/column clustering toggles.
- two-group differential expression from metadata-defined contrasts.

For production reports, the pipeline can also export precomputed assets. When
present, these files override browser-computed fallbacks:

```text
assets/
  report_config.json
  data/
    samples.json OR sample_manifest.csv
    qc_metrics.json
    pca.json
    sample_distance_matrix.json
    counts.csv
    gene_annotation.json
    contrast_list.json
    differential_expression/
      treated_vs_control.csv
    enrichment/
      treated_vs_control_go.csv
    logs/
      software_versions.json
      pipeline_provenance.json
```

Conventions:

- `sample_id` is the primary key for sample-level files.
- The sample manifest must include `sample_id`; analysis group columns such as `condition`, `treatment`, `batch`, and `sex` are preserved as metadata.
- `counts.csv` must include at least one gene identifier column, such as `gene_id`, `gene_symbol`, or `gene_name`.
- Count matrix sample columns must match `sample_id` values in the sample manifest.
- `gene_id` and `gene_symbol` identify gene-level records.
- DE tables should include `gene_id`, `gene_symbol`, `log2FoldChange`, `pvalue`, and `padj`.
- Count matrices are expected in wide CSV format with gene columns first and one column per sample.

Browser-generated contrasts use `analysis.conditionColumn` from
`assets/report_config.json`. If it is not set, the report uses `condition` when
available, otherwise the first metadata column with at least two groups.

Validate assets with:

```bash
python3 scripts/validate_assets.py assets/data
```

## Simulated Test Data

The repo includes a manifest-driven test fixture:

```text
assets/data/simulated/
  sample_manifest.csv
  counts.csv
```

It contains eight simulated samples split by `condition`, `batch`, and `sex`.
Validate it with:

```bash
python3 scripts/validate_assets.py assets/data/simulated
```

## Optional webR Modules

webR is lazy-loaded only when a user opens optional downstream analysis and runs
a module that needs R packages. The package repository is configured in
`assets/report_config.json`:

```json
{
  "analysis": {
    "conditionColumn": "condition",
    "referenceLevel": "control"
  },
  "webr": {
    "enabled": true,
    "baseUrl": "https://webr.r-wasm.org/latest/",
    "packageRepo": "https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/",
    "packageRepoVersion": "v0.1.0",
    "modules": {
      "deseq2": {
        "enabled": true,
        "packages": ["DESeq2"],
        "memoryWarning": "high",
        "experimental": true
      }
    }
  }
}
```

The built-in browser DE fallback uses Welch t-tests on log2(CPM + 1) values and
Benjamini-Hochberg adjusted p-values. Treat those results as exploratory. Use
pipeline-generated DESeq2 or another mature RNA-seq method for final analysis.

The current package snapshot includes:

```text
bioc::DESeq2
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

DESeq2 is the only R package enabled in the optional-analysis UI. The
Differential Expression tab has a browser DESeq2 runner for two-group contrasts.
The Clustering tab has a Clustergrammer-JS heatmap using the count matrix, with
row z-score or log2(CPM + 1) scale, sample annotation, and row/column clustering
controls. Clustergrammer-JS is loaded from the npm package bundle at runtime so
the development app and generated standalone HTML can stay build-free.

The Pages workflow verifies that every package listed above appears in the
generated wasm `PACKAGES` index before publishing the snapshot.

Each deployed snapshot also exposes a ZIP archive:

```text
https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/webr-packages-v0.1.0.zip
```

That archive can be downloaded and mirrored as a static wasm package repository.
The report still installs packages through webR from `webr.packageRepo`; if you
mirror the package repository elsewhere, update `assets/report_config.json`
before building the standalone HTML.

## Updating The webR Snapshot

When the optional R package set changes:

1. Choose a new immutable version, for example `v0.2.0`, or deliberately keep the same version and deploy manually with `force_overwrite=true`.
2. Update `webr-packages/VERSION`.
3. Update `webr-packages/packages`.
4. Update `assets/report_config.json` so `packageRepo` and `packageRepoVersion` match the new version.
5. Enable or disable optional modules in `assets/report_config.json` to match the available packages.
6. Add previously published versions that must remain available to `webr-packages/published_versions`.
7. Run the validation checklist below.
8. Push to trigger the Pages workflow.

By default, the workflow refuses to overwrite an existing package snapshot. For
a deliberate replacement, run the workflow manually with `force_overwrite=true`.

## Validation Checklist

Run these before pushing workflow or report changes:

```bash
python3 scripts/validate_assets.py assets/data
python3 -m json.tool assets/report_config.json >/dev/null
python3 -m py_compile scripts/build_standalone_report.py
node --check assets/js/app.js
node --check assets/js/analysis.js
node --check assets/js/dataLoader.js
node --check assets/js/downstreamPlugins.js
node --check assets/js/deseq2.js
node --check assets/js/heatmap.js
node --check assets/js/packageRepository.js
node --check assets/js/plots.js
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/deploy-pages.yml"); puts "yaml ok"'
awk '{ gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0); if ($0 == "" || substr($0, 1, 1) == "#") next; if (!seen[$0]++) { if (out != "") out = out ","; out = out $0 } } END { print out }' webr-packages/packages
python3 scripts/build_standalone_report.py
```

Expected package parser output for the current repo:

```text
bioc::DESeq2,bioc::S4Vectors,bioc::IRanges,bioc::GenomicRanges,bioc::SummarizedExperiment,bioc::BiocGenerics,bioc::Biobase,bioc::BiocParallel,bioc::MatrixGenerics,bioc::Seqinfo,bioc::S4Arrays,bioc::DelayedArray,bioc::SparseArray,bioc::XVector,cran::locfit
```

## Troubleshooting

If GitHub Actions reports `Rscript: command not found`, make sure the workflow
contains the Bash package parser in `Retrieve webR package refs`. Older workflow
versions used `shell: Rscript {0}` for that step.

If `index.html` loads locally but data fetches fail, run
`python3 -m http.server 8000` and open `http://localhost:8000/`.

If a delivered standalone report opens but plots do not appear, rebuild with
`--embed-plotly` or confirm the user's browser can reach the configured Plotly
CDN URL.

## Security And Privacy

Do not publish patient identifiers, protected health information,
controlled-access genomes, or licensed annotation files to public GitHub Pages.
Keep published demo data synthetic or de-identified.

## Adding A New Report Tab

1. Add a tab button and panel in `index.html`.
2. Add loader code in `assets/js/dataLoader.js` if new files are needed.
3. Add rendering logic in `assets/js/plots.js` or a new module.
4. Wire the tab in `assets/js/app.js`.
5. Document expected input schema in `schemas/`.
6. Regenerate the standalone report and rerun validation.
