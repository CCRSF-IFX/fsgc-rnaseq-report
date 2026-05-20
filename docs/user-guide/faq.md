# FAQ

## Do I need a server to view a report?

Standalone reports are designed so core plots and tables can be opened directly
from the generated HTML file. Optional webR workflows are more reliable from an
`http://` or `https://` origin.

## What is the minimum input?

A report needs a count matrix named `counts.csv` or `counts.tsv`. A sample
manifest is strongly recommended and is required for metadata-driven optional
analysis.

## Are browser DESeq2 results production results?

No. Browser DESeq2 is an exploratory feature. Pipeline-generated and reviewed
outputs should remain the source of truth for final reporting.

## Which DESeq2 question type should I use?

Use Pairwise comparison for a direct two-level comparison without adjustment.
Use Additive covariate analysis when the same comparison should adjust for
batch, subject, sex, RIN, age, or another selected covariate. Use Advanced
analysis for interaction questions, omnibus LRT tests, or explicit combined
group comparisons.

## Is an interaction simple effect the same as subsetting samples?

It asks the same biological question, such as treatment vs control within one
tissue. The implementation is different: a simple effect is estimated from the
full interaction model, while a subset-only analysis fits DESeq2 using only that
subset of samples.

## Should I keep every interaction output?

Usually no. Start with Omnibus interaction test (LRT), then keep Interaction
coefficients for a compact follow-up. Add condition-within-modifier or
modifier-within-condition outputs only when those specific biological
comparisons are needed for plots, tables, or fgsea.

## Can the report work without internet?

Core embedded data, styles, and application code can work offline in a
standalone build. Optional webR package loading needs either reachable package
URLs or a mounted library bundle.

## Where do webR packages come from?

They come from the package snapshot or library bundle configured by the report
provider. If the online snapshot is unavailable, use the report buttons to
download and choose the local bundle.

## Can AI be excluded from reports?

Yes. Many delivered reports do not show any AI assistant. If an assistant is
enabled, review your local policy before sending sample names, gene lists, or
analysis notes to any model service.
