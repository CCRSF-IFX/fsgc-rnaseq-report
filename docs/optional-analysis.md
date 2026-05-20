# Optional Analyses

Optional analysis modules are designed for interactive exploration in the
browser. They complement the pipeline outputs shown in the report, but they do
not replace audited pipeline results.

## Data Requirements

The browser can display basic report content from a count matrix alone. The
optional analysis workflows need richer metadata:

- `sample_id` must match count matrix sample columns.
- Condition or grouping columns should be present in the sample manifest.
- The configured default condition column is stored in
  `assets/report_config.json` under `analysis.conditionColumn`.
- The configured reference level is stored under `analysis.referenceLevel`.

Users can also upload a replacement count matrix and matching sample manifest in
the Sample Metadata tab. If a new count matrix is uploaded, a matching manifest
is required for metadata-driven analysis.

## Differential Expression

The browser DESeq2 workflow uses webR. It lets a user build a biological
question from sample metadata, preview the implied model, run DESeq2 in the
browser, and register the result for volcano plots, MA plots, result tables,
cache export, and optional fgsea input.

Recommended use:

- Review sample metadata before running contrasts.
- Confirm the selected numerator and denominator before running DESeq2.
- Treat the selected denominator as the reference level for that run.
- Use pipeline-generated DE results when a result needs formal project review.
- Use browser results for quick questions, method demonstrations, and
  interactive follow-up.

### DESeq2 Inputs

DESeq2 needs a count matrix and a matching sample manifest. The manifest must
include `sample_id` values that match count matrix sample columns. The question
builder uses the remaining manifest columns as biological factors, covariates,
blocking variables, PCA aesthetics, and heatmap annotations.

Count values can be integer counts or nonnegative fractional expected counts
from tools such as RSEM. The browser uses count values as numeric values for
summaries and plots. Immediately before creating the DESeq2 object, the webR
runner rounds finite nonnegative count values to integers because DESeq2 expects
integer-like count data.

Metadata columns are typed separately from counts:

- `categorical`: condition, batch, subject, sex, tissue, donor, pair ID
- `continuous`: time, dose, RIN, age, percent mapped, other numeric covariates
- `ordered`: timepoint labels such as `0h`, `6h`, `24h`
- `identifier`: sample ID, run ID, donor ID when it should not be modeled

The UI shows inferred metadata types and lets users override them before
analysis. Numeric-coded blocking factors should be marked as `categorical`
before they are used as adjustment variables.

### Question Types

The DESeq2 question builder has two simple workflows and one advanced workflow.
The app builds the sample scope, model formula, contrast, result label, and
cache metadata from the selected question.

| Question type | Typical use | Model shape | Result |
| --- | --- | --- | --- |
| Pairwise comparison | Compare two levels of one factor with no adjustment | `~ condition` | One Wald contrast |
| Additive covariate analysis | Compare two levels while adjusting for batch, subject, sex, RIN, age, or other selected variables | `~ batch + sex + condition` | One adjusted Wald contrast |
| Advanced analysis | Interaction, LRT, or direct combined-group workflows | Depends on advanced type | One or more result sets |

Pairwise comparison automatically uses `condition` when it exists. It also
recognizes condition-like columns such as `group`, `treatment`, and `phenotype`.
If no condition-like column is present, the user chooses the primary factor
manually.

For pairwise and additive questions, the selected denominator is passed to
DESeq2 as the reference level. The result is extracted with:

```r
results(dds, contrast = c(primary_factor, numerator, denominator))
```

For paired or blocked designs, choose the treatment or group as the primary
factor, mark the subject or pair ID as `categorical`, and include it in the
adjustment variables.

### Advanced DESeq2

Advanced analysis is for questions that need interactions or exact combined
groups. The recommended flow is:

1. Run **Omnibus interaction test (LRT)** first when asking whether a condition
   effect changes across a modifier such as tissue, timepoint, sex, or genotype.
2. Use **Interaction effect** to extract coefficient-level follow-up results for
   genes, plots, tables, and GSEA.
3. Use **Direct combined-group comparison (less common)** only when the exact
   combined groups are the intended contrast.

#### Omnibus Interaction Test (LRT)

The LRT asks a global yes/no question: do the interaction terms improve the
model?

```r
full    <- ~ batch + condition + tissue + condition:tissue
reduced <- ~ batch + condition + tissue
dds <- DESeq(dds, test = "LRT", reduced = reduced)
```

For this result, `padj <= 0.05` means there is evidence that the condition
effect differs across at least one modifier level. `padj > 0.05` means the
analysis did not detect a significant interaction; it does not prove all levels
have identical effects.

The LRT `log2FoldChange` column is representative DESeq2 output and is not the
omnibus interaction effect size. Use LRT primarily for the interaction p-value
and adjusted p-value, then use Interaction effect for interpretable
coefficient-level results.

#### Interaction Effect

Interaction effect fits a model with the selected condition, modifier, optional
adjustment variables, and their interaction:

```r
~ batch + condition + tissue + condition:tissue
```

The user selects only the reference level for the condition and modifier. The
app then extracts retained outputs from the fitted model. By default, only
interaction coefficients are retained because they are the compact statistical
interaction follow-up.

| Retained output | Biological meaning | Number of result sets |
| --- | --- | --- |
| Interaction coefficients | Difference of condition effects between each non-reference modifier level and the modifier reference | `(condition levels - 1) * (modifier levels - 1)` |
| Condition main effect at modifier reference | Condition effect at the modifier reference level | `condition levels - 1` |
| Modifier main effect at condition reference | Modifier effect at the condition reference level | `modifier levels - 1` |
| Condition effect within each modifier level | Numerator vs denominator condition effect inside every modifier level | `(condition levels - 1) * modifier levels` |
| Modifier effect within each condition level | Modifier level effect inside every condition level | `(modifier levels - 1) * condition levels` |

Example: with `condition = mock` and `tissue = cornea` as references, an
interaction coefficient for `sars_cov_2:tissue_limbus` means:

```text
(SARS-CoV-2 - mock in limbus) - (SARS-CoV-2 - mock in cornea)
```

The simple condition effect within `tissue = limbus` means the SARS-CoV-2 vs
mock effect inside limbus. It answers the same biological question as running a
condition contrast within limbus only, but it is estimated from the full
interaction model instead of a separate subset-only model.

Each retained output becomes its own DE result set with its own plot, table,
metadata, cache entry, and possible GSEA input. Selecting many outputs can
create many result sets, especially when factors have more than two levels.

#### Direct Combined-Group Comparison

Direct combined-group comparison creates a temporary group from two metadata
columns and compares two selected combined groups. For example:

```text
treated:liver vs control:brain
```

This is useful when that exact combined group contrast is the intended
question. It is marked less common because it can mix multiple biological
effects into a single coefficient.

### Result Tables

The volcano-linked result table can show significant genes or all genes from
the selected DE result. fgsea ranking uses the full in-memory DE result, not the
current table pagination or significance filter.

### GSEA Ranking From DESeq2

Browser fgsea uses the selected DE result as a preranked gene list. Gene IDs are
matched by `gene_symbol` when available and by `gene_id` otherwise. If duplicate
gene IDs are present, the entry with the largest absolute ranking statistic is
kept.

Ranking is built as follows:

- Use the finite DESeq2 Wald `statistic` column when available.
- If no finite statistic exists, use
  `sign(log2FoldChange) * -log10(pvalue)`.
- If `pvalue` is unavailable for fallback ranking, use `padj`.
- True zero p-values are floored below the smallest positive p-value so they
  remain strong evidence instead of becoming zero.
- Missing, non-numeric, or negative p-values are excluded from fallback ranking.

LRT results can be useful for screening interaction genes, but coefficient or
simple-effect results are usually better GSEA inputs because their ranking
statistics have a clear direction.

### Cache Behavior

The analysis cache preserves browser-run DESeq2 results and the metadata needed
to restore them:

- sample manifest rows when a manifest is available
- sample scope, manual exclusions, and selected question type
- model formula labels and selected numerator/reference levels
- interaction output type, output label, and interaction result ID
- full DE result tables and fgsea result sets

The cache does not include uploaded count matrices, GMT files, webR packages, or
the local webR library bundle. Those files must be kept separately when a report
needs to be reopened later in a fully reproducible state.

## Enrichment

The fgsea workflow uses ranked gene statistics and gene set definitions in the
browser. It depends on the same webR runtime and package snapshot contract as
DESeq2.

When package repositories are unreachable, users can mount the prebuilt webR
library bundle if it is available.

## Heatmaps

The heatmap module can use count-derived data and gene annotations to create
interactive expression views. Large matrices may be constrained by browser
memory, so prefiltering to informative genes is recommended for very large
reports.

## Analysis Cache

Browser-derived results can be cached during the session. Treat cached results
as report-local convenience data, not as a replacement for versioned pipeline
outputs.
