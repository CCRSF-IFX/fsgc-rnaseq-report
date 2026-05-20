# Browser Analysis Implementation

Browser analysis is optional and runs entirely in the report page through webR.
The main production report should still be driven by pipeline-generated files,
but the browser modules let users run exploratory DESeq2 and fgsea after adding
or correcting sample metadata.

## Relevant Files

- `assets/js/deQuestionBuilder.js`: turns UI selections into a DESeq2 question
  spec, validates sample scope, builds model labels, and predicts retained
  result sets.
- `assets/js/deseq2.js`: loads DESeq2 through webR, serializes counts and
  metadata to CSV, generates the R script, parses returned CSV, and registers
  plots, tables, and result metadata.
- `assets/js/fgsea.js`: ranks DESeq2 result rows, runs fgsea through webR, and
  stores pathway tables plus optional enrichment-curve data.
- `assets/js/analysisCache.js`: exports and imports browser-generated DESeq2,
  fgsea, sample metadata, and model metadata.
- `assets/report_config.json`: controls whether webR modules are enabled and
  which package snapshot or library bundle they use.

JavaScript differential-expression fallback is disabled by default. When a
contrast has no pipeline DE file, cached DESeq2 result, or newly run DESeq2
result, `loadDeForContrast()` returns no rows and the UI asks the user to run
DESeq2 or load results. Only enable `analysis.enableBrowserFallbackDE` for
explicit demo or debugging workflows where a Welch test on `log2(CPM + 1)` is
acceptable.

Manual cache import is replace-by-default. The app captures a baseline analysis
state after initial report load, and again after a user uploads a replacement
count matrix or sample manifest. Loading a cache first validates cached sample
IDs against the current sample set matched to the count matrix, then resets DESeq2/GSEA
results, analysis scopes, contrasts, and cached sample metadata back to that
baseline before applying the selected cache.

The DESeq2 interaction behavior follows common DESeq2 design patterns,
including the examples in
[DESeq2 experimental design and interpretation](https://rstudio-pubs-static.s3.amazonaws.com/329027_593046fb6d7a427da6b2c538caf601e1.html).
Use that reference when checking whether a UI question maps to the expected
main effect, interaction coefficient, simple effect, or LRT.

## DESeq2 Question Spec Contract

The UI should not call webR directly. It should first build a question spec with
`buildDeseqQuestionSpec()`.

Every spec must define:

- sample scope and selected `sampleIds`
- model family and `resultMode`
- full model label and optional reduced model label
- primary factor, numerator, denominator, and adjustment columns when relevant
- interaction factors, reference levels, and retained outputs when relevant
- group balance and warnings for the preview panel

Supported question types are:

| UI question type | `resultMode` | Model behavior |
| --- | --- | --- |
| Pairwise comparison | `wald_factor_contrast` | Uses only the selected numerator and denominator samples with model `~ factor`. |
| Additive covariate analysis | `wald_factor_contrast` | Uses model `~ adjustment_1 + adjustment_2 + factor`. |
| Omnibus interaction test (LRT) | `lrt` | Compares the full interaction model with the reduced additive model. |
| Interaction effect | `wald_interaction_coefficient` | Fits one interaction model and emits selected coefficient/simple-effect result sets. |
| Direct combined-group comparison | `group_factor_contrast` | Builds a synthetic combined-group factor for a special-case direct contrast. |

The selected denominator is always the DESeq2 reference level for that run.
When there is no `condition` column, the UI should guide the user to choose the
primary factor manually instead of silently assuming `condition`.

## Interaction Models

For interaction workflows, the full model is:

```r
~ adjustment_1 + adjustment_2 + condition + modifier + condition:modifier
```

When no adjustment variables are selected, the model becomes:

```r
~ condition + modifier + condition:modifier
```

The omnibus LRT uses the reduced additive model:

```r
~ adjustment_1 + adjustment_2 + condition + modifier
```

and runs:

```r
DESeq(dds, test = "LRT", reduced = reduced_formula)
```

The LRT result asks whether adding all interaction terms improves the model.
Its `log2FoldChange` is a representative full-model coefficient and should not
be documented or displayed as the omnibus interaction effect size.

## Interaction Result Outputs

`Interaction effect` fits one full interaction model, then extracts one or more
result sets. If a condition or modifier has more than two levels, the app emits
results for every non-reference level required by the selected output type.

| Retained output | R extraction logic | Biological meaning |
| --- | --- | --- |
| Interaction coefficients | `results(dds, name = interaction_coef)` | Difference in condition response between a non-reference modifier level and the modifier reference. |
| Condition main effect at modifier reference | `results(dds, name = condition_main_coef)` | Condition numerator vs denominator at the modifier reference level. |
| Modifier main effect at condition reference | `results(dds, name = modifier_main_coef)` | Modifier numerator vs denominator at the condition reference level. |
| Condition effect within each modifier level | Reference level uses the condition main coefficient; non-reference levels use condition main coefficient plus the matching interaction coefficient. | Treatment or condition effect separately inside each tissue, genotype, sex, or other modifier level. |
| Modifier effect within each condition level | Reference level uses the modifier main coefficient; non-reference levels use modifier main coefficient plus the matching interaction coefficient. | Modifier effect separately inside each condition level. |

The generated R script uses named coefficient lookup helpers and numeric
contrast vectors for simple effects. If DESeq2 naming changes or new model
types are added, update the coefficient lookup, result labels, user docs, and
cache metadata together.

## Data Handling Rules

Counts and metadata are parsed with different rules before webR execution:

- Sample IDs, gene IDs, and metadata values stay as strings in JavaScript.
- Count cells must be finite, nonnegative numeric values.
- Fractional expected counts are allowed for summaries and rounded in the R
  runner immediately before creating the DESeq2 dataset.
- Metadata types come from the metadata schema. Categorical or ordered columns
  become R factors; continuous columns become numeric covariates.
- Missing values in selected DESeq2 factors or adjustment columns stop the run.

Before running DESeq2, the code checks group sizes, complete interaction cells,
model size, and full-rank design matrices. Keep these checks near the spec
builder when changing UI behavior so the preview catches problems before webR
starts.

## Cache Contract

Browser-generated analysis cache files must preserve enough information to
restore both results and interpretation. `deAnalysisCacheEntry()` stores:

- question type, question label, result family, and result mode
- sample scope and group balance
- full and reduced model labels
- primary factor, numerator, denominator, and adjustment columns
- interaction factors, reference levels, retained outputs, and result IDs
- tested terms, coefficient name, method, and direct group factors

If a new DESeq2 result type or model field is added, update:

1. the spec builder in `deQuestionBuilder.js`
2. the webR result columns in `deseq2.js`
3. `deAnalysisCacheEntry()` in `analysisCache.js`
4. cache import compatibility, if older reports should still load
5. the user and developer documentation

fgsea uses the full in-memory DESeq2 result rows, not only the visible or
significant rows in the volcano table. Any change that truncates DE result rows
before registration can affect GSEA ranking.

## Validation Checklist

Run these checks after changing browser analysis logic:

```bash
node --check assets/js/deQuestionBuilder.js
node --check assets/js/deseq2.js
node --check assets/js/fgsea.js
node --check assets/js/analysisCache.js
mkdocs build --strict
```

For behavior changes, also test with a multi-factor manifest such as the
GSE164073 fixture and confirm:

- pairwise and additive models use the expected denominator/reference
- omnibus LRT reports the full and reduced models
- interaction outputs create the expected number of result sets
- exported analysis cache can be imported into a fresh report
- fgsea can run from a browser-generated DESeq2 result
