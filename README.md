# RNA-seq Report

RNA-seq Report is a portable, browser-based report viewer for bulk RNA-seq
pipeline outputs. It can be delivered as a single HTML file or hosted from a
static web server. Core views run client-side, and optional browser workflows
can use webR for exploratory DESeq2 and fgsea analysis.

## Documentation

The documentation is split by audience:

- [User Guide](docs/user-guide/index.md): for people who receive or open an
  HTML report. Start here for opening the report, loading sample metadata,
  reviewing QC/PCA/heatmaps, running DESeq2/GSEA, and saving browser analysis
  results.
- [Developer Guide](docs/developer-guide/index.md): for maintainers who build,
  customize, validate, and deploy reports. Start here for data assets,
  standalone builds, GitHub Pages, webR package snapshots, and CI workflows.
- [Reference](docs/ref.md): quick links to important project files and external
  documentation.

Hosted documentation is published by GitHub Actions when Pages is configured to
use **GitHub Actions** as the source:

```text
https://ccrsf-ifx.github.io/fsgc-rnaseq-report/docs/latest/
https://ccrsf-ifx.github.io/fsgc-rnaseq-report/docs/v0.1.0/
```

## Common Commands

Preview the development report:

```bash
python3 -m http.server 8000
```

Validate bundled data:

```bash
python3 scripts/validate_assets.py assets/data
```

Build a standalone HTML report:

```bash
python3 scripts/build_report_bundle.py
```

Build the documentation locally:

```bash
mkdocs build --strict
```

## Repository

- Source: <https://github.com/CCRSF-IFX/fsgc-rnaseq-report>
- Hosted report: <https://ccrsf-ifx.github.io/fsgc-rnaseq-report/>
- Hosted docs: <https://ccrsf-ifx.github.io/fsgc-rnaseq-report/docs/latest/>
