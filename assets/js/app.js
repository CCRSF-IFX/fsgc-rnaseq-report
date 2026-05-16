import { state, setStatus, metadataColumns } from './state.js';
import { loadCoreAssets } from './dataLoader.js';
import { renderTable } from './tables.js';
import { summarizeQC, badge, qcRowsWithStatus } from './qc.js';
import { renderPCA, renderDistanceHeatmap, renderQCPlots, renderGeneCounts } from './plots.js';
import { populateContrastSelectors, renderCurrentContrast } from './de.js';
import { renderCurrentEnrichment } from './enrichment.js';
import { renderGeneSearch } from './geneSearch.js';
import { renderDownstreamCards } from './downstreamPlugins.js';
import { renderPackageRepositoryPanel } from './packageRepository.js';
import { setupDeseqControls } from './deseq2.js';
import { setupExpressionHeatmapControls } from './heatmap.js';

async function main() {
  wireTabs();
  try {
    await loadCoreAssets();
    renderHeader();
    renderOverview();
    renderSamples();
    populateContrastSelectors();
    setupDeseqControls({ populateContrastSelectors, renderCurrentContrast });
    renderDownstreamCards();
    renderPackageRepositoryPanel();
    setStatus('Report assets loaded; loading plots...');
    await waitForPlotly();
    renderQC();
    setupPcaControls();
    setupExpressionHeatmapControls();
    await renderCurrentContrast();
    await renderCurrentEnrichment();
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
  document.getElementById('report-title').textContent = cfg.reportTitle || 'RNA-seq Report';
  document.getElementById('report-subtitle').textContent = cfg.reportSubtitle || 'Interactive pipeline summary';
  document.getElementById('run-label').textContent = cfg.runId || 'demo-run';
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
  document.getElementById('sample-search')?.addEventListener('input', (event) => {
    const q = event.target.value.toLowerCase();
    const filtered = state.samples.filter((row) => Object.values(row).some((v) => String(v).toLowerCase().includes(q)));
    renderTable('samples-table', filtered, { exportName: 'samples.filtered.csv' });
  });
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
  const columns = metadataColumns();
  color.innerHTML = columns.map((c) => `<option value="${c}">${c}</option>`).join('');
  if (columns.includes('condition')) color.value = 'condition';
  const pair = document.getElementById('pca-pair');
  const pcs = Object.keys(state.pca?.variance_explained || {});
  if (pair && pcs.length >= 2) {
    pair.innerHTML = pcs.slice(0, -1).map((pc, i) => `<option value="${pc},${pcs[i + 1]}">${pc} vs ${pcs[i + 1]}</option>`).join('');
  }
  renderPCA(color.value || columns[0], pair?.value || 'PC1,PC2');
  renderDistanceHeatmap();
}

function renderProvenance() {
  const rows = [];
  if (state.provenance) Object.entries(state.provenance).forEach(([key, value]) => rows.push({ key, value }));
  if (state.software) Object.entries(state.software).forEach(([key, value]) => rows.push({ key: `software.${key}`, value }));
  renderTable('provenance-panel', rows, { exportName: 'provenance.csv' });
}

function wireControls() {
  document.getElementById('pca-color')?.addEventListener('change', () => renderPCA(document.getElementById('pca-color').value, document.getElementById('pca-pair').value));
  document.getElementById('pca-pair')?.addEventListener('change', () => renderPCA(document.getElementById('pca-color').value, document.getElementById('pca-pair').value));
  document.getElementById('de-apply')?.addEventListener('click', renderCurrentContrast);
  document.getElementById('contrast-select')?.addEventListener('change', renderCurrentContrast);
  document.getElementById('enrichment-contrast-select')?.addEventListener('change', renderCurrentEnrichment);
  document.getElementById('gene-search-button')?.addEventListener('click', renderGeneSearch);
  document.getElementById('count-gene-button')?.addEventListener('click', () => renderGeneCounts(document.getElementById('count-gene-input').value));
  renderTable('counts-table', state.counts, { limit: 50, exportName: 'counts.preview.csv' });
}

function wireTabs() {
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab-button').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      button.classList.add('active');
      const panel = document.getElementById(`tab-${button.dataset.tab}`);
      panel.classList.add('active');
      if (globalThis.Plotly?.Plots) {
        requestAnimationFrame(() => {
          panel.querySelectorAll('.js-plotly-plot').forEach((plot) => Plotly.Plots.resize(plot));
        });
      }
    });
  });
}

main();
