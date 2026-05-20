// @ts-check
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { activateTab, openReport } from './helpers/reportPage.js';

const SIM_COUNTS = 'assets/data/simulated/counts.csv';
const SIM_MANIFEST = 'assets/data/simulated/sample_manifest.csv';
const CACHE_CONTRAST_ID = 'playwright_cache_contrast';
const CACHE_GSEA_RESULT_ID = 'playwright_cache_contrast__uploaded__playwright_gmt__min10__max500__plotstop20';

test('uploads a count matrix and sample manifest', async ({ page }) => {
  await openReport(page);
  await uploadSimulatedData(page);

  await expect(page.locator('#user-data-status')).toContainText('Loaded 8 metadata rows');
  await expect(page.locator('#sample-count')).toHaveText('8');
  await expect(page.locator('#contrast-count')).toHaveText('1');
  await expect(page.locator('#samples-table')).toContainText('SIM_C1');
  await expect(page.locator('#counts-table')).toContainText('SimInflam1');
});

test('updates the DESeq2 question builder for pairwise and additive models', async ({ page }) => {
  await openReport(page);
  await uploadSimulatedData(page);
  await activateTab(page, 'de');

  await expect(page.locator('#deseq-question-type')).toHaveValue('pairwise_comparison');
  await expect(page.locator('#deseq-design-column')).toHaveValue('condition');
  await expect(page.locator('#deseq-denominator-level')).toHaveValue('control');
  await expect(page.locator('#deseq-model-preview')).toContainText('~ condition');
  await expect(page.locator('#deseq-model-preview')).toContainText('treated - control');
  await expect(page.locator('#deseq-adjust-list')).toContainText('Pairwise comparison uses model ~ primary factor');
  await expect(page.locator('#deseq-run')).toBeEnabled();

  await page.locator('#deseq-question-type').selectOption('additive_adjusted_effect');
  await page.locator('#deseq-adjust-list input[value="batch"]').check();
  await expect(page.locator('#deseq-model-preview')).toContainText('~ batch + condition');
  await expect(page.locator('#deseq-model-preview')).toContainText('treated - control');
  await expect(page.locator('#deseq-run')).toBeEnabled();
});

test('does not compute browser Welch DE fallback by default', async ({ page }) => {
  await openReport(page);
  await uploadSimulatedData(page);
  await activateTab(page, 'de');

  await expect(page.locator('#de-table-status')).toContainText('No DE result rows are loaded for this inferred contrast');
  await expect(page.locator('#volcano-plot')).toContainText('Run DESeq2');
  await expect(page.locator('#de-table')).toContainText('No table data available');
});

test('imports and exports analysis cache with DE and GSEA results', async ({ page }) => {
  await openReport(page);
  await activateTab(page, 'provenance');

  await page.locator('#analysis-cache-file').setInputFiles({
    name: 'playwright.analysis-cache.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(analysisCacheFixture()), 'utf8'),
  });

  await expect(page.locator('#analysis-cache-status')).toContainText('Loaded cache with 1 DESeq2 result set(s), 1 fgsea result set(s)');
  await expect(page.locator('#analysis-cache-export')).toBeEnabled();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#analysis-cache-export').click();
  const download = await downloadPromise;
  const exportedPath = await download.path();
  expect(exportedPath).toBeTruthy();
  const exported = JSON.parse(readFileSync(exportedPath, 'utf8'));
  expect(exported.de_results.some((entry) => entry.contrast_id === CACHE_CONTRAST_ID)).toBeTruthy();
  expect(exported.gsea_results.some((entry) => entry.result_id === CACHE_GSEA_RESULT_ID)).toBeTruthy();
});

test('renders cached GSEA overview and running enrichment plots', async ({ page }) => {
  await openReport(page);
  await activateTab(page, 'provenance');
  await page.locator('#analysis-cache-file').setInputFiles({
    name: 'playwright.analysis-cache.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(analysisCacheFixture()), 'utf8'),
  });
  await expect(page.locator('#analysis-cache-status')).toContainText('Loaded cache');

  await activateTab(page, 'enrichment');
  await page.locator('#enrichment-contrast-select').selectOption(CACHE_CONTRAST_ID);
  await expect(page.locator('#gsea-result-select')).toContainText('playwright.gmt');
  await expect(page.locator('#gsea-pathway-select')).toContainText('Playwright Up Pathway');
  await expect(page.locator('#gsea-pathway-status')).toContainText('retained running ES plot');
  await expect(page.locator('#enrichment-table')).toContainText('PWY_UP');

  await page.waitForFunction(() => Boolean(document.getElementById('enrichment-plot')?.__plotlyData?.length));
  await page.waitForFunction(() => Boolean(document.getElementById('gsea-running-plot')?.__plotlyData?.length));
  const rendered = await page.evaluate(() => ({
    enrichmentType: document.getElementById('enrichment-plot').__plotlyData?.[0]?.type,
    runningName: document.getElementById('gsea-running-plot').__plotlyData?.[0]?.name,
    hitName: document.getElementById('gsea-running-plot').__plotlyData?.[1]?.name,
  }));
  expect(rendered).toEqual({
    enrichmentType: 'bar',
    runningName: 'running ES',
    hitName: 'pathway genes',
  });
});

async function uploadSimulatedData(page) {
  await activateTab(page, 'samples');
  await page.locator('#user-counts-file').setInputFiles(SIM_COUNTS);
  await page.locator('#user-manifest-file').setInputFiles(SIM_MANIFEST);
  await page.locator('#user-data-apply').click();
  await expect(page.locator('#user-data-status')).toContainText('Loaded 8 metadata rows');
}

function analysisCacheFixture() {
  return {
    cache_kind: 'rnaseq-report-analysis-cache',
    cache_version: 6,
    created_at: '2026-05-20T00:00:00.000Z',
    project_title: 'Playwright cache fixture',
    run_id: 'p1',
    data_root: 'assets/data',
    sample_metadata: null,
    analysis_scopes: [],
    contrasts: [{
      id: CACHE_CONTRAST_ID,
      label: 'Playwright cache contrast',
      question_type: 'pairwise_comparison',
      question_label: 'Pairwise comparison',
      result_family: 'pairwise_comparison',
      full_model: '~ condition',
      contrast_label: 'treated - control',
      generated: true,
      method: 'DESeq2 webR',
    }],
    de_analyses: [{
      contrast_id: CACHE_CONTRAST_ID,
      question_type: 'pairwise_comparison',
      question_label: 'Pairwise comparison',
      result_family: 'pairwise_comparison',
      scope_id: 'all_samples',
      scope_label: 'All samples',
      full_model: '~ condition',
      contrast_label: 'treated - control',
      sample_count: 8,
      primary_factor: 'condition',
      numerator: 'treated',
      denominator: 'control',
      model_kind: 'factor_contrast',
      result_mode: 'wald_factor_contrast',
      group_balance: { control: 4, treated: 4 },
      method: 'DESeq2 webR',
    }],
    de_results: [{
      contrast_id: CACHE_CONTRAST_ID,
      rows: [
        { gene_id: 'ENSGSIM000001', gene_symbol: 'SimInflam1', baseMean: 250, log2FoldChange: 2.1, lfcSE: 0.2, statistic: 10.5, pvalue: 0.00001, padj: 0.001 },
        { gene_id: 'ENSGSIM000002', gene_symbol: 'SimInflam2', baseMean: 190, log2FoldChange: 1.7, lfcSE: 0.3, statistic: 5.7, pvalue: 0.0004, padj: 0.01 },
        { gene_id: 'ENSGSIM000003', gene_symbol: 'SimMetab1', baseMean: 620, log2FoldChange: -1.4, lfcSE: 0.25, statistic: -5.6, pvalue: 0.0006, padj: 0.02 },
        { gene_id: 'ENSGSIM000005', gene_symbol: 'SimStable1', baseMean: 1510, log2FoldChange: 0.03, lfcSE: 0.4, statistic: 0.08, pvalue: 0.92, padj: 0.95 },
      ],
    }],
    gsea_results: [{
      result_id: CACHE_GSEA_RESULT_ID,
      contrast_id: CACHE_CONTRAST_ID,
      label: 'Playwright cache contrast - playwright.gmt',
      source_kind: 'uploaded',
      source_id: 'playwright.gmt-1',
      source_label: 'playwright.gmt',
      reference: 'playwright.gmt',
      min_size: 10,
      max_size: 500,
      curve_limit: 'top20',
      curve_up_limit: 10,
      curve_down_limit: 10,
      created_at: '2026-05-20T00:00:00.000Z',
      rows: [
        { term_id: 'PWY_UP', term_name: 'Playwright Up Pathway', pvalue: 0.0002, padj: 0.01, ES: 0.62, NES: 1.9, size: 3, leadingEdge: 'SimInflam1;SimInflam2', pathway_source: 'playwright.gmt' },
        { term_id: 'PWY_DOWN', term_name: 'Playwright Down Pathway', pvalue: 0.0008, padj: 0.03, ES: -0.51, NES: -1.6, size: 2, leadingEdge: 'SimMetab1', pathway_source: 'playwright.gmt' },
      ],
      enrichment_curves: [{
        term_id: 'PWY_UP',
        term_name: 'Playwright Up Pathway',
        enrichmentScore: 0.62,
        NES: 1.9,
        padj: 0.01,
        size: 3,
        totalRanks: 4,
        points: [
          { rank: 1, runningScore: 0.18 },
          { rank: 2, runningScore: 0.45 },
          { rank: 3, runningScore: 0.62 },
          { rank: 4, runningScore: 0.02 },
        ],
        hits: [
          { rank: 1, gene: 'SimInflam1', stat: 10.5 },
          { rank: 2, gene: 'SimInflam2', stat: 5.7 },
          { rank: 3, gene: 'SimMetab1', stat: -5.6 },
        ],
      }],
    }],
  };
}
