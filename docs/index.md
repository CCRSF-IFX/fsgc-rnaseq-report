# RNA-seq Report

RNA-seq Report is a portable, client-side report viewer for RNA-seq pipeline
outputs. It turns a count matrix, optional sample metadata, and optional
pipeline-generated result files into an interactive browser report that can be
delivered as a single HTML file or hosted from a static web server.

The report is static in deployment but dynamic in the browser. QC plots, sample
tables, PCA, distance matrices, expression heatmaps, differential-expression
tables, and enrichment summaries load client-side. Optional webR modules can run
exploratory DESeq2 and fgsea workflows directly in the browser.

Pipeline-generated statistics should remain the source of truth for production
analysis. Browser analysis is best treated as exploratory, interactive, and
auditable.

## What It Provides

- A static report shell in `index.html`.
- Demo and pipeline-ready assets under `assets/data/`.
- A standalone builder that embeds data, CSS, and JavaScript into one HTML file.
- Optional browser R analysis through webR, DESeq2, and fgsea.
- Versioned webR package snapshots built by GitHub Actions.
- A disabled-by-default AI assistant module that can talk to a local
  OpenAI-compatible proxy when enabled in report config.

## Quick Start

Preview the development report from a local static server:

```bash
python3 -m http.server 8000
```

Open the report at:

```text
http://localhost:8000/
```

Validate report data:

```bash
python3 scripts/validate_assets.py assets/data
```

Build a standalone HTML report:

```bash
python3 scripts/build_report_bundle.py
```

The default output is:

```text
dist/rnaseq-report.html
```

## Repository

The source repository is
[OmicsReportHub/rnaseq-report](https://github.com/OmicsReportHub/rnaseq-report).

## Hosted Documentation

When deployed from GitHub Actions, the documentation is available at:

```text
https://omicsreporthub.github.io/rnaseq-report/docs/latest/
```

Versioned documentation is available under `/docs/vX.Y.Z/`, matching the report
version in `assets/report_config.json`.
