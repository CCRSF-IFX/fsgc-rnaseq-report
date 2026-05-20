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

### Omnibus Interaction Test

Use Omnibus interaction test first when asking whether a condition effect
changes across another factor, such as tissue, timepoint, sex, or genotype.

Example question:

```text
Does the treatment response differ by tissue?
```

A significant adjusted p-value means there is evidence that the condition
effect differs across at least one modifier level. A non-significant result
means the analysis did not detect that interaction.

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
