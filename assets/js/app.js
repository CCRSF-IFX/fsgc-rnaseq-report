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

async function main() {
  wireTabs();
  try {
    await loadCoreAssets();
    renderHeader();
    renderOverview();
    renderSamples();
    populateContrastSelectors();
    setupDeseqControls({ populateContrastSelectors, renderCurrentContrast });
    setupFgseaControls();
    setupAnalysisCacheControls({ populateContrastSelectors, renderCurrentContrast, renderCurrentEnrichment });
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
}

function cleanHeaderText(value) {
  return String(value || '').trim();
}

function abbreviationFromTitle(title) {
  const words = String(title || '').match(/[A-Za-z0-9]+/g) || [];
  return words.slice(0, 4).map((word) => word[0]).join('').toUpperCase();
}

function renderOverview() {
  const summary = summarizeQC();
  document.getElementById('sample-count').textContent = state.samples.length;
  document.getElementById('contrast-count').textContent = state.contrasts.length;
  document.getElementById('qc-warning-count').textContent = summary.counts.warn + summary.counts.fail;
  const provenance = state.provenance || {};
  document.getElementById('overview-summary').innerHTML = `
    <p><strong>Genome:</strong> ${provenance.genome_build || 'not provided'}</p>
    <p><strong>Annotation:</strong> ${provenance.annotation_version || 'not provided'}</p>
    <p><strong>Pipeline:</strong> ${provenance.pipeline_name || 'not provided'} ${provenance.pipeline_version || ''}</p>`;
  renderProvenance();
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
  if (state.provenance) Object.entries(state.provenance).forEach(([key, value]) => rows.push({ key, value }));
  if (state.software) Object.entries(state.software).forEach(([key, value]) => rows.push({ key: `software.${key}`, value }));
  renderTable('provenance-panel', rows, { exportName: 'provenance.csv' });
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
  setupDeseqControls({ populateContrastSelectors, renderCurrentContrast });
  setupFgseaControls();
  setupAnalysisCacheControls({ populateContrastSelectors, renderCurrentContrast, renderCurrentEnrichment });
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
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab-button').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      button.classList.add('active');
      const panel = document.getElementById(`tab-${button.dataset.tab}`);
      panel.classList.add('active');
      requestAnimationFrame(adjustVisibleDataTables);
      if (globalThis.Plotly?.Plots) {
        requestAnimationFrame(() => {
          panel.querySelectorAll('.js-plotly-plot').forEach((plot) => Plotly.Plots.resize(plot));
          if (button.dataset.tab === 'clustering') {
            renderExpressionHeatmap();
            resizeExpressionHeatmap();
          }
        });
      } else if (button.dataset.tab === 'clustering') {
        requestAnimationFrame(() => renderExpressionHeatmap());
      }
    });
  });
}

main();
