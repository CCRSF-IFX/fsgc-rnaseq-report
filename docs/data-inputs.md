# Data Inputs

A report needs a count matrix. Most richer workflows also need sample metadata.
Other files are optional and improve the quality of the generated report.

## Count Matrix

Supported count matrix names:

- `counts.csv`
- `counts.tsv`

The matrix should include a gene identifier column and at least two numeric
sample columns. Accepted gene identifier columns include:

- `gene_id`
- `gene_symbol`
- `gene_name`

Additional gene metadata columns are allowed. The validator treats common
columns such as `description`, `chromosome`, `start`, `end`, `strand`, `length`,
and `gene_biotype` as metadata rather than sample count columns.

## Sample Metadata

Supported sample metadata names:

- `samples.json`
- `sample_manifest.csv`
- `sample_manifest.tsv`
- `samples.csv`
- `samples.tsv`

Each row must include `sample_id`. Additional columns can be used for PCA
coloring, heatmap annotations, DESeq2 contrast construction, and fgsea setup.

For DESeq2, metadata columns are interpreted through the report metadata schema.
Grouping variables such as condition, tissue, batch, subject, sex, and pair ID
should be categorical. Numeric covariates such as time, dose, RIN, age, and QC
percentages can be continuous. Timepoint labels such as `0h`, `6h`, and `24h`
can be treated as ordered categories. The browser shows the inferred type and
lets the user override it before running metadata-driven analysis.

When no sample manifest is present, the validator can infer sample IDs from
numeric count columns. That fallback is enough for simple browsing, but
metadata-driven analysis needs an explicit manifest.

## QC Metrics

Supported QC metric names:

- `qc_metrics.json`
- `qc_metrics.csv`
- `qc_metrics.tsv`
- `qc_metrics.xlsx`
- `qc_metrics.xlsm`

QC rows must include a sample identifier column such as `sample_id`, `sample`,
`sampleid`, or `Sample ID`.

When a supported QC Excel workbook is present, the builder reads the `Summary`
sheet and embeds it as `qc_metrics.json` in standalone reports. Use
`--include-qc-excel` to also embed the original workbook for download from the
QC tab.

## Optional Pipeline Outputs

The report can display optional precomputed assets when they are available:

- `pca.json`
- `sample_distance_matrix.json`
- `contrast_list.json`
- `differential_expression/*.csv`
- `enrichment/*.csv`
- `gene_annotation.json`
- `logs/pipeline_provenance.json`
- `logs/software_versions.json`

If precomputed PCA or sample distance files are missing, the browser can compute
useful fallbacks from the count matrix.

## Validation

Validate a data directory before building:

```bash
python3 scripts/validate_assets.py assets/data
```

The same command can be pointed at a run-specific directory:

```bash
python3 scripts/validate_assets.py path/to/report-data
```
