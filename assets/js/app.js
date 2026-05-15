import { state, setStatus, metadataColumns } from './state.js';
import { loadCoreAssets } from './dataLoader.js';
import { renderTable } from './tables.js';
import { summarizeQC, badge, qcRowsWithStatus } from './qc.js';
import { renderPCA, renderDistanceHeatmap, renderQCPlots, renderGeneCounts } from './plots.js';
import { populateContrastSelectors, renderCurrentContrast } from './de.js';
import { renderCurrentEnrichment } from './enrichment.js';
import { renderGeneSearch } from './geneSearch.js';
import { renderDownstreamCards } from './downstreamPlugins.js';

async function main() {
  wireTabs();
  try {
    await loadCoreAssets();
    setStatus('Report assets loaded');
    renderHeader();
    renderOverview();
    renderSamples();
    renderQC();
    setupPcaControls();
    populateContrastSelectors();
    await renderCurrentContrast();
    await renderCurrentEnrichment();
    renderDownstreamCards();
    wireControls();
  } catch (error) {
    setStatus(`Error: ${error.message}`);
    console.error(error);
  }
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
  renderPCA(color.value || columns[0], document.getElementById('pca-pair').value);
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
      document.getElementById(`tab-${button.dataset.tab}`).classList.add('active');
    });
  });
}

main();
