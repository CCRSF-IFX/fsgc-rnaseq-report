# Data And Metadata

The report is usually delivered with a count matrix already embedded. In that
case, you only need to provide sample metadata if the delivered report does not
already include it or if you want to change the grouping information.

## Count Matrix

A count matrix contains genes in rows and samples in columns. The report accepts
CSV and TSV count matrices when uploads are enabled.

The first gene column should be one of:

- `gene_id`
- `gene_symbol`
- `gene_name`

Count values can be integer counts or nonnegative fractional expected counts
from tools such as RSEM. For DESeq2, the browser rounds finite nonnegative count
values to integers immediately before creating the DESeq2 dataset.

## Sample Manifest

A sample manifest describes the samples. It is required for metadata-driven
analysis such as PCA coloring, heatmap annotations, DESeq2 questions, and GSEA
setup.

Supported manifest formats include:

- CSV
- TSV
- JSON

Every row must include `sample_id`. Those values must match the count matrix
sample columns exactly.

Useful metadata columns include:

- `condition`
- `tissue`
- `batch`
- `subject`
- `sex`
- `time`
- `dose`
- `RIN`

## Metadata Types

The report infers a type for each metadata column and lets you override it.

| Type | Use for |
| --- | --- |
| Categorical | condition, batch, subject, sex, tissue, donor, pair ID |
| Continuous | time, dose, RIN, age, QC percentages |
| Ordered | labels such as `0h`, `6h`, `24h` |
| Identifier | sample ID, run ID, donor ID when it should not be modeled |

If a blocking factor or subject ID is stored as numbers, mark it as
categorical before using it in DESeq2.

## Upload Rules

If you upload only a manifest, the report uses the embedded count matrix. If you
upload a new count matrix, upload a matching manifest too so the report can
understand sample groups.
