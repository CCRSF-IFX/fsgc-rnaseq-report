# Report Architecture

RNA-seq Report is organized as a browser application plus build-time helpers.
There is no required backend service for viewing a finished report.

## Main Layers

### Client Report Application

`index.html`, `assets/css/`, and `assets/js/` provide the report shell, styling,
data loading, plots, tables, tab routing, file upload handling, analysis cache,
and standalone-report behavior.

The app reads configuration from `assets/report_config.json` and report data
from the configured `dataRoot`, usually `assets/data`.

### Report Data Assets

Pipeline outputs are represented as CSV, TSV, JSON, or supported QC Excel
inputs. The report can also compute browser fallbacks from a count matrix when
precomputed PCA or distance data are absent.

Important data categories include:

- Count matrix: `counts.csv` or `counts.tsv`.
- Sample metadata: `samples.json`, `sample_manifest.csv`, or TSV equivalents.
- Optional QC metrics: `qc_metrics.json`, CSV, TSV, `qc_metrics.xlsx`, or
  `qc_metrics.xlsm`.
- Optional precomputed results: PCA, sample distance matrix, differential
  expression tables, enrichment tables, provenance, and software versions.

### Standalone Builder

`scripts/build_report_bundle.py` creates a single HTML artifact for report
delivery. The builder embeds the selected data root, CSS, JavaScript, and report
configuration. Plotly can be loaded from CDN or embedded into the generated
file.

### Browser R Runtime

Optional downstream modules use [webR](https://docs.r-wasm.org/webr/) to run R
inside the browser through WebAssembly. The app currently uses this for
exploratory DESeq2 and fgsea workflows.

### Package Snapshot Workflow

The Pages workflow builds a report-scoped WebAssembly package repository from
`webr-packages/packages`. The package snapshot version is stored in
`webr-packages/VERSION` and referenced by `assets/report_config.json`.

Keeping the webR runtime and compiled package snapshot pinned together avoids
runtime ABI mismatches in the browser.

## Development Principle

The repository keeps report rendering, data validation, standalone bundling, and
webR package snapshot management separate. That separation makes it possible to
ship a static report without forcing every user to install Python, R, or a local
service.
