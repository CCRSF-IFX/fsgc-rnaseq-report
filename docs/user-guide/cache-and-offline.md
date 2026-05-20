# Cache And Offline Use

Browser-run DESeq2 and GSEA results live in the current browser tab until you
export them. Export a cache before closing the report if you want to keep those
results.

## Export A Cache

After running browser analyses:

1. Open **Methods & Export**.
2. Select **Export cache**.
3. Save the `.analysis-cache.*.json` file.

The cache can include:

- sample manifest rows when a manifest is available
- browser-run DESeq2 result tables
- browser-run GSEA result sets
- model and contrast metadata
- selected analysis scopes and manual sample exclusions

## Load A Cache

To restore browser analysis results:

1. Open the same report or a compatible rebuilt report.
2. Open **Methods & Export**.
3. Select **Load cache**.
4. Choose the exported cache JSON file.

The cache restores sample metadata only when its `sample_id` values match the
current count matrix. Loading a cache replaces the current browser analysis
session by default: prior browser-run/imported DESeq2 and GSEA results are
cleared back to the report's current baseline before the selected cache is
restored.

For safety, the report checks the cache sample names against the sample set
currently matched to the count matrix in the browser. If cached sample metadata
is present, the cached `sample_id` set must match that current sample set
exactly. Wrong-project caches are rejected before any results are restored.

## What The Cache Does Not Include

The cache does not include uploaded count matrices, GMT pathway files, webR
packages, or local webR library bundles. Keep those files separately when you
need to reproduce an analysis later.

## Local webR Library Bundle

If the online package snapshot is unavailable, the report may ask you to use a
local webR library bundle. The usual order is:

1. Download the webR library bundle.
2. Choose the downloaded bundle from the report.
3. Let the report mount the bundle.
4. Run DESeq2 or GSEA.

The bundle lets webR load precompiled packages without reinstalling them during
the browser session.

For the current report version, the bundle is named like:

```text
rnaseq-report-webr-library-v0.1.0.zip
```

If the report shows a package snapshot warning when it opens, use the buttons in
the warning dialog or Runtime & Packages section. You can retry the online
snapshot, continue in report-only mode, download the bundle, or choose a bundle
you already downloaded.
