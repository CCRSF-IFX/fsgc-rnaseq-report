# RNA-seq Report

A static, portable RNA-seq report application for pipeline outputs. The core report is based on precomputed JSON/CSV assets, so users can view PCA, hierarchical clustering, sample QC, differential expression, enrichment, and gene-level summaries without running a backend server.

Optional browser-side analysis is supported through a plugin layer. The default optional backend is webR, intended for small exploratory analyses only. Production differential expression should remain in the pipeline, with results exported into this report.

## Repository role

This repository contains the report application:

- `index.html` - static report shell
- `assets/js/` - report logic and optional analysis managers
- `assets/data/` - demo report assets
- `schemas/` - documented JSON structures
- `scripts/validate_assets.py` - simple asset validator
- `.github/workflows/deploy-pages.yml` - GitHub Pages deployment, including the report-scoped webR package snapshot
- `webr-packages/` - versioned WebAssembly R package set for optional webR modules

## Quick start

For development, open locally from a static web server:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Do not rely on double-clicking `index.html`; browsers often block `fetch()` and JavaScript modules from local files.

For end-user delivery, build a double-clickable single-file report:

```bash
python scripts/build_standalone_report.py
```

Send the generated `dist/rnaseq-report.html` file. It embeds the report data, CSS, and application JavaScript, so recipients do not need to run a local web server. By default, the file still loads Plotly from the public CDN. To make a larger fully offline file, run:

```bash
python scripts/build_standalone_report.py --embed-plotly
```

## Create and push this repo

From the parent folder containing `rnaseq-report/`:

```bash
ORG=OmicsReportHub

git -C rnaseq-report init
git -C rnaseq-report add .
git -C rnaseq-report commit -m "Initial RNA-seq report app"

gh repo create "$ORG/rnaseq-report" --public --source=rnaseq-report --push
```

For a private repository, replace `--public` with `--private`.

## GitHub Pages

To publish the demo report using GitHub Pages:

1. Push this repository to GitHub.
2. Go to repository **Settings > Pages**.
3. Under **Build and deployment**, set source to **GitHub Actions**.
4. Push to `main` or run the workflow manually.

The workflow builds the static report into `_site/`, then builds the configured
webR package set into a versioned snapshot path:

```text
https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/
```

The report config points to that immutable package repository URL, so standalone
HTML files generated from this repo keep using the same package snapshot.

## Data model

The pipeline should generate a report folder with this structure:

```text
assets/
  report_config.json
  data/
    samples.json
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

The demo data follows these conventions:

- `sample_id` is the primary key for sample-level files.
- `gene_id` and `gene_symbol` identify gene-level records.
- DE tables should include `gene_id`, `gene_symbol`, `log2FoldChange`, `pvalue`, and `padj`.
- Count matrices are expected in wide CSV format with gene columns first and one column per sample.

## Optional webR modules

The report lazy-loads webR only when the user opens the optional downstream analysis tab and clicks a module. Configure webR in `assets/report_config.json`:

```json
{
  "webr": {
    "enabled": true,
    "baseUrl": "https://webr.r-wasm.org/latest/",
    "packageRepo": "https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/",
    "packageRepoVersion": "v0.1.0",
    "modules": {
      "limma_voom": {
        "packages": ["limma", "edgeR"],
        "memoryWarning": "medium"
      }
    }
  }
}
```

Browser-side R/Bioconductor analysis is optional and experimental. If a package cannot be loaded, the report continues to show precomputed pipeline results.

## Pipeline integration

Typical pipeline steps:

1. Run alignment/quantification/counting.
2. Run QC aggregation.
3. Run PCA/clustering on normalized counts.
4. Run DESeq2/edgeR/limma on the server or cluster.
5. Run GO/KEGG/Reactome/GSEA enrichment.
6. Export the report assets into `assets/data/`.
7. Validate assets:

```bash
python scripts/validate_assets.py assets/data
```

## Security and privacy

Do not publish patient identifiers, protected health information, controlled-access genomes, or licensed annotation files to public GitHub Pages. Keep published demo data synthetic or de-identified.

## Adding a new tab

1. Add a tab button and panel in `index.html`.
2. Add loader code in `assets/js/dataLoader.js` if new files are needed.
3. Add rendering logic in `assets/js/plots.js` or a new module.
4. Wire the tab in `assets/js/app.js`.
5. Document expected input schema in `schemas/`.
