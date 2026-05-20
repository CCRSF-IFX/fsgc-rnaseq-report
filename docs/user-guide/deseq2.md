# DESeq2 Analysis

The report can run exploratory DESeq2 analysis in the browser through webR. Use
this for interactive follow-up and review. Pipeline-generated, reviewed results
should remain the source of truth for final reporting.

## Before Running DESeq2

Confirm:

- The count matrix is loaded.
- The sample manifest has `sample_id` values matching the count matrix columns.
- The biological grouping column is present.
- Metadata types are correct.
- The denominator/reference level is the group you want to compare against.

If the delivered report already contains the count matrix, you can add only the
sample manifest. If you upload a new count matrix, upload a matching manifest as
well.

## Question Types

| Question type | Use when | Example model |
| --- | --- | --- |
| Pairwise comparison | You want a direct two-level comparison with no adjustment | `~ condition` |
| Additive covariate analysis | You want the same comparison while adjusting for batch, subject, sex, RIN, age, or another variable | `~ batch + condition` |
| Advanced analysis | You need interactions, LRT, or direct combined-group comparisons | depends on the advanced option |

The selected denominator is used as the DESeq2 reference level for that run.

## Pairwise Comparison

Use this for common questions such as:

```text
treated vs control
```

The result is one DESeq2 contrast for the selected numerator against the
selected denominator.

## Additive Covariate Analysis

Use this when the comparison should adjust for another variable:

```text
treated vs control, adjusted for batch
```

For paired designs, choose the treatment or group as the primary factor and use
the subject or pair ID column as an adjustment variable. Make sure the subject
or pair ID column is marked as categorical.

## Advanced Analysis

Advanced analysis is for interaction or combined-group questions.

The interaction guidance follows common DESeq2 design patterns, including the
worked examples in
[DESeq2 experimental design and interpretation](https://rstudio-pubs-static.s3.amazonaws.com/329027_593046fb6d7a427da6b2c538caf601e1.html).
That reference is useful background for understanding why the report asks for
reference levels and why interaction models can produce several biologically
different result tables from one fitted model.

### Omnibus Interaction Test

Use Omnibus interaction test first when asking whether a condition effect
changes across another factor, such as tissue, timepoint, sex, or genotype.

Example question:

```text
Does the treatment response differ by tissue?
```

The report fits two nested DESeq2 models to the same selected samples.

Full model:

```r
~ adjustment_1 + adjustment_2 + condition + modifier + condition:modifier
```

Reduced model:

```r
~ adjustment_1 + adjustment_2 + condition + modifier
```

If no adjustment variables are selected, those terms are omitted:

```r
# Full
~ condition + modifier + condition:modifier

# Reduced
~ condition + modifier
```

The full model allows the condition effect to be different at different
modifier levels. The reduced model keeps the additive condition and modifier
main effects but assumes there is no condition-by-modifier interaction.

DESeq2 then runs a likelihood-ratio test (LRT):

```r
DESeq(dds, test = "LRT", reduced = reduced_formula)
```

For each gene, the LRT asks whether adding all `condition:modifier`
interaction terms improves the model compared with the reduced additive model.
The result is an omnibus test, not a single pairwise fold-change test.

Interpretation:

- `padj` below the selected threshold means the gene has evidence that the
  condition response changes across at least one modifier level.
- `padj` above the threshold means the analysis did not detect evidence that
  the condition response depends on the modifier.
- The test does not say which specific modifier level is responsible. Use
  **Interaction effect** follow-up results to inspect coefficients or simple
  condition effects.
- In DESeq2 LRT output, `log2FoldChange` is a representative coefficient from
  the full model. Do not interpret it as the omnibus interaction effect size.
  Use the LRT `statistic`, `pvalue`, and `padj` for the omnibus test.

Core browser R code for the Omnibus Interaction Test branch is below. The full
generated script also defines helper functions such as `prepare_factor()`,
maps uploaded metadata column names to safe R names, builds `adjust_cols` from
the UI-selected adjustment variables, and exports the result table as CSV.

```r
suppressPackageStartupMessages(library(DESeq2))

countData <- read.csv(text = count_text, row.names = 1, check.names = FALSE)
rownames(countData) <- make.unique(rownames(countData))
countData <- as.matrix(countData)
countData <- matrix(
  suppressWarnings(as.numeric(countData)),
  nrow = nrow(countData),
  dimnames = dimnames(countData)
)
if (any(!is.finite(countData)) || any(countData < 0)) {
  stop("Count matrix contains non-numeric, negative, or missing values.")
}
countData <- round(countData)
storage.mode(countData) <- "integer"

colData <- read.csv(
  text = metadata_text,
  row.names = 1,
  check.names = FALSE,
  stringsAsFactors = FALSE
)
countData <- countData[, rownames(colData), drop = FALSE]

# The app maps original metadata names to syntactically safe R names.
raw_names <- colnames(colData)
safe_names <- make.names(raw_names, unique = TRUE)
colnames(colData) <- safe_names
safe_lookup <- setNames(safe_names, raw_names)

condition_col <- prepare_factor(
  condition_col_raw,
  "Condition factor",
  condition_denominator_level
)
modifier_col <- prepare_factor(
  modifier_col_raw,
  "Modifier factor",
  modifier_denominator_level
)

# Adjustment columns are added first. Categorical adjustments are factors;
# continuous adjustments are numeric.
adjust_cols <- c("batch", "subject")  # example; may be empty
tested_terms <- paste(condition_col, modifier_col, sep = ":")

design_terms <- c(adjust_cols, condition_col, modifier_col, tested_terms)
reduced_terms <- c(adjust_cols, condition_col, modifier_col)

design_formula <- reformulate(design_terms)
reduced_formula <- reformulate(reduced_terms)

design_matrix <- model.matrix(design_formula, colData)
if (qr(design_matrix)$rank < ncol(design_matrix)) {
  stop("DESeq2 LRT full design is not full rank.")
}
if (nrow(design_matrix) <= ncol(design_matrix)) {
  stop("DESeq2 LRT design has too many terms for the number of selected samples.")
}

dds <- DESeqDataSetFromMatrix(
  countData = countData,
  colData = colData,
  design = design_formula
)
dds <- DESeq(dds, test = "LRT", reduced = reduced_formula, quiet = TRUE)
res <- results(dds)

out <- as.data.frame(res)
out$gene_id <- rownames(out)
out$result_mode <- "lrt"
out$coefficient_name <- paste(
  "LRT",
  paste(deparse(design_formula), collapse = " "),
  "vs",
  paste(deparse(reduced_formula), collapse = " ")
)
out$tested_terms <- tested_terms
out$full_model <- paste(deparse(design_formula), collapse = " ")
out$reduced_model <- paste(deparse(reduced_formula), collapse = " ")
```

### Interaction Effect

Use Interaction effect as a follow-up after an interesting or significant
omnibus test. The app fits an interaction model and can retain several result
types.

The default retained output is **Interaction coefficients**. This is the most
compact statistical follow-up.

Optional retained outputs include:

- Condition main effect at modifier reference.
- Modifier main effect at condition reference.
- Condition effect within each modifier level.
- Modifier effect within each condition level.

Each retained output becomes its own result set with its own plot, table,
cache entry, and possible GSEA input. Select only the outputs you need.

The table below maps common DESeq2 interaction questions from the reference
examples to report choices.

| Biological question | Report choice | Notes |
| --- | --- | --- |
| Two groups, such as treated vs control | Pairwise comparison | Use the denominator as the reference level. |
| One factor with more than two levels | Pairwise comparison | Choose the numerator and denominator for the specific comparison. |
| Condition effect at the modifier reference level | Interaction effect, then retain Condition main effect at modifier reference | Example: treatment effect in the reference tissue or genotype. |
| Modifier effect at the condition reference level | Interaction effect, then retain Modifier main effect at condition reference | Example: tissue difference in the untreated or mock group. |
| Condition effect within each modifier level | Interaction effect, then retain Condition effect within each modifier level | Example: treatment vs control separately inside each tissue or genotype. |
| Modifier effect within each condition level | Interaction effect, then retain Modifier effect within each condition level | Example: tissue difference separately inside each condition. |
| Difference in condition response between modifier levels | Interaction effect, then retain Interaction coefficients | Example: whether treatment response differs between two tissues or genotypes. |
| Any evidence that condition response varies across modifier levels | Omnibus Interaction Test | Best first-pass screen when the modifier has two or more levels. |

The current report intentionally avoids arbitrary free-form coefficient-vector
contrasts in the UI. For non-reference simple effects, choose the desired
denominator/reference levels and rerun the analysis. For three-way interactions
or custom numeric contrasts, use a scripted DESeq2 workflow outside the report.

### Direct Combined-Group Comparison

Use this less-common option only when an exact combined group comparison is the
intended biological question.

Example:

```text
treated liver vs control brain
```

This can mix condition and tissue effects, so use it carefully.

## Result Table

The table below the volcano plot can show only significant genes or all genes
from the selected DE result. GSEA uses the full in-memory DE result, not just
the visible or filtered table.

## Save Your Results

After running DESeq2, export an analysis cache from **Methods & Export** before
closing the browser tab.
