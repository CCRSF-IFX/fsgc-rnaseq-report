# RNA-seq Report

RNA-seq Report is a portable, client-side report viewer for RNA-seq pipeline
outputs. It turns a count matrix, optional sample metadata, and optional
pipeline-generated result files into an interactive browser report that can be
delivered as a single HTML file or hosted on a static web server.

The tool is designed for sequencing facilities and analysis teams that need a
shareable report without running a backend service. It is static in deployment
but dynamic in the browser: QC plots, sample tables, PCA, distance matrices,
expression heatmaps, differential-expression tables, and enrichment summaries
load and update client-side. Optional webR modules run exploratory DESeq2 and
fgsea analyses in the browser.
Pipeline-generated statistics should remain the source of truth for production
analysis.

## What It Does

- Builds from a count matrix alone, then infers sample IDs from count columns.
- Uses a sample manifest, when present, to drive metadata-aware PCA controls,
  heatmap annotations, DESeq2 contrasts, and fgsea setup.
- Displays precomputed pipeline outputs when available, including `pca.json`,
  `sample_distance_matrix.json`, differential-expression CSVs, enrichment CSVs,
  QC metrics, provenance, and software-version logs.
- Computes useful browser fallbacks from counts, including PCA coordinates,
  sample distances, gene-level count summaries, and Clustergrammer heatmaps.
- Bundles the report into a standalone HTML artifact for delivery to users who
  should not run a local server.
- Publishes a hosted report and versioned webR package snapshots through GitHub
  Actions and GitHub Pages.

## Architecture & Build Pipeline

The report has three main layers:

- **Client-side report application**: `index.html`, `assets/css/`, and `assets/js/`
  provide the browser UI, data loading, plotting, tables, tab wiring, user file
  uploads, and standalone-report behavior.
- **Browser R runtime**: optional downstream modules run through
  [webR](https://docs.r-wasm.org/webr/), which brings R into the browser by
  compiling the R runtime and package binaries to WebAssembly. The app currently
  uses webR for exploratory DESeq2 and fgsea workflows.
- **Package snapshot build**: `.github/workflows/deploy-pages.yml` uses
  `r-wasm/actions` to build the configured R packages and dependencies as a
  report-scoped WebAssembly package repository. The workflow publishes that
  repository under `webr-packages/<VERSION>/` and uploads release assets for
  users who need to mirror the repository or mount a prebuilt webR library
  bundle.

The webR runtime URL in `assets/report_config.json` and the workflow
`webr-image` are pinned to the same webR release so the browser runtime and the
compiled package binaries stay compatible.

## Quick Start

Preview the development report from a local static server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Do not rely on double-clicking `index.html`. Browsers commonly block local
`fetch()` calls and JavaScript modules from `file://` pages.

Validate the bundled demo assets:

```bash
python3 scripts/validate_assets.py assets/data
```

Build a shareable standalone report:

```bash
python3 scripts/build_report_bundle.py
```

The default output is:

```text
dist/rnaseq-report.html
```

`dist/` is ignored by git because generated reports can contain run-specific
data.

## Repository Layout

- `index.html` - modular browser report shell for development and hosted use.
- `assets/css/` - report styling.
- `assets/js/` - data loading, count-derived analysis, plotting, tables, tab
  wiring, user uploads, analysis cache, and optional webR managers.
- `assets/data/` - demo report data assets.
- `assets/report_config.json` - report title, data root, analysis settings, QC
  thresholds, and webR package configuration.
- `schemas/` - documented JSON structures for pipeline-produced assets.
- `scripts/validate_assets.py` - lightweight asset validator.
- `scripts/build_report_bundle.py` - standalone HTML report builder.
- `scripts/qc_excel.py` - helper for converting supported QC Excel summaries
  into report-ready metrics during standalone builds.
- `webr-packages/` - versioned webR/WebAssembly package snapshot definition.
- `.github/workflows/deploy-pages.yml` - GitHub Pages deployment and webR
  package build workflow.

## Standalone Report Delivery

For users who should not run a local server, build a single HTML file and
deliver the generated artifact:

```bash
python3 scripts/build_report_bundle.py
```

The generated artifact is:

```text
dist/rnaseq-report.html
```

The standalone file embeds report data, CSS, and application JavaScript. By
default it still loads Plotly from the public CDN, which keeps the file smaller.
For a larger report that can render Plotly charts without internet access,
inline Plotly:

```bash
python3 scripts/build_report_bundle.py --embed-plotly
```

`--embed-plotly` only inlines Plotly. The Clustergrammer heatmap still loads
Clustergrammer-JS and its browser dependencies from CDN unless you vendor those
scripts and update `assets/js/heatmap.js`.

The standalone file also keeps the configured webR and package-repository URLs.
Users can run the browser DESeq2 and fgsea modules when the browser can reach
those URLs. The Optional Analysis tab includes install/load controls and a link
to download the compiled package snapshot ZIP. Core plots and tables are
designed to work from a double-clicked standalone file, but webR creates browser
workers and is most reliable from an `http://` or `https://` origin. If a
browser blocks webR from a local `file://` page, host the same HTML on GitHub
Pages or another static web server before running DESeq2 or fgsea.

Users can also replace or augment the embedded defaults in the Sample Metadata
tab. The standalone report can be built with only a count matrix, but a sample
manifest is required before users run metadata-driven DESeq2 or fgsea. If a user
uploads only a manifest, the app uses the embedded count matrix. If a user
uploads a new count matrix, it must be uploaded with a matching manifest because
DESeq2, PCA coloring, heatmap annotations, and fgsea contrast setup all depend
on sample-level metadata.

Common builder options:

```bash
python3 scripts/build_report_bundle.py --data-root path/to/data
python3 scripts/build_report_bundle.py --project-title "Study 42 RNA-seq" --project-abbr S42 --run-id "batch-2026-05-16"
python3 scripts/build_report_bundle.py --project-logo path/to/logo.svg
python3 scripts/build_report_bundle.py --report-author "Jane Doe" --report-organization "Example Bioinformatics Core"
python3 scripts/build_report_bundle.py --report-version "0.2.0"
python3 scripts/build_report_bundle.py --data-root path/to/fsgc-rsem-data --profile fsgc-rsem
python3 scripts/build_report_bundle.py --data-root path/to/data-with-qc-excel --include-qc-excel
python3 scripts/build_report_bundle.py --output path/to/report.html
python3 scripts/build_report_bundle.py --plotly-file path/to/plotly.min.js
python3 scripts/build_report_bundle.py --plotly-url https://cdn.plot.ly/plotly-2.35.2.min.js
```

`--data-root` lets you build a standalone report from a specific data directory
without editing `assets/report_config.json`. The directory can be repo-relative
or absolute, and its files are embedded into the generated HTML under the
report's internal `assets/data/` path. If that directory contains
`qc_metrics.xlsx`, the builder reads the `Summary` sheet and embeds it as
`qc_metrics.json` in the generated HTML. Add `--include-qc-excel` to also embed
the original `qc_metrics.xlsx` or `qc_metrics.xlsm` workbook and show a download
button in the QC tab. When this flag is used, the Excel `Summary` sheet also
overwrites the embedded `qc_metrics.json` content for that standalone build.

`--project-title` overrides the title shown in the browser tab, sidebar, and
report header for that generated HTML. `--project-abbr` or
`--project-abbreviation` overrides the short label in the sidebar brand mark.
`--project-logo`, `--report-logo`, or `--logo` embeds a local image file as a
data URI and uses it instead of the short sidebar brand mark for that generated
HTML. Relative logo paths resolve from the repo root; PNG, SVG, JPG, GIF, and
WebP are supported. The default report configuration uses
`assets/branding/fsgc-rnaseq-report-logo.svg`; pass `--project-logo` to override
that default for a specific build.
`--run-id` overrides the run label shown under the project title; by default
that label is empty and hidden. `--report-author`, `--report-organization`, and
`--report-version` override the attribution and report template version shown in
the header, overview, and provenance table.
`--profile fsgc-rsem` marks the embedded count matrix as FSGC-format RSEM
expected counts in the generated report config and provenance. Use it for FSGC
RSEM outputs where the count matrix may store gene symbols inside `gene_id`
values such as `ENSG00000004777.18_ARHGAP33`.

The AI Assistant is disabled by default in `assets/report_config.json`. When
enabled there, it calls an OpenAI-compatible local endpoint such as the
`openai-oauth` proxy at `http://127.0.0.1:10531/v1`. OAuth tokens stay in the
separately running local proxy, not in the report HTML.

## Publish With GitHub Pages

This repository is configured to publish the hosted report with GitHub Actions:

1. Push to `main` or `master`, or run the workflow manually.
2. In repository settings, set Pages source to **GitHub Actions**.
3. The workflow builds a deployable `_site/` directory.
4. The workflow builds the configured webR package set into `_site/webr-packages/<VERSION>/`.
5. The workflow writes `rnaseq-report-webr-packages-<VERSION>.zip` as a GitHub Release asset instead of storing that duplicate archive on Pages.
6. The workflow builds a browser-loadable webR library bundle and uploads it to a separate release tag from `webr.libraryBundle.releaseTag`.
7. The workflow uploads `_site/` to GitHub Pages.

The current report config points to:

```text
https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/
```

The workflow reads package refs from `webr-packages/packages` using Bash/`awk`.
It does not require `Rscript` to be present on the runner for that parsing step.
The package repository build is delegated to `r-wasm/actions`.

The package list includes DESeq2, fgsea, and their hard dependency closure.
This keeps compiled wasm dependencies in the same snapshot as the top-level
Bioconductor packages, which avoids ABI mismatches when packages such as
`fastmatch` or `data.table` are loaded by fgsea.

At runtime, the app passes the report snapshot through webR's
`webr_pkg_repos`/`webr::install(..., repos = ...)` path; setting only the
standard R `repos` option is not enough for webR package installation.
The browser snapshot checker treats the `R` dependency field as the webR runtime
instead of a package that should appear in the wasm package index.
The workflow also appends the project-local
`webr-packages/patches/rwasm-c17.mk` override before building packages so
`locfit`, a DESeq2 import that requires C17, compiles with Emscripten instead
of the host C compiler.
The workflow also prepares a patched `fastmatch` source tree before building
the package snapshot. The CRAN source includes dummy no-prototype calls to
`R_registerRoutines()` and `R_useDynamicSymbols()` that create invalid wasm
imports under webR; the patch makes that dummy file inert.

Package snapshots are overwrite-protected by default. If
`webr-packages/<VERSION>/bin/emscripten/contrib/4.5/PACKAGES` already exists on
GitHub Pages, normal pushes fail. To intentionally replace an existing snapshot,
run the workflow manually and set `force_overwrite=true`.

The current package set intentionally reuses `v0.1.0`, so deployment must be a
manual workflow run with `force_overwrite=true`.

Previously published snapshots listed in `webr-packages/published_versions` are
restored into `_site/` before deploying, so older report HTML files can keep
using their pinned package URLs.

The library bundle release files are not added to GitHub Pages, so they do not
increase the published Pages site size. They are intended for users who need to
load a prebuilt package library from a local file instead of downloading and
installing every `.tgz` package in the browser session.
The user-facing package and browser-loadable library snapshot version is the same:
`webr-packages/VERSION` and `webr.packageRepoVersion` identify the package/library
snapshot. `webr.libraryBundle.version` is used for the browser-loadable library
release asset names and should normally match that package/library snapshot.

## Data Model

The smallest buildable report needs:

```text
assets/
  report_config.json
  data/
    counts.csv OR counts.tsv
```

With `counts.csv` or `counts.tsv` alone, the report infers `sample_id` values
from numeric count columns and can render count-derived PCA, sample distances,
and expression heatmaps. The report checks `counts.csv` first, then
`counts.tsv`. To use a different count-matrix path, set `countMatrix` or
`countsFile` in `assets/report_config.json`. Add a sample manifest to enable
metadata annotations, PCA color/shape controls, browser-generated DE contrasts,
DESeq2, and fgsea.

The optional sample manifest may be any one of these files:

```text
samples.json
sample_manifest.csv
sample_manifest.tsv
samples.csv
samples.tsv
```

The report checks those names in that order. If none is present, it falls back
to inferred sample IDs from the count matrix. To use a different manifest name,
set it in `assets/report_config.json`:

```json
{
  "sampleManifest": "metadata/my_samples.tsv"
}
```

`sampleManifest` is resolved relative to `dataRoot`. A configured
`sampleManifest` is treated as required, which is useful when a production
report should fail the build if metadata is missing.

With counts and a manifest, the report derives:

- PCA coordinates from log2(CPM + 1) expression.
- sample distances from log2(CPM + 1) expression.
- gene-level count plots with sample bar plots and grouped box plots, including optional split-by metadata, when metadata has at least two levels.
- a Clustergrammer expression heatmap with top-variable or custom gene-list selection, metadata annotation, and clustered rows/columns.
- two-group differential expression from metadata-defined contrasts.
- optional fgsea results from the selected DE contrast and uploaded GMT pathway files.

The PCA view supports one metadata column as color and, when more than one
metadata factor is available, a second metadata column as marker shape. The
legend separates color and shape guides to avoid listing every combination.
Extra metadata columns remain available in hover labels and tables rather than
being forced into additional visual encodings.

For production reports, the pipeline can also export precomputed assets. When
present, these files override browser-computed fallbacks:

```text
assets/
  report_config.json
  data/
    samples.json OR sample_manifest.csv
    qc_metrics.json OR qc_metrics.csv OR qc_metrics.tsv OR qc_metrics.xlsx
    pca.json
    sample_distance_matrix.json
    counts.csv OR counts.tsv
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
- If a sample manifest is supplied, it must include `sample_id`; metadata values are preserved as strings so IDs like `001` and timepoint labels like `6h` remain intact.
- The report infers a metadata schema for each sample column and lets the user override it in Data Setup. Primary DE factors should be `categorical` or `ordered`; optional adjustment/blocking terms can also be `continuous`. Identifier columns such as `sample_id`, `donor_id`, and `pair_id` are excluded from model controls unless reclassified.
- `counts.csv` or `counts.tsv` must include at least one gene identifier column, such as `gene_id`, `gene_symbol`, or `gene_name`.
- Count matrix sample columns must match `sample_id` values when a sample manifest is supplied. Without a manifest, sample IDs are inferred from numeric count columns.
- Count values must be nonnegative numeric values. Fractional expected counts from tools such as RSEM are accepted; browser summaries use them as numeric counts and the DESeq2 webR runner rounds them to integers immediately before creating the DESeq2 dataset.
- `gene_id` and `gene_symbol` identify gene-level records.
- DE tables should include `gene_id`, `gene_symbol`, `log2FoldChange`, `pvalue`, and `padj`.
- Count matrices are expected in wide CSV format with gene columns first and one column per sample.
- Browser fgsea uses `gene_symbol` when available, otherwise `gene_id`, so pathway GMT identifiers must match one of those columns.

Browser-generated contrasts require a sample manifest. They use
`analysis.conditionColumn` from `assets/report_config.json`. If it is not set,
the report uses `condition` when available, otherwise the first categorical or
ordered metadata column with at least two groups.

QC metrics can use canonical report fields or the Excel-style headers from the
pipeline summary. For browser-hosted assets, use JSON/CSV/TSV. For standalone
HTML builds, `qc_metrics.xlsx` is also supported; the builder reads the
`Summary` worksheet. Supported summary headers include:

```text
Sample ID
Sample Yield (Mbases)
Percent of (PF) Bases >= Q30
Total Reads (PF)
Total Reads After Trimming
Percent Total Reads after Trimming
Total Mapped Reads (Trimmed)
Percent Total Mapped Reads (Trimmed)
Uniquely Mapped Reads (Trimmed)
Percent Uniquely Mapped Reads (Trimmed)
Percent Non-duplicate Reads (Mapped Trimmed)
PCT_RIBOSOMAL_BASES
PCT_CODING_BASES
PCT_UTR_BASES
PCT_INTRONIC_BASES
PCT_INTERGENIC_BASES
PCT_MRNA_BASES
PCT_CORRECT_STRAND_READS
MEDIAN_5PRIME_TO_3PRIME_BIAS
```

Percent-style values may be written as `95.74`, `95.74%`, or `0.9574`; the app
normalizes them to fractions for plots and threshold checks.

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

## Public GEO Demo Data

The repo also includes a human multi-factor public dataset fixture:

```text
assets/data/gse164073/
  sample_manifest.csv
  counts.csv
  gene_annotation.json
```

GSE164073 profiles human cornea, limbus, and sclera cells after mock or
SARS-CoV-2 infection. It is useful for testing PCA color/shape controls,
Clustergrammer heatmaps, and DESeq2 with `condition` as the primary factor and
`tissue` as an optional adjustment/blocking factor.

Regenerate and validate it with:

```bash
python3 scripts/download_gse164073_demo.py
python3 scripts/validate_assets.py assets/data/gse164073
```

Build a single-file report from this dataset with:

```bash
python3 scripts/build_report_bundle.py --data-root assets/data/gse164073 --output dist/gse164073-report.html
```

## Optional webR Modules

webR is lazy-loaded only when a user opens optional downstream analysis and runs
a module that needs R packages. The package repository is configured in
`assets/report_config.json`; the package arrays are abbreviated in this example
because the actual config lists the full dependency closure:

When a report is opened directly from `file://`, the app applies a small worker
URL compatibility shim for current webR builds. If the browser still blocks
worker or package loading from a local file, open the same report from an
`http://` or `https://` URL before using DESeq2 or fgsea. The non-webR report
views remain usable from the standalone file.

```json
{
  "reportVersion": "0.1.0",
  "reportAuthor": "FSGC Bioinformatics Group",
  "reportOrganization": "Frederick Sequencing and Genomics Core",
  "analysis": {
    "conditionColumn": "condition",
    "referenceLevel": "control"
  },
  "ai": {
    "enabled": false,
    "provider": "openai-oauth-local",
    "baseUrl": "http://127.0.0.1:10531/v1",
    "model": "",
    "maxTokens": 900
  },
  "webr": {
    "enabled": true,
    "baseUrl": "https://webr.r-wasm.org/v0.5.9/",
    "packageRepo": "https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/",
    "packageRepoVersion": "v0.1.0",
    "packageArchiveUrl": "https://github.com/omicsreporthub/rnaseq-report/releases/download/rnaseq-report-webr-packages-v0.1.0/rnaseq-report-webr-packages-v0.1.0.zip",
    "libraryBundle": {
      "enabled": true,
      "version": "v0.1.0",
      "artifactStem": "rnaseq-report-webr-library",
      "archiveFile": "rnaseq-report-webr-library-v0.1.0.zip",
      "releaseTag": "rnaseq-report-webr-library-v0.1.0",
      "releaseUrl": "https://github.com/omicsreporthub/rnaseq-report/releases/tag/rnaseq-report-webr-library-v0.1.0"
    },
    "modules": {
      "deseq2": {
        "enabled": true,
        "packages": ["DESeq2"],
        "memoryWarning": "high",
        "experimental": true
      },
      "fgsea": {
        "enabled": true,
        "packages": ["fgsea"],
        "memoryWarning": "medium",
        "experimental": true
      }
    }
  }
}
```

`analysis.referenceLevel` sets the default denominator in the browser DESeq2
question builder. For each browser-run contrast, the selected denominator is
used as the DESeq2 reference level.

The built-in browser DE fallback uses Welch t-tests on log2(CPM + 1) values and
Benjamini-Hochberg adjusted p-values. Treat those results as exploratory. Use
pipeline-generated DESeq2 or another mature RNA-seq method for final analysis.

The browser DESeq2 runner uses a biological question builder. The default path
is a simple two-level comparison, with interaction and LRT workflows tucked
behind the `Advanced: interaction / LRT` question type. It supports:

- condition effects within all samples or a selected metadata subset
- tissue/factor effects within all samples or a selected metadata subset
- additive covariate-adjusted factor effects
- direct comparisons between two combined metadata groups
- advanced pairwise interaction effects, such as asking whether a treatment response
  differs between two tissue or genotype levels
- advanced omnibus interaction likelihood-ratio tests, such as asking whether adding
  `condition:tissue` improves the model over an additive model

The default condition workflow automatically uses `condition` when it exists,
and also recognizes condition-like columns such as `group`, `treatment`, and
`phenotype`. If none of those columns are present, the report keeps the simple
workflow visible but shows a guide asking the user to choose the primary factor
manually.

For subset-aware condition or tissue effects, the app first selects the sample
scope, then runs a simple additive DESeq2 model on the selected samples. For
example, choosing `condition` as the primary factor inside a `tissue = liver`
scope with `batch` plus `sex` adjustment columns runs a model equivalent to:

```r
~ batch + sex + condition
```

Direct group comparisons create a temporary combined group factor from two
metadata columns, such as `condition` and `tissue`, then compare two selected
combined groups. This is useful for explicit comparisons such as treated liver
vs control brain, but it can mix condition and tissue effects; use it only when
those combined groups are the intended biological contrast.

For paired designs, choose the treatment/group column as the primary factor and
mark the subject or pair ID column as `categorical` before selecting it as an
adjustment/blocking column.

Pairwise interactions use a model equivalent to:

```r
~ batch + condition + tissue + condition:tissue
```

with the selected condition denominator and modifier denominator releveled as
the references. The reported `log2FoldChange` is the interaction coefficient:
the condition effect in modifier level A minus the same condition effect in the
reference modifier level.

Omnibus interaction LRT uses a full model and a reduced model:

```r
full    <- ~ batch + condition + tissue + condition:tissue
reduced <- ~ batch + condition + tissue
```

The LRT `pvalue` and `padj` columns test whether the interaction terms improve
the model. The `log2FoldChange` column in an LRT result is representative output
from DESeq2 and should not be interpreted as the omnibus effect size.

For time-series metadata, keep raw values in the manifest. Numeric columns named
`time`, `dose`, `RIN`, or `age` are inferred as continuous covariates, while
labels such as `0h`, `6h`, and `24h` are inferred as ordered timepoints. Users
can override either interpretation before running DESeq2.

### GSEA Ranking

Browser fgsea runs use the selected DE contrast as a preranked gene list. The
ranking input is built from the full in-memory DE result, not from the filtered
table under the volcano plot.

Gene identifiers are matched by `gene_symbol` when available; otherwise the
report falls back to `gene_id`. If duplicate gene identifiers are present, the
gene with the largest absolute ranking statistic is retained before fgsea is
called.

The ranking statistic is chosen as follows:

- If the DE table has a finite `statistic` column, fgsea uses that value
  directly. Browser-run DESeq2 produces the Wald statistic in this column.
- If no finite `statistic` values are available, the report falls back to
  `sign(log2FoldChange) * -log10(pvalue)`.
- If `pvalue` is unavailable for the fallback, `padj` is used.
- True zero p-values are replaced with a tiny floor below the smallest positive
  p-value in the DE table, so they rank as very strong evidence instead of zero.
- Missing, non-numeric, or negative p-values are excluded from the fallback
  ranked list.

### Browser Analysis Cache

The **Methods & Export** tab can export a JSON analysis cache after browser-side
DESeq2 or fgsea runs. The cache includes:

- sample metadata rows when a manifest is available
- analysis scopes used for browser-run DESeq2
- browser-generated DESeq2 result tables
- browser-generated fgsea result sets, including the configured top-N pathway enrichment-curve data when available
- contrast/model metadata needed to repopulate grouped selectors and explain each result

If the browser shows **"Changes you made may not be saved."**, it means
browser-run DESeq2/GSEA results are still only in the current tab. Stay on the
page, go to **Methods & Export**, select **Export cache**, and save the
`.analysis-cache.*.json` file. Reopen the report later and use **Load cache**
from the same tab to restore those results.

When a cache is loaded, sample metadata is restored only if its `sample_id`
values match the current count matrix. The cache intentionally does not include
uploaded count matrices, GMT files, or webR packages; users should keep those
input files separately and mount or reinstall packages in a fresh browser
session when needed.

The configured package snapshot definition includes DESeq2, fgsea, and their
hard dependency closure. Keeping compiled dependencies such as `fastmatch`,
`data.table`, `Rcpp`, and `Matrix` in the same report snapshot avoids mixing
wasm binaries built against different webR runtimes.

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
cran::BH
cran::Matrix
cran::R6
cran::RColorBrewer
cran::Rcpp
cran::RcppArmadillo
cran::S7
cran::abind
cran::cli
cran::codetools
cran::cowplot
cran::cpp11
cran::data.table
cran::farver
cran::fastmatch
cran::formatR
cran::futile.logger
cran::futile.options
cran::generics
cran::ggplot2
cran::glue
cran::gtable
cran::isoband
cran::labeling
cran::lambda.r
cran::lattice
cran::lifecycle
cran::locfit
cran::matrixStats
cran::rlang
cran::scales
cran::snow
cran::vctrs
cran::viridisLite
cran::withr
```

DESeq2 and fgsea are enabled in the optional-analysis UI. The
Differential Expression tab has a browser DESeq2 runner for two-group contrasts,
and the GSEA tab can run one or more fgsea analyses from the selected DE contrast.
Users can upload multiple GMT files and switch between the resulting GSEA result
sets in the GSEA tab. Uploaded GMT gene identifiers should match the DE table
`gene_symbol` or `gene_id` values.

The Clustering tab has a Clustergrammer-JS heatmap using the count matrix, with
row z-score or log2(CPM + 1) scale, sample annotation, and clustered rows/columns.
Users can show the default top variable genes or paste a custom list
of gene IDs, symbols, or names for a focused expression heatmap. Clustergrammer-JS
is loaded from the npm package bundle at runtime so the development app and
generated standalone HTML can stay build-free.

The Pages workflow verifies that every package listed above appears in the
generated wasm `PACKAGES` index before publishing the snapshot. It also checks
the built `fastmatch.so` wasm imports against the pinned webR runtime ABI, which
catches strict-linking failures before deployment.

At runtime, the report automatically checks the configured `PACKAGES` index
before enabling Install/load packages. If the snapshot cannot be reached, the
report shows the failure in Runtime & Packages and keeps package installation
disabled until the snapshot is available or a local webR library bundle is
mounted. The first snapshot failure also opens a recovery modal with actions to
download `rnaseq-report-webr-library-v0.1.0.zip`, choose the downloaded
bundle, continue in report-only mode, or retry the online snapshot. If the user
selects "don't show again", that choice is stored in browser `localStorage` for
that report and package/library snapshot version.

Each deployed snapshot also exposes a ZIP archive as a GitHub Release asset:

```text
https://github.com/omicsreporthub/rnaseq-report/releases/download/rnaseq-report-webr-packages-v0.1.0/rnaseq-report-webr-packages-v0.1.0.zip
```

That archive can be downloaded and mirrored as a static wasm package repository.
The report still installs packages through webR from `webr.packageRepo`; if you
mirror the package repository elsewhere, update `assets/report_config.json`
before building the standalone HTML.

The workflow also publishes a prebuilt webR library bundle to a separate GitHub
Release. The report presents this as part of the same package/library snapshot
version configured by `webr.packageRepoVersion`. The bundle release assets use
`webr.libraryBundle.version`, which should normally match the same snapshot
version:

```text
rnaseq-report-webr-library-v0.1.0.zip
rnaseq-report-webr-library-v0.1.0.data.gz
rnaseq-report-webr-library-v0.1.0.js.metadata
```

Users can download `rnaseq-report-webr-library-v0.1.0.zip`, open the
report, go to **Optional Analysis**, choose the bundle, and click **Mount
bundle**. The report mounts the library image into webR and prepends it to
`.libPaths()`, so DESeq2 and fgsea can be loaded without reinstalling the whole
dependency closure from the package repository. This is session-scoped browser
state; the user should load the bundle again after reloading the page unless
persistent browser storage is added later.

## Updating The webR Snapshot

When the optional R package set changes:

1. Choose a new immutable version, for example `v0.2.0`, or deliberately keep the same version and deploy manually with `force_overwrite=true`.
2. Update `webr-packages/VERSION`.
3. Update `webr-packages/packages`.
4. Update `assets/report_config.json` so `packageRepo`, `packageRepoVersion`, and `packageArchiveUrl` match the new package snapshot version.
5. Update `webr.libraryBundle.version`, `archiveFile`, `releaseTag`, and `releaseUrl` only when the browser-loadable library bundle artifact itself changes.
6. Enable or disable optional modules in `assets/report_config.json` to match the available packages.
7. Add previously published versions that must remain available to `webr-packages/published_versions`.
8. Run the validation checklist below.
9. Push to trigger the Pages workflow.

By default, the workflow refuses to overwrite an existing package snapshot. For
a deliberate replacement, run the workflow manually with `force_overwrite=true`.

## Validation Checklist

Run these before pushing workflow or report changes:

```bash
python3 scripts/validate_assets.py assets/data
python3 -m json.tool assets/report_config.json >/dev/null
python3 -m py_compile scripts/build_report_bundle.py scripts/validate_assets.py scripts/qc_excel.py
node --check assets/js/app.js
node --check assets/js/analysis.js
node --check assets/js/aiAssistant.js
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
python3 scripts/build_report_bundle.py
```

Expected package parser output for the current repo:

```text
bioc::DESeq2,bioc::fgsea,bioc::S4Vectors,bioc::IRanges,bioc::GenomicRanges,bioc::SummarizedExperiment,bioc::BiocGenerics,bioc::Biobase,bioc::BiocParallel,bioc::MatrixGenerics,bioc::Seqinfo,bioc::S4Arrays,bioc::DelayedArray,bioc::SparseArray,bioc::XVector,cran::BH,cran::Matrix,cran::R6,cran::RColorBrewer,cran::Rcpp,cran::RcppArmadillo,cran::S7,cran::abind,cran::cli,cran::codetools,cran::cowplot,cran::cpp11,cran::data.table,cran::farver,cran::fastmatch,cran::formatR,cran::futile.logger,cran::futile.options,cran::generics,cran::ggplot2,cran::glue,cran::gtable,cran::isoband,cran::labeling,cran::lambda.r,cran::lattice,cran::lifecycle,cran::locfit,cran::matrixStats,cran::rlang,cran::scales,cran::snow,cran::vctrs,cran::viridisLite,cran::withr
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
