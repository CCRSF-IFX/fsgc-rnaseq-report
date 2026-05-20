# RNA-seq Report Documentation

RNA-seq Report is a portable, client-side report viewer for RNA-seq pipeline
outputs. It turns a count matrix, optional sample metadata, and optional
pipeline-generated result files into an interactive browser report that can be
delivered as a single HTML file or hosted from a static web server.

This documentation is split by audience.

## I Received An HTML Report

Start with the [User Guide](user-guide/index.md). It explains how to open the
report, add sample metadata, inspect QC/PCA/heatmaps, run optional DESeq2 and
GSEA workflows, and save browser-generated analysis results.

The user guide assumes you do not need to run Python, GitHub Actions, or build
tools.

## I Build Or Maintain Reports

Start with the [Developer Guide](developer-guide/index.md). It covers the
repository layout, data asset schema, standalone HTML builds, GitHub Pages,
versioned webR package snapshots, CI workflows, and release operations.

The developer guide assumes you can run command-line tools and edit repository
configuration.

## Hosted Documentation

When deployed from GitHub Actions, documentation is available at:

```text
https://ccrsf-ifx.github.io/fsgc-rnaseq-report/docs/latest/
```

Versioned documentation is available under `/docs/vX.Y.Z/`, matching the report
version in `assets/report_config.json`.

## Repository

The source repository is
[CCRSF-IFX/fsgc-rnaseq-report](https://github.com/CCRSF-IFX/fsgc-rnaseq-report).
