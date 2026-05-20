# Standalone Builds

Standalone builds produce a single HTML file that embeds the report shell,
configuration, and data. This is the easiest delivery format for users who
should not run a local web server.

## Default Build

```bash
python3 scripts/build_report_bundle.py
```

Default output:

```text
dist/rnaseq-report.html
```

`dist/` is ignored by git because reports often contain run-specific data.

Write to a specific output path with:

```bash
python3 scripts/build_report_bundle.py --output path/to/report.html
```

## Build From A Data Directory

```bash
python3 scripts/build_report_bundle.py --data-root path/to/data
```

The data root can be repo-relative or absolute. Files are embedded into the
generated HTML under the report's internal `assets/data/` path.

A standalone report can be built with only a count matrix. A sample manifest is
required before users can run metadata-driven DESeq2 or GSEA. If a recipient
uploads only a manifest, the report uses the embedded count matrix. If a
recipient uploads a new count matrix, they must upload a matching manifest too.

## Branding And Attribution

Common project metadata overrides:

```bash
python3 scripts/build_report_bundle.py \
  --project-title "Study 42 RNA-seq" \
  --project-abbr S42 \
  --run-id "batch-2026-05-16"
```

Report attribution overrides:

```bash
python3 scripts/build_report_bundle.py \
  --report-author "Jane Doe" \
  --report-organization "Example Bioinformatics Core" \
  --report-version "0.2.0"
```

Logo override:

```bash
python3 scripts/build_report_bundle.py --project-logo path/to/logo.svg
```

Supported logo formats include SVG, PNG, JPG, GIF, and WebP.
Relative logo paths resolve from the repository root. The default report
configuration uses `assets/branding/fsgc-rnaseq-report-logo.svg`; pass
`--project-logo` to override that default for one generated report.

Run ID override:

```bash
python3 scripts/build_report_bundle.py --run-id "batch-2026-05-16"
```

By default the run label is empty and hidden.

## Plotly Options

By default, the standalone report loads Plotly from the public CDN to keep the
file smaller:

```bash
python3 scripts/build_report_bundle.py \
  --plotly-url https://cdn.plot.ly/plotly-2.35.2.min.js
```

To produce a larger file that can render Plotly charts without internet access,
inline Plotly:

```bash
python3 scripts/build_report_bundle.py --embed-plotly
```

You can also inline a local Plotly build:

```bash
python3 scripts/build_report_bundle.py --plotly-file path/to/plotly.min.js
```

`--embed-plotly` only inlines Plotly. The Clustergrammer heatmap still loads
Clustergrammer-JS and its browser dependencies from CDN unless those scripts
are vendored and the heatmap loader is updated.

## FSGC RSEM Profile

For FSGC RSEM expected-count matrices, use:

```bash
python3 scripts/build_report_bundle.py \
  --data-root path/to/fsgc-rsem-data \
  --profile fsgc-rsem
```

This profile marks the embedded count matrix as FSGC-format RSEM expected
counts in report configuration and provenance.

## QC Excel Delivery

If the data root contains `qc_metrics.xlsx` or `qc_metrics.xlsm`, the builder
reads the `Summary` sheet and embeds it as JSON. To also embed the original
workbook and show a QC Excel download button:

```bash
python3 scripts/build_report_bundle.py \
  --data-root path/to/data-with-qc-excel \
  --include-qc-excel
```

## Local File Caveats

Core plots and tables are designed to work from a double-clicked standalone
file. Optional webR workflows are more reliable from an `http://` or `https://`
origin because webR uses browser workers and package loading paths that some
browsers restrict on `file://` pages.

When webR is needed, host the standalone HTML with a static server:

```bash
python3 -m http.server 8000
```
