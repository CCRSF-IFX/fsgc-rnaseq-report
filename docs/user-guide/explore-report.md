# Explore QC, PCA, And Heatmaps

Start with exploratory views before running DESeq2. These views help confirm
that the sample metadata and major expression patterns make sense.

## QC Metrics

The QC section summarizes sequencing and alignment metrics when they were
included by the report provider. Use it to check for outlier samples, low
mapping rates, unusual duplication, or other sample-level concerns.

## PCA

The PCA plot shows broad sample relationships. Use color and shape controls to
check whether samples separate by expected factors such as condition, tissue, or
batch.

If there are more than two metadata factors, use color and shape for the two
most important factors and inspect other factors separately. Too many encodings
can make the PCA plot harder to read.

## Sample Distance

The sample distance view shows how similar samples are based on expression. It
is useful for checking whether replicates cluster together and whether obvious
sample swaps or outliers are present.

## Expression Heatmap

The Clustergrammer expression heatmap shows selected genes across samples. You
can use the default most-variable genes or provide a custom gene list from the
heatmap controls.

For large projects, use a focused gene list or top-variable-gene setting rather
than trying to inspect all genes at once.
