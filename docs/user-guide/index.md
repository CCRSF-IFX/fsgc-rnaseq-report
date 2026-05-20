# User Guide

This guide is for people who receive an RNA-seq report as an HTML file or open
the hosted report in a browser.

You do not need to install R, Python, or Git. The report is a static web page
with interactive plots and tables. Some optional analyses use webR, which runs R
inside the browser when the required package snapshot or local library bundle is
available.

## What You Can Do

- Review project summary, sample metadata, QC metrics, PCA, distance plots, and
  expression heatmaps.
- Add or replace sample metadata when the delivered report contains a count
  matrix but no manifest.
- Optionally upload a replacement count matrix with a matching sample manifest.
- Run exploratory DESeq2 analysis in the browser.
- Run GSEA from a selected differential-expression result.
- Export a report-local analysis cache and load it later.

## Recommended Path

1. Open the report.
2. Confirm the sample metadata.
3. Review QC and PCA.
4. Use heatmaps to inspect expression patterns.
5. Run DESeq2 only after the sample manifest has the factors needed for the
   question.
6. Run GSEA from the DESeq2 result if pathway-level interpretation is needed.
7. Export the analysis cache before closing the browser tab.

Pipeline-generated statistics should remain the source of truth for formal
reporting. Browser analyses are best used for exploratory follow-up, quick
questions, and transparent review with collaborators.
