import { state, setStatus, metadataColumns } from './state.js';
import { loadCoreAssets } from './dataLoader.js';
import { adjustVisibleDataTables, renderTable } from './tables.js';
import { summarizeQC, badge, qcRowsWithStatus } from './qc.js';
import { renderPCA, renderDistanceHeatmap, renderQCPlots, renderGeneCounts } from './plots.js';
import { populateContrastSelectors, renderCurrentContrast } from './de.js';
import { renderCurrentEnrichment } from './enrichment.js';
import { renderDownstreamCards } from './downstreamPlugins.js';
import { renderPackageRepositoryPanel } from './packageRepository.js';
import { setupDeseqControls } from './deseq2.js';
import { setupFgseaControls } from './fgsea.js';
import { renderExpressionHeatmap, resizeExpressionHeatmap, setupExpressionHeatmapControls } from './heatmap.js';
import { setupUserDataControls } from './userData.js';
import { setupAnalysisCacheControls } from './analysisCache.js';
import { sampleIdsInCounts } from './analysis.js';
import { getPackageStatus } from './packageManager.js';

async function main() {
  wireTabs();
  try {
    await loadCoreAssets();
    renderHeader();
    renderOverview();
    renderSamples();
    populateContrastSelectors();
    setupDeseqControls({
      populateContrastSelectors,
      renderCurrentContrast,
      renderOverviewMetrics,
      renderAnalysisReadiness,
    });
    setupFgseaControls();
    setupAnalysisCacheControls({
      refresh: refreshReportFromState,
      populateContrastSelectors,
      renderCurrentContrast,
      renderCurrentEnrichment,
      renderOverviewMetrics,
      renderAnalysisReadiness,
    });
    renderAnalysisReadiness();
    renderDownstreamCards();
    renderPackageRepositoryPanel();
    setStatus('Report assets loaded; loading plots...');
    await waitForPlotly();
    renderQC();
    setupPcaControls();
    setupExpressionHeatmapControls();
    await renderCurrentContrast();
    await renderCurrentEnrichment();
    setupUserDataControls({ refresh: refreshReportFromState });
    setupCountExplorerControls();
    wireControls();
    setStatus('Report assets loaded');
  } catch (error) {
    setStatus(`Error: ${error.message}`);
    console.error(error);
  }
}

function waitForPlotly(timeoutMs = 30000) {
  if (globalThis.Plotly) return Promise.resolve();
  const script = document.querySelector('[data-plotly]');
  if (!script) return Promise.reject(new Error('Plotly script is missing.'));

  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = () => {
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
      clearInterval(check);
      clearTimeout(timeout);
    };
    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };
    const fail = (message) => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error(message));
    };
    const handleLoad = () => (globalThis.Plotly ? finish() : fail('Plotly loaded but did not initialize.'));
    const handleError = () => fail('Plotly failed to load.');
    const check = setInterval(() => { if (globalThis.Plotly) finish(); }, 50);
    const timeout = setTimeout(() => fail('Plotly did not load within 30 seconds.'), timeoutMs);

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
  });
}

function renderHeader() {
  const cfg = state.config;
  const projectTitle = cleanHeaderText(cfg.projectTitle || cfg.reportTitle) || 'RNA-seq Report';
  const projectAbbreviation = cleanHeaderText(cfg.projectAbbreviation || cfg.projectAbbr) || abbreviationFromTitle(projectTitle) || 'OR';
  const attribution = reportAttributionText(cfg);
  const meta = reportMetaText(cfg);
  document.title = projectTitle;
  const brandMark = document.getElementById('project-abbreviation');
  if (brandMark) {
    brandMark.textContent = projectAbbreviation;
    brandMark.title = projectTitle;
  }
  document.getElementById('project-title').textContent = projectTitle;
  document.getElementById('report-title').textContent = projectTitle;
  document.getElementById('report-subtitle').textContent = cfg.reportSubtitle || 'Interactive pipeline summary';
  const runLabel = document.getElementById('run-label');
  const runId = cleanHeaderText(cfg.runId);
  if (runLabel) {
    runLabel.textContent = runId;
    runLabel.hidden = !runId;
  }
  setOptionalText('report-attribution', attribution ? `Prepared by ${attribution}` : '');
  setOptionalText('report-meta', meta);
}

function cleanHeaderText(value) {
  return String(value || '').trim();
}

function setOptionalText(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  const text = cleanHeaderText(value);
  element.textContent = text;
  element.hidden = !text;
}

function abbreviationFromTitle(title) {
  const words = String(title || '').match(/[A-Za-z0-9]+/g) || [];
  return words.slice(0, 4).map((word) => word[0]).join('').toUpperCase();
}

function renderOverview() {
  renderOverviewMetrics();
  const provenance = state.provenance || {};
  const attribution = reportAttributionText(state.config);
  const reportVersion = versionLabel(state.config?.reportVersion);
  const webR = webRVersionSummary(state.config?.webr);
  document.getElementById('overview-summary').innerHTML = `
    <p><strong>Prepared by:</strong> ${escapeHtml(attribution || 'not provided')}</p>
    <p><strong>Report:</strong> ${escapeHtml(reportVersion || 'not provided')}</p>
    <p><strong>webR:</strong> ${escapeHtml(webR || 'not configured')}</p>
    <p><strong>Genome:</strong> ${escapeHtml(provenance.genome_build || 'not provided')}</p>
    <p><strong>Annotation:</strong> ${escapeHtml(provenance.annotation_version || 'not provided')}</p>
    <p><strong>Pipeline:</strong> ${escapeHtml(`${provenance.pipeline_name || 'not provided'} ${provenance.pipeline_version || ''}`.trim())}</p>`;
  renderProvenance();
}

function renderOverviewMetrics() {
  const summary = summarizeQC();
  document.getElementById('sample-count').textContent = state.samples.length;
  document.getElementById('contrast-count').textContent = state.contrasts.length;
  document.getElementById('qc-warning-count').textContent = summary.counts.warn + summary.counts.fail;
}

function renderSamples() {
  renderTable('samples-table', state.samples, { exportName: 'samples.csv' });
  const search = document.getElementById('sample-search');
  if (search) search.oninput = (event) => {
    const q = event.target.value.toLowerCase();
    const filtered = state.samples.filter((row) => Object.values(row).some((v) => String(v).toLowerCase().includes(q)));
    renderTable('samples-table', filtered, { exportName: 'samples.filtered.csv' });
  };
}

function renderAnalysisReadiness() {
  const container = document.getElementById('analysis-readiness');
  if (!container) return;
  const items = analysisReadinessItems();
  container.innerHTML = items.map((item) => `
    <div class="readiness-item ${item.tone}">
      <span class="readiness-dot" aria-hidden="true"></span>
      <div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p></div>
    </div>`).join('');
}

function analysisReadinessItems() {
  const sampleIds = sampleIdsInCounts(state.samples, state.counts);
  const metadata = metadataColumns();
  const factorColumns = metadata.filter((column) => metadataLevels(column).length >= 2);
  const primary = document.getElementById('deseq-design-column')?.value
    || state.config?.analysis?.conditionColumn
    || factorColumns[0]
    || '';
  const numerator = document.getElementById('deseq-numerator-level')?.value || '';
  const denominator = document.getElementById('deseq-denominator-level')?.value
    || document.getElementById('deseq-reference-level')?.value
    || '';
  const adjustColumns = selectedValues('deseq-adjust-columns');
  const gmtUploaded = (document.getElementById('gsea-gmt-file')?.files?.length || 0) > 0;
  const packageStatuses = ['DESeq2', 'fgsea'].map((pkg) => `${pkg}: ${getPackageStatus(pkg)}`);
  const packagesReady = ['DESeq2', 'fgsea'].every((pkg) => packageReadyStatus(getPackageStatus(pkg)));
  const webREnabled = state.config?.webr?.enabled !== false;
  const designCounts = groupCounts(sampleIds, primary, numerator, denominator);
  const designReady = primary && numerator && denominator && numerator !== denominator
    && designCounts.numerator >= 2 && designCounts.denominator >= 2;
  const covariateIssues = covariateReadinessIssues(sampleIds, primary, numerator, denominator, adjustColumns);

  return [
    {
      tone: sampleIds.length >= 2 && state.counts.length > 0 ? 'ok' : 'fail',
      title: 'Count matrix',
      message: state.counts.length > 0
        ? `${state.counts.length.toLocaleString()} genes loaded; ${sampleIds.length}/${state.samples.length} samples match count columns.`
        : 'No count matrix rows are loaded.',
    },
    {
      tone: factorColumns.length ? 'ok' : 'warn',
      title: 'Sample manifest',
      message: factorColumns.length
        ? `${metadata.length} metadata column(s) available; analysis factors: ${factorColumns.join(', ')}.`
        : 'No grouping column with at least two levels is available; upload a manifest before DESeq2 or fgsea.',
    },
    {
      tone: designReady ? 'ok' : 'fail',
      title: 'DESeq2 design',
      message: designReady
        ? `${primary}: ${numerator} (${designCounts.numerator}) vs ${denominator} (${designCounts.denominator}).`
        : 'Choose a primary factor with two different levels and at least two samples per group.',
    },
    {
      tone: covariateIssues.length ? 'warn' : 'ok',
      title: 'Covariates/blocking',
      message: adjustColumns.length
        ? (covariateIssues.length ? covariateIssues.join(' ') : `Selected: ${adjustColumns.join(', ')}.`)
        : 'No optional covariates selected.',
    },
    {
      tone: webREnabled ? (packagesReady ? 'ok' : 'warn') : 'fail',
      title: 'webR packages',
      message: webREnabled
        ? `${state.config?.webr?.packageRepoVersion || 'snapshot'} configured; ${packageStatuses.join('; ')}. Install/load packages or mount the library bundle before browser analysis.`
        : 'webR is disabled in report_config.json.',
    },
    {
      tone: gmtUploaded ? 'ok' : 'fail',
      title: 'GSEA GMT files',
      message: gmtUploaded
        ? 'Uploaded GMT file(s) will be used for fgsea.'
        : 'Upload one or more GMT files before running browser fgsea.',
    },
  ];
}

function metadataLevels(column) {
  return Array.from(new Set(state.samples
    .map((sample) => sample[column])
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map(String)));
}

function selectedValues(selectId) {
  return Array.from(document.getElementById(selectId)?.selectedOptions || [])
    .map((option) => option.value)
    .filter(Boolean);
}

function groupCounts(sampleIds, column, numerator, denominator) {
  const counts = { numerator: 0, denominator: 0 };
  sampleIds.forEach((sampleId) => {
    const value = sampleMetadataValue(sampleId, column);
    if (value === numerator) counts.numerator += 1;
    if (value === denominator) counts.denominator += 1;
  });
  return counts;
}

function covariateReadinessIssues(sampleIds, primary, numerator, denominator, adjustColumns) {
  if (!adjustColumns.length) return [];
  const selectedSampleIds = primary && numerator && denominator
    ? sampleIds.filter((sampleId) => {
      const value = sampleMetadataValue(sampleId, primary);
      return value === numerator || value === denominator;
    })
    : sampleIds;
  return adjustColumns.flatMap((column) => {
    const values = selectedSampleIds.map((sampleId) => sampleMetadataValue(sampleId, column));
    if (values.some((value) => value === '')) return [`${column} has missing values.`];
    if (new Set(values).size < 2) return [`${column} has fewer than two levels in the selected samples.`];
    return [];
  });
}

function sampleMetadataValue(sampleId, column) {
  if (!column) return '';
  const value = state.samples.find((sample) => sample.sample_id === sampleId)?.[column];
  return value === undefined || value === null ? '' : String(value);
}

function packageReadyStatus(status) {
  return ['installed', 'loaded', 'mounted'].includes(status);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function renderQC() {
  const summary = summarizeQC();
  document.getElementById('qc-summary').innerHTML = `
    <p>${badge('ok')} ${summary.counts.ok} &nbsp; ${badge('warn')} ${summary.counts.warn} &nbsp; ${badge('fail')} ${summary.counts.fail}</p>`;
  renderQCPlots();
  const rows = qcRowsWithStatus().map((row) => ({ ...row, status: row.status.toUpperCase() }));
  renderTable('qc-table', rows, { exportName: 'qc_metrics.csv' });
}

function setupPcaControls() {
  const color = document.getElementById('pca-color');
  const shape = document.getElementById('pca-shape');
  const shapeLabel = document.getElementById('pca-shape-label');
  const columns = metadataColumns();
  if (columns.length === 0) {
    color.innerHTML = '<option value="">None</option>';
    color.disabled = true;
  } else {
    color.disabled = false;
    color.innerHTML = columns.map((c) => `<option value="${c}">${c}</option>`).join('');
    if (columns.includes('condition')) color.value = 'condition';
  }
  const shapeColumns = columns.filter((column) => column !== color.value);
  if (shape) {
    shape.innerHTML = ['none'].concat(shapeColumns).map((c) => `<option value="${c}">${c === 'none' ? 'None' : c}</option>`).join('');
    shape.value = shapeColumns[0] || 'none';
    shape.disabled = columns.length <= 1;
  }
  if (shapeLabel) shapeLabel.hidden = columns.length <= 1;
  const projection = document.getElementById('pca-projection');
  const pcs = pcaComponentKeys();
  if (projection) {
    const previous = projection.value || '2d';
    const canRender3d = pcs.length >= 3;
    projection.innerHTML = `<option value="2d">2D scatter</option><option value="3d"${canRender3d ? '' : ' disabled'}>3D scatter</option>`;
    projection.value = canRender3d && previous === '3d' ? '3d' : '2d';
    projection.disabled = !canRender3d;
  }
  const pair = document.getElementById('pca-pair');
  if (pair && pcs.length >= 2) {
    pair.innerHTML = pcs.slice(0, -1).map((pc, i) => `<option value="${pc},${pcs[i + 1]}">${pc} vs ${pcs[i + 1]}</option>`).join('');
  }
  syncPcaProjectionControls();
  renderCurrentPCA();
  renderDistanceHeatmap();
}

function renderProvenance() {
  const rows = [];
  reportMetadataRows().forEach((row) => rows.push(row));
  if (state.provenance) Object.entries(state.provenance).forEach(([key, value]) => rows.push({ key, value }));
  if (state.software) Object.entries(state.software).forEach(([key, value]) => rows.push({ key: `software.${key}`, value }));
  renderTable('provenance-panel', rows, { exportName: 'provenance.csv' });
}

function reportMetadataRows() {
  const cfg = state.config || {};
  const webr = cfg.webr || {};
  const rows = [
    { key: 'report.title', value: cfg.projectTitle || cfg.reportTitle || '' },
    { key: 'report.version', value: versionLabel(cfg.reportVersion) },
    { key: 'report.author', value: cfg.reportAuthor || cfg.reportPreparedBy || '' },
    { key: 'report.organization', value: cfg.reportOrganization || '' },
    { key: 'webr.runtime', value: webRRuntimeVersion(webr) || webr.baseUrl || '' },
    { key: 'webr.package_library_snapshot', value: webRPackageLibrarySnapshot(webr) },
  ];
  return rows.filter((row) => cleanHeaderText(row.value));
}

function reportAttributionText(cfg = {}) {
  const author = cleanHeaderText(cfg.reportAuthor || cfg.reportPreparedBy);
  const organization = cleanHeaderText(cfg.reportOrganization);
  if (author && organization && author !== organization) return `${author} · ${organization}`;
  return author || organization;
}

function reportMetaText(cfg = {}) {
  const parts = [
    versionLabel(cfg.reportVersion) ? `Report ${versionLabel(cfg.reportVersion)}` : '',
    webRRuntimeVersion(cfg.webr) ? `webR ${webRRuntimeVersion(cfg.webr)}` : '',
    webRPackageLibrarySnapshot(cfg.webr) ? `package/library snapshot ${webRPackageLibrarySnapshot(cfg.webr)}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function webRVersionSummary(webr = {}) {
  return [
    webRRuntimeVersion(webr) ? `runtime ${webRRuntimeVersion(webr)}` : '',
    webRPackageLibrarySnapshot(webr) ? `package/library snapshot ${webRPackageLibrarySnapshot(webr)}` : '',
  ].filter(Boolean).join(' · ');
}

function webRPackageLibrarySnapshot(webr = {}) {
  return cleanHeaderText(webr.packageRepoVersion || webr.libraryBundle?.snapshotVersion);
}

function webRRuntimeVersion(webr = {}) {
  const configured = cleanHeaderText(webr.runtimeVersion || webr.version);
  if (configured) return versionLabel(configured);
  const match = cleanHeaderText(webr.baseUrl).match(/\/(v[0-9][^/]+)\/?$/i);
  return match ? match[1] : '';
}

function versionLabel(value) {
  const text = cleanHeaderText(value);
  if (!text) return '';
  return /^v/i.test(text) ? text : `v${text}`;
}

function wireControls() {
  document.getElementById('pca-color')?.addEventListener('change', () => {
    syncPcaShapeOptions();
    renderCurrentPCA();
  });
  document.getElementById('pca-shape')?.addEventListener('change', renderCurrentPCA);
  document.getElementById('pca-pair')?.addEventListener('change', renderCurrentPCA);
  document.getElementById('pca-projection')?.addEventListener('change', () => {
    syncPcaProjectionControls();
    renderCurrentPCA();
  });
  document.getElementById('de-apply')?.addEventListener('click', renderCurrentContrast);
  document.getElementById('contrast-select')?.addEventListener('change', renderCurrentContrast);
  document.getElementById('enrichment-contrast-select')?.addEventListener('change', renderCurrentEnrichment);
  document.getElementById('gsea-result-select')?.addEventListener('change', renderCurrentEnrichment);
  document.getElementById('deseq-design-column')?.addEventListener('change', renderAnalysisReadiness);
  document.getElementById('deseq-reference-level')?.addEventListener('change', renderAnalysisReadiness);
  document.getElementById('deseq-numerator-level')?.addEventListener('change', renderAnalysisReadiness);
  document.getElementById('deseq-denominator-level')?.addEventListener('change', renderAnalysisReadiness);
  document.getElementById('deseq-adjust-columns')?.addEventListener('change', renderAnalysisReadiness);
  document.getElementById('gsea-gmt-file')?.addEventListener('change', renderAnalysisReadiness);
  document.addEventListener('rnaseq-report:packages-changed', renderAnalysisReadiness);
  document.getElementById('count-gene-button')?.addEventListener('click', () => renderCountExplorerPlot());
  document.getElementById('count-gene-input')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') renderCountExplorerPlot();
  });
  document.querySelectorAll('[data-count-plot-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      setCountPlotMode(button.dataset.countPlotMode);
      renderCountExplorerPlot({ allowEmpty: false });
    });
  });
  document.getElementById('count-boxplot-group')?.addEventListener('change', () => {
    populateCountBoxplotSplitOptions();
    renderCountExplorerPlot({ allowEmpty: false });
  });
  document.getElementById('count-boxplot-split')?.addEventListener('change', () => renderCountExplorerPlot({ allowEmpty: false }));
  renderTable('counts-table', state.counts, { limit: 50, exportName: 'counts.csv' });
}

function setupCountExplorerControls() {
  populateCountBoxplotGroups();
  syncCountPlotModeControls();
}

function populateCountBoxplotGroups() {
  const select = document.getElementById('count-boxplot-group');
  if (!select) return;

  const previous = select.value;
  const eligibleColumns = eligibleCountMetadataColumns();
  select.replaceChildren(...eligibleColumns.map((column) => {
    const option = document.createElement('option');
    option.value = column;
    option.textContent = column;
    return option;
  }));
  if (eligibleColumns.includes(previous)) select.value = previous;
  else if (eligibleColumns.includes('condition')) select.value = 'condition';
  else select.value = eligibleColumns[0] || '';

  const boxButton = document.getElementById('count-plot-mode-box');
  if (boxButton) boxButton.disabled = eligibleColumns.length === 0;
  if (currentCountPlotMode() === 'box' && eligibleColumns.length === 0) setCountPlotMode('bar');
  populateCountBoxplotSplitOptions(eligibleColumns);
  syncCountPlotModeControls();
}

function populateCountBoxplotSplitOptions(eligibleColumns = eligibleCountMetadataColumns()) {
  const select = document.getElementById('count-boxplot-split');
  if (!select) return;

  const previous = select.value;
  const groupColumn = document.getElementById('count-boxplot-group')?.value || '';
  const splitColumns = eligibleColumns.filter((column) => column !== groupColumn);
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = 'None';
  const options = splitColumns.map((column) => {
    const option = document.createElement('option');
    option.value = column;
    option.textContent = column;
    return option;
  });
  select.replaceChildren(noneOption, ...options);
  select.value = splitColumns.includes(previous) ? previous : '';
}

function eligibleCountMetadataColumns() {
  return metadataColumns().filter((column) => countMetadataLevels(column).length > 1);
}

function countMetadataLevels(column) {
  return Array.from(new Set(state.samples.map((sample) => String(sample[column] ?? 'NA'))));
}

function setCountPlotMode(mode) {
  const boxButton = document.getElementById('count-plot-mode-box');
  const nextMode = mode === 'box' && !boxButton?.disabled ? 'box' : 'bar';
  document.querySelectorAll('[data-count-plot-mode]').forEach((button) => {
    const active = button.dataset.countPlotMode === nextMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  syncCountPlotModeControls();
}

function syncCountPlotModeControls() {
  const isBoxMode = currentCountPlotMode() === 'box';
  const groupLabel = document.getElementById('count-boxplot-group-label');
  const splitLabel = document.getElementById('count-boxplot-split-label');
  if (groupLabel) groupLabel.hidden = !isBoxMode;
  if (splitLabel) splitLabel.hidden = !isBoxMode;
}

function currentCountPlotMode() {
  return document.querySelector('[data-count-plot-mode].active')?.dataset.countPlotMode || 'bar';
}

function renderCountExplorerPlot(options = {}) {
  const allowEmpty = options.allowEmpty !== false;
  const input = document.getElementById('count-gene-input');
  const query = input?.value?.trim() || '';
  const status = document.getElementById('count-plot-status');
  if (!query && !allowEmpty) {
    if (status) status.textContent = '';
    return;
  }
  renderGeneCounts(query, {
    mode: currentCountPlotMode(),
    groupBy: document.getElementById('count-boxplot-group')?.value || '',
    splitBy: document.getElementById('count-boxplot-split')?.value || '',
  });
}

function syncPcaShapeOptions() {
  const color = document.getElementById('pca-color');
  const shape = document.getElementById('pca-shape');
  const shapeLabel = document.getElementById('pca-shape-label');
  if (!shape) return;
  const columns = metadataColumns();
  const previous = shape.value;
  const shapeColumns = columns.filter((column) => column !== color?.value);
  shape.innerHTML = ['none'].concat(shapeColumns).map((c) => `<option value="${c}">${c === 'none' ? 'None' : c}</option>`).join('');
  shape.value = shapeColumns.includes(previous) ? previous : (shapeColumns[0] || 'none');
  shape.disabled = columns.length <= 1;
  if (shapeLabel) shapeLabel.hidden = columns.length <= 1;
}

function syncPcaProjectionControls() {
  const projection = document.getElementById('pca-projection');
  const pair = document.getElementById('pca-pair');
  const pairLabel = document.getElementById('pca-pair-label');
  const is3d = projection?.value === '3d';
  if (pair) pair.disabled = is3d || pair.options.length === 0;
  if (pairLabel) pairLabel.classList.toggle('muted-control', is3d);
}

function renderCurrentPCA() {
  renderPCA(
    document.getElementById('pca-color')?.value || '',
    document.getElementById('pca-pair')?.value || 'PC1,PC2',
    document.getElementById('pca-shape')?.value || 'none',
    document.getElementById('pca-projection')?.value || '2d',
  );
}

function pcaComponentKeys() {
  const points = state.pca?.samples || [];
  const keys = new Set();
  points.forEach((point) => {
    Object.keys(point).forEach((key) => {
      if (/^PC\d+$/.test(key) && Number.isFinite(Number(point[key]))) keys.add(key);
    });
  });
  return Array.from(keys)
    .filter((key) => points.every((point) => Number.isFinite(Number(point[key]))))
    .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
}

async function refreshReportFromState() {
  renderHeader();
  renderOverview();
  renderSamples();
  populateContrastSelectors();
  setupDeseqControls({
    populateContrastSelectors,
    renderCurrentContrast,
    renderOverviewMetrics,
    renderAnalysisReadiness,
  });
  setupFgseaControls();
  setupAnalysisCacheControls({
    refresh: refreshReportFromState,
    populateContrastSelectors,
    renderCurrentContrast,
    renderCurrentEnrichment,
    renderOverviewMetrics,
    renderAnalysisReadiness,
  });
  renderAnalysisReadiness();
  renderDownstreamCards();
  renderPackageRepositoryPanel();
  renderQC();
  setupPcaControls();
  setupExpressionHeatmapControls();
  setupCountExplorerControls();
  renderTable('counts-table', state.counts, { limit: 50, exportName: 'counts.csv' });
  renderCountExplorerPlot({ allowEmpty: false });
  await renderCurrentContrast();
  await renderCurrentEnrichment();
}

function wireTabs() {
  document.querySelectorAll('[data-go-tab]').forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.goTab));
  });
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  });
}

function activateTab(tabName) {
  const button = document.querySelector(`.tab-button[data-tab="${cssEscape(tabName)}"]`);
  const panel = document.getElementById(`tab-${tabName}`);
  if (!button || !panel) return;

  document.querySelectorAll('.tab-button').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  button.classList.add('active');
  panel.classList.add('active');
  requestAnimationFrame(adjustVisibleDataTables);
  if (globalThis.Plotly?.Plots) {
    requestAnimationFrame(() => {
      panel.querySelectorAll('.js-plotly-plot').forEach((plot) => Plotly.Plots.resize(plot));
      if (tabName === 'clustering') {
        renderExpressionHeatmap();
        resizeExpressionHeatmap();
      }
    });
  } else if (tabName === 'clustering') {
    requestAnimationFrame(() => renderExpressionHeatmap());
  }
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value || ''));
  return String(value || '').replace(/["\\]/g, '\\$&');
}

main();
