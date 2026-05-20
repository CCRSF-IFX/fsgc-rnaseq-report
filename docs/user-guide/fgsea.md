# GSEA Analysis

GSEA uses a selected differential-expression result to ask whether genes from a
pathway tend to appear near the top or bottom of the ranked gene list.

The report runs fgsea in the browser through webR when package support is
available.

## Before Running GSEA

You need:

- A DESeq2 result in the report.
- Gene identifiers that match the pathway file.
- A GMT pathway file, or a pathway collection already provided by the report.

Human `hg38` and mouse `mm10` are the supported reference choices for the
built-in browser workflow.

## Ranking

The report ranks genes from the full DE result, not just the currently visible
or significant rows in the table.

The ranking statistic is chosen as follows:

- Use the finite DESeq2 Wald statistic when available.
- If no finite statistic exists, use
  `sign(log2FoldChange) * -log10(pvalue)`.
- If `pvalue` is unavailable, use `padj`.
- True zero p-values are floored below the smallest positive p-value so they
  remain strong evidence.
- Missing, non-numeric, or negative p-values are excluded from fallback ranking.

Interaction LRT results can screen for genes with interaction evidence, but
Wald coefficient or simple-effect results usually make clearer GSEA inputs
because they have a direction.

## Pathway Size

The default pathway size range is:

- Minimum size: `10`
- Maximum size: `500`

Those defaults keep very tiny and extremely broad gene sets from dominating the
result.

## Plots

The GSEA tab includes an overview bar plot and pathway-level enrichment curves.
Use the top-N control to decide how many pathway curves are retained and cached.
