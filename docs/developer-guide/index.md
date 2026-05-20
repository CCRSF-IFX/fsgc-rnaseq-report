# Developer Guide

This guide is for maintainers who build, customize, validate, and deploy
RNA-seq reports.

Use this section when you need to:

- prepare an `assets/data/` directory
- validate data files
- build a standalone HTML report
- customize project title, abbreviation, run ID, or logo
- publish the hosted report through GitHub Pages
- manage versioned webR package snapshots and library bundles
- maintain CI workflows

## Common Commands

Preview the development report from a local static server:

```bash
python3 -m http.server 8000
```

Validate report data:

```bash
python3 scripts/validate_assets.py assets/data
```

Build a standalone HTML report:

```bash
python3 scripts/build_report_bundle.py
```

Build from a project-specific data root:

```bash
python3 scripts/build_report_bundle.py --data-root path/to/report-data
```

## Where To Go Next

- Use [Data Assets](data-assets.md) to understand required and optional files.
- Use [Standalone Builds](standalone-builds.md) to create a single deliverable
  HTML report.
- Use [GitHub Pages And Versioning](github-pages.md) to host the report,
  documentation, and webR package snapshots.
- Use [webR Packages](webr-packages.md) when DESeq2 or fgsea package loading
  changes.
