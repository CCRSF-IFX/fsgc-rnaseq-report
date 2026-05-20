# Data Assets

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

The report checks `counts.csv` first, then `counts.tsv`. To use a different
count-matrix path, set `countMatrix` or `countsFile` in
`assets/report_config.json`. Count matrices are expected in wide format with
gene columns first and one column per sample.

Count values must be nonnegative numeric values. Fractional expected counts
from tools such as RSEM are accepted; browser summaries use them as numeric
counts and the DESeq2 webR runner rounds finite nonnegative values to integers
immediately before creating the DESeq2 dataset.

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

The report checks sample metadata names in the order shown above. To use a
different manifest name, set it in `assets/report_config.json`:

```json
{
  "sampleManifest": "metadata/my_samples.tsv"
}
```

`sampleManifest` is resolved relative to `dataRoot`. A configured
`sampleManifest` is treated as required, which is useful when a production
report should fail the build if metadata is missing.

Browser-generated contrasts require a sample manifest. They use
`analysis.conditionColumn` from `assets/report_config.json`; if that value is
not set, the report uses `condition` when available, otherwise the first
categorical or ordered metadata column with at least two groups.

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

QC metrics can use canonical report fields or Excel-style headers from the
pipeline summary. Supported `Summary` sheet headers include:

```text
Sample ID
Sample Yield (Mbases)
Percent of (PF) Bases >= Q30
Total Reads (PF)
Total Reads After Trimming
Percent Total Reads after Trimming
Total Mapped Reads (Trimmed)
Percent Total Mapped Reads (Trimmed)
Uniquely Mapped Reads (Trimmed)
Percent Uniquely Mapped Reads (Trimmed)
Percent Non-duplicate Reads (Mapped Trimmed)
PCT_RIBOSOMAL_BASES
PCT_CODING_BASES
PCT_UTR_BASES
PCT_INTRONIC_BASES
PCT_INTERGENIC_BASES
PCT_MRNA_BASES
PCT_CORRECT_STRAND_READS
MEDIAN_5PRIME_TO_3PRIME_BIAS
```

Percent-style values may be written as `95.74`, `95.74%`, or `0.9574`; the
app normalizes them to fractions for plots and threshold checks.

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

With counts and a manifest, the report can derive:

- PCA coordinates from log2(CPM + 1) expression.
- Sample distances from log2(CPM + 1) expression.
- Gene-level count summaries, sample bar plots, and grouped box plots.
- Clustergrammer expression heatmaps from top-variable or custom gene lists.
- Metadata-defined browser contrasts for optional downstream analysis.

The PCA view supports one metadata column as color and, when more than one
metadata factor is available, a second metadata column as marker shape. Extra
metadata columns remain available in hover labels and tables rather than being
forced into additional visual encodings.

## Included Fixtures

The repository includes a manifest-driven simulated fixture:

```text
assets/data/simulated/
  sample_manifest.csv
  counts.csv
```

It contains eight simulated samples split by `condition`, `batch`, and `sex`.
Validate it with:

```bash
python3 scripts/validate_assets.py assets/data/simulated
```

The repository also includes a human multi-factor public dataset fixture:

```text
assets/data/gse164073/
  sample_manifest.csv
  counts.csv
  gene_annotation.json
```

GSE164073 profiles human cornea, limbus, and sclera cells after mock or
SARS-CoV-2 infection. It is useful for testing PCA color/shape controls,
Clustergrammer heatmaps, and DESeq2 with `condition` as the primary factor and
`tissue` as an adjustment, blocking, or interaction modifier.

Regenerate and validate it with:

```bash
python3 scripts/download_gse164073_demo.py
python3 scripts/validate_assets.py assets/data/gse164073
```

Build a single-file report from this dataset with:

```bash
python3 scripts/build_report_bundle.py \
  --data-root assets/data/gse164073 \
  --output dist/gse164073-report.html
```

## Validation

Validate a data directory before building:

```bash
python3 scripts/validate_assets.py assets/data
```

The same command can be pointed at a run-specific directory:

```bash
python3 scripts/validate_assets.py path/to/report-data
```

For recipient-facing file format guidance, see the
[User Guide data page](../user-guide/data-and-metadata.md).
