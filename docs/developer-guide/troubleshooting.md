# Developer Troubleshooting

This page focuses on build, validation, and deployment problems. Report
recipients should use the [User Troubleshooting](../user-guide/troubleshooting.md)
page.

## The Report Is Blank From `file://`

Use a local static server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Browsers commonly restrict module loading, workers, and `fetch()` requests from
double-clicked local files.

## Asset Validation Fails

Run:

```bash
python3 scripts/validate_assets.py path/to/data
```

Common causes:

- Missing `counts.csv` or `counts.tsv`.
- Missing gene identifier column.
- Fewer than two matching sample count columns.
- Sample metadata rows missing `sample_id`.
- QC rows missing a recognizable sample identifier.

## Sample Metadata Does Not Match Counts

`sample_id` values in the manifest must match count matrix column names exactly.
Check for extra spaces, renamed samples, or suffixes added by the pipeline.

## Plotly Charts Do Not Render Offline

Build with embedded Plotly:

```bash
python3 scripts/build_report_bundle.py --embed-plotly
```

Or provide a local Plotly file:

```bash
python3 scripts/build_report_bundle.py --plotly-file path/to/plotly.min.js
```

## webR Package Installation Fails

Check:

- The browser can reach the configured `webr.baseUrl`.
- The browser can reach `webr.packageRepo`.
- The package repository version matches `webr-packages/VERSION`.
- The report is being served over `http://` or `https://` when browser workers
  are required.
- A prebuilt library bundle is available if package installation is blocked.

If GitHub Actions reports `Rscript: command not found`, make sure the workflow
uses the Bash package parser in **Retrieve webR package refs**. Older workflow
versions used `shell: Rscript {0}` for that step.

## Optional Analysis Runs Out Of Memory

Browser memory varies by machine and browser. Reduce input size where possible,
filter genes before heatmap-style workflows, and prefer pipeline outputs for
large production contrasts.
