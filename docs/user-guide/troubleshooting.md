# User Troubleshooting

## The Report Is Blank

Try a modern browser first. If the report still appears blank, ask the report
provider for a hosted URL or a regenerated standalone report.

## DESeq2 Or GSEA Package Loading Fails

Use the package status message in the report. Common fixes are:

- Retry the online package snapshot.
- Download and choose the local webR library bundle.
- Open the report from a hosted `https://` URL instead of a double-clicked local
  file.

## The Sample Manifest Does Not Match

`sample_id` values in the manifest must match count matrix column names exactly.
Check for spaces, capitalization changes, or suffixes added by upstream tools.

## PCA Or Heatmap Groups Look Wrong

Review the sample manifest and metadata types. A numeric-coded group such as
`1`, `2`, `3` may need to be marked as categorical instead of continuous.

## GSEA Has No Results

Check that pathway gene identifiers match the DE result identifiers. The report
uses `gene_symbol` when available and falls back to `gene_id`.

## Results Disappeared After Closing The Tab

Browser-run analysis results are not permanent until exported. Re-run the
analysis or load a previously exported analysis cache.
