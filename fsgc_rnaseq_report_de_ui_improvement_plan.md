# fsgc-rnaseq-report UI Improvement Plan

## Goal

Improve the `fsgc-rnaseq-report` Differential Expression UI so it can accommodate simple contrasts, multi-factor designs, tissue-specific effects, interaction models, omnibus LRT tests, direct group comparisons, and user-defined sample subsets.

The current report already supports a static HTML/JavaScript report with uploaded counts/metadata, PCA, heatmaps, DE tables, volcano/MA plots, browser DESeq2 through webR, fgsea, and analysis cache export/import. The main limitation is that the DESeq2 UI is currently centered on one primary factor with numerator/denominator levels and optional additive adjustment variables.

The proposed change is to move from a flat contrast selector and simple DESeq2 form to a guided biological question builder.

---

## Current UI behavior

The current Differential Expression tab has two major parts:

1. A result viewer with:
   - contrast selector
   - adjusted p-value threshold
   - absolute log2 fold-change threshold
   - show-all-genes toggle
   - volcano plot
   - MA plot
   - DE result table

2. A browser DESeq2 runner with:
   - primary factor
   - numerator level
   - denominator/reference level
   - optional adjust/block columns
   - Run DESeq2 button

Conceptually, the current browser DESeq2 runner handles this kind of model:

```r
~ adjustment_1 + adjustment_2 + primary_factor
```

and extracts a result such as:

```r
results(dds, contrast = c(primary_factor, numerator, denominator))
```

This works well for simple questions like:

```text
treated vs control, adjusted for batch
```

But it does not directly guide users through scenarios such as:

```text
treated vs control within liver
tissue differences within treated samples
condition-by-tissue interaction
global interaction LRT
treated liver vs control brain
DESeq2 run on only a user-selected sample subset
```

---

## Recommended high-level UI structure

Replace the DE tab with a structure like this:

```text
Differential Expression
├── Result viewer
├── Analysis scope / sample subset
├── Biological question builder
├── Model preview
├── Run DESeq2
└── Advanced contrast / LRT
```

The key UX principle is:

> Users should choose the biological question first. The app should generate the sample scope, design formula, contrast, result label, and cache metadata.

Avoid asking most users to directly choose DESeq2 coefficient names such as:

```text
condition_treated_vs_control
conditiontreated.tissueliver
```

Instead, show labels like:

```text
treated vs control within liver
treatment response in liver vs brain
liver vs brain within treated
```

Raw DESeq2 coefficient names can be displayed in an expandable technical details panel.

---

## Proposed DE tab layout

```text
Differential Expression
────────────────────────────────────────────

[ Result viewer ] [ Run DESeq2 ] [ Advanced ]

Result viewer
────────────────────────────────────────────
Result category:
[ All result types v ]

Result:
[ treated vs control within liver v ]

Tags:
condition effect · subset: tissue=liver · DESeq2 webR

Filters:
padj <= [0.05]   |log2FC| >= [1.0]   [ ] Show all genes

[Volcano plot] [MA plot]
[DE table]

────────────────────────────────────────────

Run DESeq2
────────────────────────────────────────────

1. Analysis scope
Use samples:
(•) All samples
( ) Subset samples

Subset filters:
tissue [ liver v ]
sex    [ all   v ]
batch  [ all   v ]

Manual sample exclusions:
[ ] sample_01
[ ] sample_02
[x] sample_03

Selected samples: 8 / 24

Group balance:
condition    control    treated
liver        4          4

2. Biological question
Question type:
[ Condition effect within tissue v ]

Condition comparison:
[ treated ] vs [ control ]

Tissue:
[ liver ]

3. Adjustment variables
Adjust/block by:
[x] batch
[ ] sex
[ ] donor

4. Model preview
Full model:
~ batch + condition

Contrast:
treated_liver - control_liver

[Run DESeq2]
```

---

# 1. Result viewer improvements

## Current behavior

The current contrast selector is flat. It lists all available contrasts in one dropdown.

That works for a simple report like:

```json
[
  {
    "id": "treated_vs_control",
    "label": "Treated vs Control",
    "de_file": "differential_expression/treated_vs_control.csv",
    "enrichment_file": "enrichment/treated_vs_control_go.csv"
  }
]
```

But as soon as users have multiple tissues, interactions, subsetted analyses, and LRT results, a flat selector becomes hard to understand.

## Recommended behavior

Group results by biological question:

```text
Condition effects
  treated vs control within brain
  treated vs control within liver
  treated vs control within heart

Tissue effects
  liver vs brain within control
  heart vs brain within control
  heart vs liver within treated

Interactions
  treatment response in liver vs brain
  treatment response in heart vs brain
  any tissue-specific treatment response, LRT

Direct group comparisons
  treated liver vs control brain
  treated heart vs control liver

Subset analyses
  treated vs control in liver-only subset
  treated vs control after excluding sample_03
```

## Suggested contrast metadata

Extend each contrast object with enough metadata to describe the biological question, the design, and the sample scope.

Example:

```json
{
  "id": "deseq2_condition_treated_vs_control_within_liver",
  "label": "treated vs control within liver",
  "question_type": "condition_within_tissue",
  "result_family": "condition_effect",
  "scope_id": "scope_tissue_liver",
  "sample_count": 8,
  "primary_factor": "condition",
  "numerator": "treated",
  "denominator": "control",
  "stratify_factor": "tissue",
  "stratify_level": "liver",
  "adjust_columns": ["batch"],
  "full_model": "~ batch + condition",
  "reduced_model": "",
  "contrast_label": "treated_liver - control_liver",
  "method": "DESeq2 webR",
  "generated": true
}
```

Then the UI can display badges such as:

```text
condition effect · liver subset · adjusted for batch · DESeq2 webR
```

---

# 2. Analysis scope / sample subset

## Why this is needed

There are two different operations that should not be confused:

1. Filtering the displayed DE table.
2. Subsetting samples and rerunning DESeq2.

Changing the sample set changes the model and should produce a new DESeq2 result. For example:

```text
treated vs control across all tissues
```

is not the same as:

```text
treated vs control using only liver samples
```

Therefore, sample subsetting should be a first-class workflow, not just a table filter.

## Proposed UI

```text
Analysis scope

Use samples:
(•) All eligible samples
( ) Subset samples

Subset filters:
  tissue      [ liver        v ]
  sex         [ all          v ]
  batch       [ all          v ]

Manual sample exclusions:
  [ ] sample_01
  [ ] sample_02
  [x] sample_03

Selected samples: 8 / 24

Group balance:
condition    control    treated
liver        4          4

[Save scope] [Use this scope for DESeq2]
```

## Suggested state object

Add reusable analysis scopes to app state.

```js
analysisScopes: [
  {
    id: 'all_samples',
    label: 'All samples',
    filters: [],
    excludedSampleIds: [],
    sampleIds: []
  }
],
activeAnalysisScopeId: 'all_samples'
```

Example user-created scope:

```js
{
  id: 'scope_tissue_liver',
  label: 'tissue = liver',
  filters: [
    { column: 'tissue', operator: 'equals', value: 'liver' }
  ],
  excludedSampleIds: [],
  sampleIds: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'],
  createdAt: '2026-05-19T12:00:00Z'
}
```

## Sample selection logic

Current DESeq2 logic filters samples to numerator and denominator levels of the primary factor.

Refactor this into two steps:

```js
const scopedSampleIds = sampleIdsForActiveScope();
const sampleIds = scopedSampleIds.filter((sampleId) => {
  const value = sampleValue(sampleId, primaryColumn);
  return value === numerator || value === denominator;
});
```

This separates:

```text
which samples are eligible for this analysis
```

from:

```text
which factor levels are compared in this contrast
```

## Validation

Before running DESeq2, show a group balance table and warnings.

Examples:

```text
OK:
condition    control    treated
liver        4          4

Warning:
condition    control    treated
liver        1          4

DESeq2 browser runner requires at least two samples per compared group.
```

Validation should check:

```text
- selected sample count is large enough
- each compared group has enough replicates
- selected factors have at least two levels
- adjustment factors are not constant inside the subset
- continuous covariates are numeric and variable
- design matrix is full rank
- number of samples is greater than number of model coefficients
```

---

# 3. Biological question builder

Replace the current first control:

```text
Primary factor
```

with:

```text
What question do you want to ask?
```

Recommended question types:

```text
Condition effect within tissue
Tissue effect within condition
Interaction / tissue-specific response
Direct group comparison
Additive covariate-adjusted effect
Omnibus / LRT test
Advanced DESeq2 contrast
```

Each question type should show only the fields needed for that question.

---

# 4. Supported scenarios

Assume this example metadata:

```text
condition: control, treated
tissue:    brain, liver, heart
```

---

## Scenario A: Condition effect within one tissue

### User question

```text
Which genes change between treated and control within liver?
```

### UI

```text
Question type:
[ Condition effect within tissue ]

Condition comparison:
[ treated ] vs [ control ]

Tissue:
[ liver ]

Adjust for:
[ batch ]

Analysis scope:
[ tissue = liver ]

Model preview:
~ batch + condition

Contrast:
treated_liver - control_liver

[Run DESeq2]
```

### Statistical meaning

```text
treated_liver - control_liver
```

### Recommended implementation

Default simple implementation:

```r
# subset samples to tissue == "liver"
design(dds) <- ~ batch + condition
dds <- DESeq(dds)
res <- results(dds, contrast = c("condition", "treated", "control"))
```

This is easy to explain and works well in the browser UI.

Advanced implementation using full interaction model:

```r
design(dds) <- ~ batch + condition + tissue + condition:tissue
dds <- DESeq(dds)
```

Then extract the liver-specific condition effect using the main condition coefficient plus the liver interaction term.

---

## Scenario B: Tissue effect within one condition

### User question

```text
Which genes differ between liver and brain among treated samples?
```

### UI

```text
Question type:
[ Tissue effect within condition ]

Tissue comparison:
[ liver ] vs [ brain ]

Condition:
[ treated ]

Adjust for:
[ batch ]

Analysis scope:
[ condition = treated ]

Model preview:
~ batch + tissue

Contrast:
treated_liver - treated_brain

[Run DESeq2]
```

### Statistical meaning

```text
treated_liver - treated_brain
```

### Recommended implementation

```r
# subset samples to condition == "treated"
design(dds) <- ~ batch + tissue
dds <- DESeq(dds)
res <- results(dds, contrast = c("tissue", "liver", "brain"))
```

### With 3 tissues and 2 conditions

Possible tissue-within-condition results:

```text
liver vs brain within control
heart vs brain within control
heart vs liver within control

liver vs brain within treated
heart vs brain within treated
heart vs liver within treated
```

Total:

```text
2 × choose(3, 2) = 6
```

---

## Scenario C: Pairwise interaction / tissue-specific response

### User question

```text
Does treatment affect liver differently than brain?
```

### UI

```text
Question type:
[ Interaction / tissue-specific response ]

Condition comparison:
[ treated ] vs [ control ]

Compare response between tissues:
[ liver ] vs [ brain ]

Adjust for:
[ batch ]

Model preview:
~ batch + condition + tissue + condition:tissue

Contrast:
(treated_liver - control_liver) - (treated_brain - control_brain)

[Run interaction test]
```

### Statistical meaning

```text
(treated_liver - control_liver)
-
(treated_brain - control_brain)
```

This asks:

```text
Is the treatment effect different in liver than in brain?
```

It does not simply ask whether a gene is DE in liver.

### For 3 tissues

Possible pairwise interaction results:

```text
treatment response in liver vs brain
treatment response in heart vs brain
treatment response in heart vs liver
```

Total:

```text
choose(3, 2) = 3
```

### UI warning

Display a short explanation box:

```text
This tests whether the treatment response differs between two tissues.
It is not the same as testing treated vs control in only one tissue.
```

---

## Scenario D: Omnibus interaction LRT

### User question

```text
Are there any genes whose treatment response differs by tissue?
```

### UI

```text
Question type:
[ Omnibus / LRT test ]

Test:
[ Any condition:tissue interaction ]

Full model:
~ batch + condition + tissue + condition:tissue

Reduced model:
~ batch + condition + tissue

Meaning:
Tests all condition:tissue interaction terms together.

[Run LRT]
```

### R code

```r
design(dds) <- ~ batch + condition + tissue + condition:tissue

dds_lrt_int <- DESeq(
  dds,
  test = "LRT",
  reduced = ~ batch + condition + tissue
)

res <- results(dds_lrt_int)
```

### Meaning

The LRT compares:

```text
full model:    ~ batch + condition + tissue + condition:tissue
reduced model: ~ batch + condition + tissue
```

This tests whether adding `condition:tissue` interaction terms improves the model.

### UI warning for LRT results

LRT result tables need a special explanation:

```text
P-value meaning:
Tests all condition:tissue interaction terms removed from the reduced model.

Displayed log2FC:
Representative coefficient only; do not interpret it as the full omnibus effect.
```

---

## Scenario E: Direct group comparison

### User question

```text
Which genes differ between treated liver and control brain?
```

### UI

```text
Question type:
[ Direct group comparison ]

Group 1:
condition [ treated ]   tissue [ liver ]

Group 2:
condition [ control ]   tissue [ brain ]

Model preview:
~ batch + condition_tissue_group

Contrast:
treated_liver - control_brain

[Run DESeq2]
```

### Statistical meaning

```text
treated_liver - control_brain
```

This is a direct comparison between two combined groups. It may mix condition and tissue effects, so it should be under an advanced section or include a warning.

### Recommended implementation

```r
dds$group <- factor(paste(dds$condition, dds$tissue, sep = "_"))
design(dds) <- ~ batch + group
dds <- DESeq(dds)
res <- results(dds, contrast = c("group", "treated_liver", "control_brain"))
```

### For 2 conditions × 3 tissues

Combined groups:

```text
control_brain
control_liver
control_heart
treated_brain
treated_liver
treated_heart
```

Total direct pairwise comparisons:

```text
choose(6, 2) = 15
```

---

## Scenario F: Additive covariate-adjusted condition effect

### User question

```text
Which genes differ between treated and control after adjusting for tissue?
```

### UI

```text
Question type:
[ Additive covariate-adjusted effect ]

Primary comparison:
condition: [ treated ] vs [ control ]

Adjust for:
[ tissue ]
[ batch ]

Model preview:
~ batch + tissue + condition

Contrast:
treated - control adjusted for tissue and batch

[Run DESeq2]
```

### Statistical meaning

```text
Average condition effect after accounting for tissue and batch,
assuming the condition effect is the same across tissues.
```

### UI warning

```text
This does not test whether treatment behaves differently across tissues.
Use Interaction / tissue-specific response for that.
```

### R code

```r
design(dds) <- ~ batch + tissue + condition
dds <- DESeq(dds)
res <- results(dds, contrast = c("condition", "treated", "control"))
```

---

# 5. Model preview panel

Every DESeq2 run should show a preview before execution.

Example:

```text
Model preview
────────────────────────────
Sample scope:
tissue = liver

Selected samples:
8 / 24

Full model:
~ batch + condition

Contrast:
treated_liver - control_liver

Interpretation:
Genes changed by treatment within liver samples, adjusted for batch.
```

For LRT:

```text
Model preview
────────────────────────────
Sample scope:
all samples

Full model:
~ batch + condition + tissue + condition:tissue

Reduced model:
~ batch + condition + tissue

Test:
Any tissue-specific treatment response
```

The preview should be generated before running DESeq2 and stored with the result.

---

# 6. Advanced DESeq2 contrast builder

For power users, add an advanced panel.

```text
Advanced DESeq2 contrast

Available coefficients:
[ condition_treated_vs_control ]
[ tissue_liver_vs_brain ]
[ tissue_heart_vs_brain ]
[ conditiontreated.tissueliver ]
[ conditiontreated.tissueheart ]

Contrast builder:
+ condition_treated_vs_control
+ conditiontreated.tissueliver

Preview:
treated_liver - control_liver

[Run contrast]
```

This should be hidden behind an Advanced tab.

Normal users should not be forced to understand coefficient names.

---

# 7. Suggested JavaScript architecture

## Add a new module

Create:

```text
assets/js/deQuestionBuilder.js
```

Suggested exports:

```js
export function buildDeseqQuestionSpec(formValues, state) {}
export function validateDeseqQuestionSpec(spec, state) {}
export function previewDeseqModel(spec) {}
export function makeContrastLabel(spec) {}
export function makeContrastId(spec) {}
```

Suggested question builder map:

```js
const QUESTION_BUILDERS = {
  condition_within_tissue: buildConditionWithinTissueSpec,
  tissue_within_condition: buildTissueWithinConditionSpec,
  pairwise_interaction: buildPairwiseInteractionSpec,
  omnibus_interaction_lrt: buildOmnibusInteractionLrtSpec,
  direct_group_comparison: buildDirectGroupComparisonSpec,
  additive_adjusted_effect: buildAdditiveAdjustedEffectSpec
};
```

## Design spec object

Move from passing separate primitive arguments into DESeq2 to passing a structured design specification.

Example:

```js
const designSpec = {
  questionType: 'condition_within_tissue',
  scopeId: 'scope_tissue_liver',
  sampleIds,
  primaryFactor: 'condition',
  numerator: 'treated',
  denominator: 'control',
  stratifyFactor: 'tissue',
  stratifyLevel: 'liver',
  adjustColumns: ['batch'],
  modelKind: 'subset_additive',
  fullFormula: '~ batch + condition',
  reducedFormula: null,
  resultMode: 'wald_factor_contrast',
  contrast: {
    type: 'factor_contrast',
    factor: 'condition',
    numerator: 'treated',
    denominator: 'control'
  }
};
```

Potential `resultMode` values:

```text
wald_factor_contrast
wald_coefficient_name
wald_contrast_list
lrt
group_factor_contrast
```

---

# 8. Suggested R execution strategy

Update the webR runner so it can handle multiple analysis modes.

## Wald factor contrast

```r
res <- results(dds, contrast = c(factor_name, numerator_level, denominator_level))
```

Use for:

```text
condition effect within tissue after subsetting
tissue effect within condition after subsetting
additive covariate-adjusted effect
```

## Group factor contrast

```r
dds$group <- factor(paste(dds$condition, dds$tissue, sep = "_"))
design(dds) <- ~ batch + group
dds <- DESeq(dds)
res <- results(dds, contrast = c("group", "treated_liver", "control_brain"))
```

Use for:

```text
direct condition-tissue group comparisons
```

## Pairwise interaction contrast

```r
design(dds) <- ~ batch + condition + tissue + condition:tissue
dds <- DESeq(dds)
resultsNames(dds)
```

Then extract the appropriate interaction contrast using coefficient names. The UI should construct the contrast from user-facing selections.

## Omnibus LRT

```r
design(dds) <- ~ batch + condition + tissue + condition:tissue

dds <- DESeq(
  dds,
  test = "LRT",
  reduced = ~ batch + condition + tissue
)

res <- results(dds)
```

Use for:

```text
any interaction effect
any condition-related effect in any tissue
any tissue-related effect in any condition
```

---

# 9. Cache schema updates

The current analysis cache stores sample metadata, contrast metadata, DE results, and GSEA results. Extend it to store scopes and richer DE analysis metadata.

Increment the cache version and add:

```json
{
  "analysis_scopes": [
    {
      "id": "scope_tissue_liver",
      "label": "tissue = liver",
      "filters": [
        { "column": "tissue", "operator": "equals", "value": "liver" }
      ],
      "excluded_sample_ids": [],
      "sample_ids": ["S1", "S2", "S3", "S4"]
    }
  ],
  "de_analyses": [
    {
      "contrast_id": "deseq2_condition_treated_vs_control_within_liver",
      "question_type": "condition_within_tissue",
      "scope_id": "scope_tissue_liver",
      "full_model": "~ batch + condition",
      "reduced_model": "",
      "contrast_label": "treated_liver - control_liver",
      "sample_count": 8,
      "group_balance": {
        "condition": {
          "control": 4,
          "treated": 4
        }
      }
    }
  ]
}
```

This makes cached results interpretable later, not just reloadable.

---

# 10. Validation rules

Add validation before enabling the Run button.

## General validation

```text
- Count matrix exists.
- Sample metadata exists.
- Selected samples match count matrix columns.
- At least two samples are selected.
- Selected result question has all required fields.
- Numerator and denominator are different.
```

## Replicate validation

```text
- Each compared group should have at least two samples.
- For interactions, each required condition:tissue cell should have enough samples.
- For group factor comparisons, both selected combined groups should have enough samples.
```

## Covariate validation

```text
- Adjustment columns have no missing values in selected samples.
- Categorical covariates have at least two levels in selected samples.
- Continuous covariates are numeric and have variation.
- The primary comparison factor is not also selected as an adjustment variable.
```

## Model validation

```text
- Design matrix is full rank.
- Number of samples is greater than number of coefficients.
- Warn if a covariate is perfectly confounded with the primary comparison.
- Warn if a selected subset drops levels needed by the requested contrast.
```

---

# 11. UI copy snippets

## Condition effect within tissue

```text
Find genes changed by condition within one tissue.
```

Example explanation:

```text
This compares treated vs control using only samples from the selected tissue.
```

## Tissue effect within condition

```text
Find genes differing between tissues within one condition.
```

Example explanation:

```text
This compares two tissues using only samples from the selected condition.
```

## Interaction effect

```text
Find genes whose condition response differs between tissues.
```

Example explanation:

```text
This tests a difference-in-differences:
(treated in tissue A - control in tissue A) -
(treated in tissue B - control in tissue B).
```

## Direct group comparison

```text
Compare any two condition-tissue groups directly.
```

Warning:

```text
This comparison may mix condition and tissue effects. Use it only when these two combined groups are the intended biological comparison.
```

## Additive adjusted effect

```text
Find genes associated with the primary factor after adjusting for selected covariates.
```

Warning:

```text
This assumes the primary effect is the same across covariate levels. To test whether the effect differs across tissues or groups, use an interaction test.
```

## LRT

```text
Run a global test comparing a full model to a reduced model.
```

Warning:

```text
The LRT p-value may test multiple coefficients at once. The displayed log2FC is only a representative coefficient and may not describe the whole tested effect.
```

---

# 12. Implementation priority

## Phase 1: High value, lower complexity

Implement:

```text
- Analysis scope / sample subset
- Condition effect within selected subset
- Tissue effect within selected subset
- Direct group comparison using group factor
- Grouped result viewer
- Rich contrast metadata
- Cache support for scopes and model metadata
```

Use subsetting plus simple formulas:

```r
~ batch + condition
~ batch + tissue
~ batch + group
```

This covers most practical use cases and is easier to explain.

## Phase 2: Full interaction support

Add:

```text
- condition:tissue interaction model
- pairwise interaction contrasts
- global interaction LRT
- model preview for full/reduced models
- resultsNames preview for advanced users
```

Support:

```r
~ batch + condition + tissue + condition:tissue
```

and:

```r
DESeq(dds, test = "LRT", reduced = ~ batch + condition + tissue)
```

## Phase 3: Advanced contrast builder

Add:

```text
- coefficient browser
- add/subtract coefficient contrast builder
- coefficient-name validation against resultsNames(dds)
- advanced LRT formula editor
```

Keep this hidden behind an Advanced tab.

---

# 13. Recommended final behavior

After these changes, `fsgc-rnaseq-report` should support:

```text
simple condition contrasts
condition effects within tissues
tissue effects within conditions
condition:tissue interactions
omnibus LRTs
direct condition-tissue group comparisons
subset-only DESeq2 analyses
covariate-adjusted analyses
browser-side DESeq2 reruns
clear model previews
cacheable, explainable DE results
```

The most important design principle is:

```text
User selects a biological question.
App generates the DESeq2 model and contrast.
```

This keeps the UI understandable for non-statistical users while still allowing advanced DESeq2 workflows when needed.
